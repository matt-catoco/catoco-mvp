-- ============================================================================
-- Opt out of a trip / a specific element (+ organizer removal / un-scoping).
--
-- Founder decisions (2026-10-01):
--   * Keep auto-join on the invite link; add a real "Leave trip".
--   * Leaving/removal is blocked while the person has money in play on the
--     trip: an unrefunded contribution, a live payment authorization, or a
--     place in a LOCKED element whose funding is still active (their fixed
--     share was divided by a headcount that includes them). Organizer must
--     settle it first (refund / cancel the element).
--   * Element opt-out is PRE-LOCK ONLY. For a bundled element it applies to
--     the whole bundle at once (bundles share scope and one combined charge)
--     and is refused if any bundle member has already locked.
--   * Organizer/co-organizer can remove participants and add/remove people
--     from an open element's scope, under the same guards.
--   * A removed participant CAN rejoin via the invite link (no removal record).
--   * Late joiners are auto-added only to still-OPEN "Everyone" elements —
--     joining used to silently add them to locked ones too, changing the
--     headcount behind an already-fixed share.
--
-- Also closes a real hole found while reconciling: `authenticated` held
-- INSERT/UPDATE/DELETE on element_participants (policy: "your own rows") and
-- on trip_participants (organizer policy). Any signed-in user could opt
-- themselves out of a locked, funded element straight through the API —
-- or insert themselves into an arbitrary element (making them an "element
-- member" who can read it). Nothing in the app writes these tables
-- directly (all via security-definer RPCs; verified on staging AND main),
-- so direct writes are revoked and every change goes through the guarded
-- functions below.
-- ============================================================================

-- ---- lock down direct writes ----------------------------------------------
revoke insert, update, delete on public.element_participants from authenticated, anon;
revoke insert, update, delete on public.trip_participants from authenticated, anon;

drop policy if exists "Users manage their own participation" on public.element_participants;
drop policy if exists "Users can view their own participation" on public.element_participants;
create policy "Users can view their own participation"
  on public.element_participants for select
  to authenticated
  using (participant_id = auth.uid());

-- ---- viewing vs participating ----------------------------------------------
-- is_element_member() (opted_in = true) stays the gate for voting, funding
-- and every population count. Viewing an element additionally allows
-- anyone in its scope who opted out — otherwise opting out would hide the
-- element and there'd be no way to opt back in.
create or replace function public.is_element_scoped(p_element_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_element_member(p_element_id) or exists (
    select 1 from public.element_participants ep
    where ep.element_id = p_element_id and ep.participant_id = auth.uid()
  );
$$;
grant execute on function public.is_element_scoped(uuid) to authenticated;

drop policy if exists "Trip members can view elements" on public.trip_elements;
create policy "Trip members can view elements"
  on public.trip_elements for select
  to authenticated
  using (public.is_element_scoped(id));

drop policy if exists "Trip members can view options" on public.element_options;
create policy "Trip members can view options"
  on public.element_options for select
  to authenticated
  using (exists (
    select 1 from public.trip_elements e
    where e.id = element_options.element_id and public.is_element_scoped(e.id)
  ));

-- ---- shared guard ------------------------------------------------------------
-- Why p_user_id can't leave / be removed from p_trip_id right now, or null.
-- Only non-superseded requests not already marked refunded count.
create or replace function public.participant_departure_block(p_trip_id uuid, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  select e.label into v_label
    from public.funding_contributions fc
    join public.funding_requests fr on fr.id = fc.funding_request_id
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    join public.trip_elements e on e.id = fre.element_id
    where fr.trip_id = p_trip_id and fc.contributor_id = p_user_id
      and fc.refunded_at is null and fr.refunded_at is null and fr.status <> 'superseded'
    limit 1;
  if v_label is not null then
    return format('has an unsettled payment on "%s" — it needs to be refunded first', v_label);
  end if;

  select e.label into v_label
    from public.funding_mandates m
    join public.funding_requests fr on fr.id = m.funding_request_id
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    join public.trip_elements e on e.id = fre.element_id
    where fr.trip_id = p_trip_id and m.participant_id = p_user_id
      and m.status in ('active', 'charging', 'charge_succeeded')
      and fr.refunded_at is null and fr.status <> 'superseded'
    limit 1;
  if v_label is not null then
    return format('has a payment authorization on "%s" — it needs to be canceled first', v_label);
  end if;

  select e.label into v_label
    from public.element_participants ep
    join public.trip_elements e on e.id = ep.element_id
    join public.funding_request_elements fre on fre.element_id = e.id
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where e.trip_id = p_trip_id and ep.participant_id = p_user_id and ep.opted_in = true
      and e.state = 'locked'
      and fr.status in ('collecting', 'ready_to_purchase', 'booked')
      and fr.refunded_at is null
    limit 1;
  if v_label is not null then
    return format('is part of "%s", which is already locked with its cost split — the organizer needs to sort that out first', v_label);
  end if;

  return null;
end;
$$;
revoke execute on function public.participant_departure_block(uuid, uuid) from public, anon, authenticated;

-- Removes a person's footprint on a trip: votes, element scope, pending
-- (not-yet-authorized) mandates, roster row. Caller does all checks.
create or replace function public.remove_trip_participation(p_trip_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.votes v
    using public.element_options o, public.trip_elements e
    where v.option_id = o.id and o.element_id = e.id
      and e.trip_id = p_trip_id and v.participant_id = p_user_id;

  update public.funding_mandates m
    set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'left the trip'
    from public.funding_requests fr
    where m.funding_request_id = fr.id and fr.trip_id = p_trip_id
      and m.participant_id = p_user_id and m.status = 'pending';

  delete from public.element_participants ep
    using public.trip_elements e
    where ep.element_id = e.id and e.trip_id = p_trip_id and ep.participant_id = p_user_id;

  delete from public.trip_participants where trip_id = p_trip_id and user_id = p_user_id;
end;
$$;
revoke execute on function public.remove_trip_participation(uuid, uuid) from public, anon, authenticated;

-- ---- leave / remove -----------------------------------------------------------
create or replace function public.leave_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
  v_block text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    raise exception 'trip not found';
  end if;
  if v_organizer_id = v_uid then
    raise exception 'the organizer can''t leave their own trip';
  end if;
  if not exists (select 1 from public.trip_participants where trip_id = p_trip_id and user_id = v_uid) then
    raise exception 'you''re not on this trip';
  end if;

  v_block := public.participant_departure_block(p_trip_id, v_uid);
  if v_block is not null then
    raise exception 'You can''t leave yet — you %.', v_block;
  end if;

  perform public.remove_trip_participation(p_trip_id, v_uid);
end;
$$;
grant execute on function public.leave_trip(uuid) to authenticated;

create or replace function public.remove_participant(p_trip_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
  v_block text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can remove people';
  end if;
  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if p_user_id = v_organizer_id then
    raise exception 'the organizer can''t be removed from their own trip';
  end if;
  if p_user_id = v_uid then
    raise exception 'use Leave trip to remove yourself';
  end if;
  if not exists (select 1 from public.trip_participants where trip_id = p_trip_id and user_id = p_user_id) then
    raise exception 'that person isn''t on this trip';
  end if;

  v_block := public.participant_departure_block(p_trip_id, p_user_id);
  if v_block is not null then
    raise exception 'Can''t remove them yet — this person %.', v_block;
  end if;

  perform public.remove_trip_participation(p_trip_id, p_user_id);
end;
$$;
grant execute on function public.remove_participant(uuid, uuid) to authenticated;

-- ---- element opt in / out ---------------------------------------------------
-- The element plus, for a bundled one, every other member of its bundle.
create or replace function public.element_scope_group(p_element_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(e.id), array[p_element_id])
  from public.trip_elements e
  join public.trip_elements me on me.id = p_element_id
  where (me.bundle_group_id is null and e.id = me.id)
     or (me.bundle_group_id is not null
         and (e.bundle_group_id = me.bundle_group_id or e.id = me.bundle_group_id));
$$;
revoke execute on function public.element_scope_group(uuid) from public, anon, authenticated;

-- Applies an opt-in/out for one person across the element's scope group.
-- Caller does authority checks; this does the pre-lock check + effects.
create or replace function public.apply_element_opt_in(p_element_id uuid, p_user_id uuid, p_opted_in boolean, p_allow_insert boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid[] := public.element_scope_group(p_element_id);
begin
  if exists (select 1 from public.trip_elements where id = any(v_group) and state <> 'open') then
    if array_length(v_group, 1) > 1 then
      raise exception 'part of this bundle is already locked — scope can only change while every element in it is open';
    end if;
    raise exception 'this is already locked — who''s in can only change while it''s open';
  end if;

  if p_opted_in and p_allow_insert then
    insert into public.element_participants (element_id, participant_id, opted_in)
    select g, p_user_id, true from unnest(v_group) as g
    on conflict (element_id, participant_id) do update set opted_in = true;
  else
    update public.element_participants
      set opted_in = p_opted_in
      where element_id = any(v_group) and participant_id = p_user_id;
  end if;

  if not p_opted_in then
    -- Someone who's out shouldn't still steer which option gets locked.
    delete from public.votes v
      using public.element_options o
      where v.option_id = o.id and o.element_id = any(v_group) and v.participant_id = p_user_id;
  end if;
end;
$$;
revoke execute on function public.apply_element_opt_in(uuid, uuid, boolean, boolean) from public, anon, authenticated;

-- Self-serve: only for an element you're already in scope for.
create or replace function public.set_element_opt_in(p_element_id uuid, p_opted_in boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not exists (
    select 1 from public.element_participants where element_id = p_element_id and participant_id = v_uid
  ) then
    raise exception 'you''re not part of this element';
  end if;
  perform public.apply_element_opt_in(p_element_id, v_uid, p_opted_in, false);
end;
$$;
grant execute on function public.set_element_opt_in(uuid, boolean) to authenticated;

-- Organizer/co-organizer: add anyone on the trip to, or take them out of,
-- an open element's scope.
create or replace function public.set_element_participant(p_element_id uuid, p_user_id uuid, p_opted_in boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip_id uuid;
  v_organizer_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select e.trip_id, t.organizer_id into v_trip_id, v_organizer_id
    from public.trip_elements e join public.trips t on t.id = e.trip_id
    where e.id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can change who''s in';
  end if;
  if p_user_id <> v_organizer_id and not exists (
    select 1 from public.trip_participants where trip_id = v_trip_id and user_id = p_user_id
  ) then
    raise exception 'that person isn''t on this trip';
  end if;
  perform public.apply_element_opt_in(p_element_id, p_user_id, p_opted_in, true);
end;
$$;
grant execute on function public.set_element_participant(uuid, uuid, boolean) to authenticated;

-- ---- join_trip: late joiners only land in OPEN "Everyone" elements --------
create or replace function public.join_trip(p_trip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
  v_inserted int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    return false; -- trip doesn't exist; nothing to do
  end if;
  if v_organizer_id = v_uid then
    return false; -- the organizer isn't a "participant" in the headcount sense
  end if;

  insert into public.trip_participants (trip_id, user_id)
  values (p_trip_id, v_uid)
  on conflict (trip_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;

  -- Open only: a locked element's cost split is already fixed. An existing
  -- row (e.g. someone who opted out) is left exactly as it is.
  insert into public.element_participants (element_id, participant_id, opted_in)
  select id, v_uid, true
  from public.trip_elements
  where trip_id = p_trip_id and scope_all = true and state = 'open'
  on conflict (element_id, participant_id) do nothing;

  return v_inserted > 0;
end;
$$;

notify pgrst, 'reload schema';

-- ---- follow-ups found in testing --------------------------------------------
-- Guard messages are noun phrases so callers can say "you still have …" /
-- "they still have …" (the first version read "you is part of …").
create or replace function public.participant_departure_block(p_trip_id uuid, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  select e.label into v_label
    from public.funding_contributions fc
    join public.funding_requests fr on fr.id = fc.funding_request_id
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    join public.trip_elements e on e.id = fre.element_id
    where fr.trip_id = p_trip_id and fc.contributor_id = p_user_id
      and fc.refunded_at is null and fr.refunded_at is null and fr.status <> 'superseded'
    limit 1;
  if v_label is not null then
    return format('an unsettled payment on "%s" — it needs to be refunded first', v_label);
  end if;

  select e.label into v_label
    from public.funding_mandates m
    join public.funding_requests fr on fr.id = m.funding_request_id
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    join public.trip_elements e on e.id = fre.element_id
    where fr.trip_id = p_trip_id and m.participant_id = p_user_id
      and m.status in ('active', 'charging', 'charge_succeeded')
      and fr.refunded_at is null and fr.status <> 'superseded'
    limit 1;
  if v_label is not null then
    return format('a payment authorization on "%s" — it needs to be canceled first', v_label);
  end if;

  select e.label into v_label
    from public.element_participants ep
    join public.trip_elements e on e.id = ep.element_id
    join public.funding_request_elements fre on fre.element_id = e.id
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where e.trip_id = p_trip_id and ep.participant_id = p_user_id and ep.opted_in = true
      and e.state = 'locked'
      and fr.status in ('collecting', 'ready_to_purchase', 'booked')
      and fr.refunded_at is null
    limit 1;
  if v_label is not null then
    return format('a share in "%s", which is already locked with its cost split — the organizer needs to settle that first', v_label);
  end if;

  return null;
end;
$$;

create or replace function public.leave_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
  v_block text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    raise exception 'trip not found';
  end if;
  if v_organizer_id = v_uid then
    raise exception 'the organizer can''t leave their own trip';
  end if;
  if not exists (select 1 from public.trip_participants where trip_id = p_trip_id and user_id = v_uid) then
    raise exception 'you''re not on this trip';
  end if;

  v_block := public.participant_departure_block(p_trip_id, v_uid);
  if v_block is not null then
    raise exception 'You can''t leave yet — you still have %.', v_block;
  end if;

  perform public.remove_trip_participation(p_trip_id, v_uid);
end;
$$;

create or replace function public.remove_participant(p_trip_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
  v_block text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can remove people';
  end if;
  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if p_user_id = v_organizer_id then
    raise exception 'the organizer can''t be removed from their own trip';
  end if;
  if p_user_id = v_uid then
    raise exception 'use Leave trip to remove yourself';
  end if;
  if not exists (select 1 from public.trip_participants where trip_id = p_trip_id and user_id = p_user_id) then
    raise exception 'that person isn''t on this trip';
  end if;

  v_block := public.participant_departure_block(p_trip_id, p_user_id);
  if v_block is not null then
    raise exception 'Can''t remove them yet — they still have %.', v_block;
  end if;

  perform public.remove_trip_participation(p_trip_id, p_user_id);
end;
$$;

-- An opted-out organizer is still an "element member" (organizers manage
-- everything) but shouldn't rank options for a plan they're not part of.
create or replace function public.cast_votes(p_element_id uuid, p_option_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_state text;
  v_voting_deadline timestamptz;
  v_count int;
  v_distinct_count int;
  v_bad_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select state, voting_deadline into v_state, v_voting_deadline
    from public.trip_elements where id = p_element_id;

  if v_state is null then
    raise exception 'element not found';
  end if;
  if not public.is_element_member(p_element_id) then
    raise exception 'not a member of this element';
  end if;
  if exists (
    select 1 from public.element_participants
    where element_id = p_element_id and participant_id = v_uid and opted_in = false
  ) then
    raise exception 'you''ve opted out of this — opt back in to vote';
  end if;
  if v_state <> 'open' then
    raise exception 'element is not open for voting';
  end if;
  if v_voting_deadline is not null and v_voting_deadline <= now() then
    raise exception 'voting has closed for this element';
  end if;

  v_count := coalesce(array_length(p_option_ids, 1), 0);
  if v_count > 3 then
    raise exception 'rank at most 3 options';
  end if;

  select count(distinct x) into v_distinct_count from unnest(p_option_ids) as x;
  if v_distinct_count <> v_count then
    raise exception 'duplicate option in ranking';
  end if;

  select count(*) into v_bad_count
    from unnest(p_option_ids) as opt_id
    where not exists (
      select 1 from public.element_options eo
      where eo.id = opt_id and eo.element_id = p_element_id
    );
  if v_bad_count > 0 then
    raise exception 'one or more options do not belong to this element';
  end if;

  delete from public.votes
    where participant_id = v_uid
      and option_id in (select id from public.element_options where element_id = p_element_id);

  if v_count > 0 then
    insert into public.votes (option_id, participant_id, rank)
    select p_option_ids[i], v_uid, i
    from generate_subscripts(p_option_ids, 1) as i;
  end if;
end;
$$;

notify pgrst, 'reload schema';
