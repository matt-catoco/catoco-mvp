-- Analytics tracking (founder, 2026-10-23).
--
-- 1. trip_elements.locked_at: set whenever an element becomes locked (lock_element,
--    resolve_due_elements' auto-lock, create_element "lock it in now", the
--    runner-up switch) and cleared when it reopens. Done with a trigger so every
--    lock path is covered without editing each function.
-- 2. profiles.is_internal: team accounts, excluded from analytics.
-- 3. Soft delete: trips.deleted_at / trip_elements.deleted_at. delete_trip and
--    delete_element set them instead of deleting. Deleted rows are hidden by the
--    RLS policies and by the membership helpers (is_trip_member,
--    is_trip_organizer, is_element_member, is_element_scoped) that nearly every
--    RLS policy and RPC already checks; the background functions that scan
--    elements filter them explicitly. A deleted trip's still-collecting funding
--    rounds are superseded, so no job emails or charges for them.
-- 4. trips.invites_sent_at: the first time invites_sent becomes true (trigger).
-- 5. funding_requests.funded_at: the first time status becomes ready_to_purchase.
-- 6. trip_participants.left_at: leave_trip / remove_participant keep the row and
--    set left_at (drop-outs stay visible); every read of members filters
--    left_at is null. Joining again clears it.
--
-- New functions in this file are trigger functions only (no grants needed);
-- replaced functions keep their existing grants.

-- ---- columns ------------------------------------------------------------------
alter table public.trip_elements add column if not exists locked_at timestamptz;
alter table public.trip_elements add column if not exists deleted_at timestamptz;
alter table public.trips add column if not exists deleted_at timestamptz;
alter table public.trips add column if not exists invites_sent_at timestamptz;
alter table public.profiles add column if not exists is_internal boolean not null default false;
alter table public.funding_requests add column if not exists funded_at timestamptz;
alter table public.trip_participants add column if not exists left_at timestamptz;

update public.trips set invites_sent_at = created_at where invites_sent and invites_sent_at is null;

-- ---- 1. locked_at -------------------------------------------------------------
create or replace function public.track_element_locked_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.state = 'locked' then
    if tg_op = 'INSERT'
       or old.state is distinct from 'locked'
       or (old.locked_option_id is not null and new.locked_option_id is distinct from old.locked_option_id) then
      new.locked_at := now();
    end if;
  else
    new.locked_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trip_elements_track_locked_at on public.trip_elements;
create trigger trip_elements_track_locked_at
  before insert or update of state, locked_option_id on public.trip_elements
  for each row execute function public.track_element_locked_at();

-- ---- 4. invites_sent_at -------------------------------------------------------
create or replace function public.track_trip_invites_sent_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.invites_sent and new.invites_sent_at is null then
    new.invites_sent_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trips_track_invites_sent_at on public.trips;
create trigger trips_track_invites_sent_at
  before insert or update of invites_sent on public.trips
  for each row execute function public.track_trip_invites_sent_at();

-- ---- 5. funded_at -------------------------------------------------------------
create or replace function public.track_funding_funded_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status = 'ready_to_purchase' and new.funded_at is null then
    new.funded_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists funding_requests_track_funded_at on public.funding_requests;
create trigger funding_requests_track_funded_at
  before insert or update of status on public.funding_requests
  for each row execute function public.track_funding_funded_at();

-- ---- membership helpers: deleted trips/elements and people who left -----------
create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip_id and t.deleted_at is null
      and (t.organizer_id = auth.uid()
           or exists (select 1 from public.trip_participants tp
                      where tp.trip_id = t.id and tp.user_id = auth.uid() and tp.left_at is null))
  );
$$;

create or replace function public.is_trip_organizer(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip_id and t.deleted_at is null
      and (t.organizer_id = auth.uid()
           or exists (select 1 from public.trip_participants tp
                      where tp.trip_id = t.id and tp.user_id = auth.uid()
                        and tp.role = 'co_organizer' and tp.left_at is null))
  );
$$;

create or replace function public.is_element_member(p_element_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_elements e
    where e.id = p_element_id and e.deleted_at is null
      and (public.is_trip_organizer(e.trip_id)
           or exists (select 1 from public.element_participants ep
                      where ep.element_id = e.id and ep.participant_id = auth.uid() and ep.opted_in = true))
  );
$$;

create or replace function public.is_element_scoped(p_element_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_element_member(p_element_id) or exists (
    select 1 from public.element_participants ep
    join public.trip_elements e on e.id = ep.element_id
    where ep.element_id = p_element_id and ep.participant_id = auth.uid() and e.deleted_at is null
  );
$$;

create or replace function public.users_share_trip(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips t
    where t.deleted_at is null
      and (t.organizer_id = p_a
           or exists (select 1 from public.trip_participants tp where tp.trip_id = t.id and tp.user_id = p_a and tp.left_at is null))
      and (t.organizer_id = p_b
           or exists (select 1 from public.trip_participants tp where tp.trip_id = t.id and tp.user_id = p_b and tp.left_at is null))
  );
$$;

create or replace function public.is_funding_request_organizer(p_funding_request_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.funding_requests f join public.trips t on t.id = f.trip_id
    where f.id = p_funding_request_id and t.deleted_at is null
      and (t.organizer_id = p_user_id or exists (
        select 1 from public.trip_participants tp
        where tp.trip_id = t.id and tp.user_id = p_user_id and tp.role = 'co_organizer' and tp.left_at is null))
  );
$$;

create or replace function public.trip_traveller_count(p_trip_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select 1 + (select count(*)::int from public.trip_participants where trip_id = p_trip_id and left_at is null);
$$;

create or replace function public.trip_join_status(p_trip_id uuid)
returns table (name text, status text)
language sql
stable
security definer
set search_path = public
as $$
  select t.name,
    case
      when t.organizer_id = auth.uid()
        or exists (select 1 from public.trip_participants tp where tp.trip_id = t.id and tp.user_id = auth.uid() and tp.left_at is null)
        then 'member'
      when t.max_participants is not null and not t.allow_over_max
        and public.trip_traveller_count(t.id) >= t.max_participants
        then 'full'
      else 'open'
    end
  from public.trips t
  where t.id = p_trip_id and t.deleted_at is null;
$$;

create or replace function public.get_trip_roster(p_trip_id uuid)
returns table (user_id uuid, display_name text, is_organizer boolean, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select public.is_trip_organizer(p_trip_id)
           or coalesce((select t.view_all_participants from public.trips t where t.id = p_trip_id), true) as see_all
  )
  select t.organizer_id as user_id, p.display_name, true as is_organizer,
         'organizer'::text as role, null::timestamptz as joined_at
  from public.trips t
  left join public.profiles p on p.id = t.organizer_id
  where t.id = p_trip_id and public.is_trip_member(p_trip_id)
  union all
  select tp.user_id,
         case when (select see_all from v) or tp.user_id = auth.uid() then p.display_name end,
         false,
         case when (select see_all from v) or tp.user_id = auth.uid() then tp.role else 'participant' end,
         tp.joined_at
  from public.trip_participants tp
  left join public.profiles p on p.id = tp.user_id
  where tp.trip_id = p_trip_id and tp.left_at is null and public.is_trip_member(p_trip_id)
  order by joined_at nulls first;
$$;

-- ---- 6. leaving keeps the row ---------------------------------------------------
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

  -- Kept (with left_at) so drop-outs stay visible to analytics.
  update public.trip_participants set left_at = now()
    where trip_id = p_trip_id and user_id = p_user_id and left_at is null;
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
  select organizer_id into v_organizer_id from public.trips where id = p_trip_id and deleted_at is null;
  if v_organizer_id is null then
    raise exception 'trip not found';
  end if;
  if v_organizer_id = v_uid then
    raise exception 'the organizer can''t leave their own trip';
  end if;
  if not exists (select 1 from public.trip_participants where trip_id = p_trip_id and user_id = v_uid and left_at is null) then
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
  if not exists (select 1 from public.trip_participants where trip_id = p_trip_id and user_id = p_user_id and left_at is null) then
    raise exception 'that person isn''t on this trip';
  end if;

  v_block := public.participant_departure_block(p_trip_id, p_user_id);
  if v_block is not null then
    raise exception 'Can''t remove them yet — they still have %.', v_block;
  end if;

  perform public.remove_trip_participation(p_trip_id, p_user_id);
end;
$$;

create or replace function public.join_trip(p_trip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip record;
  v_inserted int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select organizer_id, max_participants, allow_over_max into v_trip
    from public.trips where id = p_trip_id and deleted_at is null;
  if v_trip.organizer_id is null then
    return false;
  end if;
  if v_trip.organizer_id = v_uid then
    return false;
  end if;

  if not exists (select 1 from public.trip_participants where trip_id = p_trip_id and user_id = v_uid and left_at is null)
     and v_trip.max_participants is not null and not v_trip.allow_over_max
     and public.trip_traveller_count(p_trip_id) >= v_trip.max_participants then
    return false;
  end if;

  -- New, or back after leaving (a fresh membership: participant role, new join time).
  insert into public.trip_participants (trip_id, user_id)
  values (p_trip_id, v_uid)
  on conflict (trip_id, user_id) do update
    set left_at = null, joined_at = now(), role = 'participant'
    where public.trip_participants.left_at is not null;
  get diagnostics v_inserted = row_count;

  insert into public.element_participants (element_id, participant_id, opted_in)
  select id, v_uid, true
  from public.trip_elements
  where trip_id = p_trip_id and scope_all = true and state = 'open' and deleted_at is null
  on conflict (element_id, participant_id) do nothing;

  return v_inserted > 0;
end;
$$;

create or replace function public.set_participant_role(p_trip_id uuid, p_user_id uuid, p_role text)
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
  if p_role not in ('participant', 'co_organizer') then
    raise exception 'unknown role: %', p_role;
  end if;
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can assign roles';
  end if;
  if not exists (
    select 1 from public.trip_participants where trip_id = p_trip_id and user_id = p_user_id and left_at is null
  ) then
    raise exception 'that user is not on this trip''s roster';
  end if;

  update public.trip_participants set role = p_role
    where trip_id = p_trip_id and user_id = p_user_id and left_at is null;
end;
$$;

create or replace function public.reassign_purchaser(p_funding_request_id uuid, p_purchaser_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.funding_requests where id = p_funding_request_id;
  if v_trip_id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can reassign the purchaser';
  end if;
  if not exists (
    select 1 from public.trip_participants where trip_id = v_trip_id and user_id = p_purchaser_id and left_at is null
    union
    select 1 from public.trips where id = v_trip_id and organizer_id = p_purchaser_id
  ) then
    raise exception 'that person is not on this trip';
  end if;

  update public.funding_requests set purchaser_id = p_purchaser_id where id = p_funding_request_id;
end;
$$;

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
    where e.id = p_element_id and e.deleted_at is null;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can change who''s in';
  end if;
  if p_user_id <> v_organizer_id and not exists (
    select 1 from public.trip_participants where trip_id = v_trip_id and user_id = p_user_id and left_at is null
  ) then
    raise exception 'that person isn''t on this trip';
  end if;
  perform public.apply_element_opt_in(p_element_id, p_user_id, p_opted_in, true);
end;
$$;

create or replace function public.create_element(
  p_trip_id uuid, p_type text, p_label text, p_metadata jsonb default '{}'::jsonb,
  p_scope_user_ids uuid[] default null::uuid[], p_state text default 'open'::text,
  p_options_deadline timestamptz default null::timestamptz, p_voting_deadline timestamptz default null::timestamptz,
  p_options jsonb default '[]'::jsonb, p_derived_from_element_id uuid default null::uuid,
  p_bundle_group_id uuid default null::uuid, p_start_bundle boolean default false, p_bundle_continues boolean default false)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
  v_is_organizer boolean;
  v_allow_elements boolean;
  v_allow_subgroups boolean;
  v_scope uuid[];
  v_scope_all boolean;
  v_bad_count int;
  v_el_id uuid;
  v_state text := coalesce(p_state, 'open');
  v_options_deadline timestamptz := p_options_deadline;
  v_voting_deadline timestamptz := p_voting_deadline;
  v_opt jsonb;
  v_opt_id uuid;
  v_opt_count int := jsonb_array_length(coalesce(p_options, '[]'::jsonb));
  v_first_opt_id uuid;
  v_locked_via text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'element needs a label';
  end if;
  if v_state not in ('locked', 'open') then
    raise exception 'bad element state: %', v_state;
  end if;
  if p_start_bundle and p_bundle_group_id is not null then
    raise exception 'an element cannot both start a new bundle and join an existing one';
  end if;

  select organizer_id, allow_participant_elements, allow_participant_subgroups
    into v_organizer_id, v_allow_elements, v_allow_subgroups
    from public.trips where id = p_trip_id and deleted_at is null;
  if v_organizer_id is null then
    raise exception 'trip not found';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'not a member of this trip';
  end if;

  v_is_organizer := public.is_trip_organizer(p_trip_id);

  if not v_is_organizer and not v_allow_elements and p_derived_from_element_id is null then
    raise exception 'the organizer has turned off adding elements for participants on this trip';
  end if;

  if not (v_is_organizer or v_allow_subgroups)
     or p_scope_user_ids is null or array_length(p_scope_user_ids, 1) is null then
    v_scope_all := true;
    select array_agg(distinct s.u) into v_scope
      from (
        select tp.user_id as u from public.trip_participants tp where tp.trip_id = p_trip_id and tp.left_at is null
        union select v_organizer_id
      ) s;
  else
    v_scope_all := false;
    select count(*) into v_bad_count
      from unnest(p_scope_user_ids) as uid
      where uid <> v_organizer_id
        and not exists (
          select 1 from public.trip_participants tp
          where tp.trip_id = p_trip_id and tp.user_id = uid and tp.left_at is null
        );
    if v_bad_count > 0 then
      raise exception 'scope includes someone not on this trip';
    end if;
    v_scope := p_scope_user_ids;
  end if;

  if v_uid <> v_organizer_id and not (v_uid = any(v_scope)) then
    v_scope := array_append(v_scope, v_uid);
  end if;

  if v_state = 'locked' then
    if not (
      v_is_organizer
      or (not v_scope_all and array_length(v_scope, 1) = 1 and v_scope[1] = v_uid)
      or (v_allow_subgroups and not v_scope_all)
    ) then
      v_state := 'open';
    end if;
  end if;

  if v_state = 'locked' and v_opt_count <> 1 then
    raise exception 'a locked element needs exactly one value';
  end if;
  if v_state = 'open' and v_options_deadline is not null and v_voting_deadline is not null
     and v_options_deadline > v_voting_deadline then
    raise exception 'options_deadline must be on or before voting_deadline';
  end if;
  if v_state = 'locked' then
    v_options_deadline := null;
    v_voting_deadline := null;
    v_locked_via := case when v_is_organizer then 'organizer' else 'creator' end;
  end if;

  insert into public.trip_elements
    (trip_id, type, label, metadata, state, options_deadline, voting_deadline, created_by, locked_via, scope_all, derived_from_element_id, bundle_group_id)
  values
    (p_trip_id, p_type, btrim(p_label), coalesce(p_metadata, '{}'::jsonb), v_state,
     v_options_deadline, v_voting_deadline, v_uid, v_locked_via, v_scope_all, p_derived_from_element_id, p_bundle_group_id)
  returning id into v_el_id;

  if p_start_bundle then
    update public.trip_elements set bundle_group_id = v_el_id where id = v_el_id;
  end if;

  v_first_opt_id := null;
  for v_opt in select value from jsonb_array_elements(coalesce(p_options, '[]'::jsonb))
  loop
    insert into public.element_options (element_id, value, source, proposed_by, unit_price, pricing_basis)
    values (
      v_el_id, v_opt->'value', 'user_proposed', v_uid,
      nullif(v_opt->>'unit_price', '')::numeric,
      nullif(v_opt->>'pricing_basis', '')
    )
    returning id into v_opt_id;
    if v_first_opt_id is null then
      v_first_opt_id := v_opt_id;
    end if;
  end loop;

  insert into public.element_participants (element_id, participant_id, opted_in)
  select v_el_id, s, true from unnest(v_scope) as s
  on conflict (element_id, participant_id) do nothing;

  if v_state = 'locked' then
    update public.trip_elements set locked_option_id = v_first_opt_id where id = v_el_id;
    if not p_bundle_continues then
      perform public.create_funding_request_for_element(v_el_id);
    end if;
    if p_type = 'dates' then
      perform public.backfill_funding_for_dates(p_trip_id);
    end if;
  end if;

  return v_el_id;
end;
$$;

-- ---- 3. soft delete -------------------------------------------------------------
create or replace function public.delete_element(p_element_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_created_by uuid;
  v_fr_id uuid;
begin
  select trip_id, created_by into v_trip_id, v_created_by
    from public.trip_elements where id = p_element_id and deleted_at is null;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not (public.is_trip_organizer(v_trip_id) or auth.uid() = v_created_by) then
    raise exception 'only the organizer, a co-organizer, or the element''s creator can delete it';
  end if;

  if exists (
    select 1 from public.funding_request_elements fre
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = p_element_id and fr.status <> 'superseded'
      and (fr.charge_status = 'charging' or public.funding_request_held_stripe_count(fr.id) > 0)
  ) then
    raise exception 'people have paid for this — refund everyone before deleting it';
  end if;

  for v_fr_id in
    select fre.funding_request_id
    from public.funding_request_elements fre
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = p_element_id
      and fr.status <> 'superseded'
  loop
    if (
      select count(*) from public.funding_request_elements fre2
      join public.trip_elements e2 on e2.id = fre2.element_id
      where fre2.funding_request_id = v_fr_id and fre2.element_id <> p_element_id and e2.deleted_at is null
    ) = 0 then
      update public.funding_requests set status = 'superseded' where id = v_fr_id;
      update public.funding_mandates
        set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'element deleted'
        where funding_request_id = v_fr_id and status in ('pending', 'active');
    end if;
  end loop;

  update public.trip_elements set deleted_at = now() where id = p_element_id;
end;
$$;

create or replace function public.delete_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organizer_id uuid;
  v_blocking_labels text;
begin
  select organizer_id into v_organizer_id from public.trips where id = p_trip_id and deleted_at is null;
  if v_organizer_id is null then
    raise exception 'trip not found';
  end if;
  if auth.uid() <> v_organizer_id then
    raise exception 'only the organizer can delete this trip';
  end if;

  select string_agg(distinct e.label, ', ' order by e.label)
    into v_blocking_labels
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    join public.trip_elements e on e.id = fre.element_id
    where fr.trip_id = p_trip_id
      and fr.status <> 'superseded'
      and fr.refunded_at is null
      and (
        fr.status in ('ready_to_purchase', 'booked')
        or fr.charge_status = 'charging'
        or exists (
          select 1 from public.funding_contributions fc
          where fc.funding_request_id = fr.id and fc.refunded_at is null
        )
      );

  if v_blocking_labels is not null then
    raise exception 'Can''t delete — these elements still have unrefunded funding: %. Refund them first (Refund everyone on each element).', v_blocking_labels;
  end if;

  -- Rounds still collecting (no money in) stop: no reminders, charges or emails.
  update public.funding_mandates m
    set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'trip deleted'
    from public.funding_requests fr
    where m.funding_request_id = fr.id and fr.trip_id = p_trip_id
      and fr.status = 'collecting' and m.status in ('pending', 'active');
  update public.funding_requests set status = 'superseded'
    where trip_id = p_trip_id and status = 'collecting';

  update public.trip_elements set deleted_at = now() where trip_id = p_trip_id and deleted_at is null;
  update public.trips set deleted_at = now() where id = p_trip_id;
end;
$$;

-- ---- background scans skip deleted elements -------------------------------------
create or replace function public.backfill_funding_for_dates(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_el record;
begin
  for v_el in
    select e.id
    from public.trip_elements e
    join public.element_options o on o.id = e.locked_option_id
    where e.trip_id = p_trip_id
      and e.deleted_at is null
      and e.state = 'locked'
      and o.pricing_basis = 'per_night'
      and not exists (
        select 1 from public.funding_request_elements fre
        join public.funding_requests fr on fr.id = fre.funding_request_id
        where fre.element_id = e.id and fr.status <> 'superseded'
      )
  loop
    perform public.create_funding_request_for_element(v_el.id);
  end loop;
end;
$$;

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
  where e.deleted_at is null
    and ((me.bundle_group_id is null and e.id = me.id)
     or (me.bundle_group_id is not null
         and (e.bundle_group_id = me.bundle_group_id or e.id = me.bundle_group_id)));
$$;

create or replace function public.resolve_due_elements(p_trip_id uuid)
returns table (element_id uuid, element_type text, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_el record;
  v_opt_count int;
  v_top_score bigint;
  v_tie_count int;
  v_winner_option_id uuid;
begin
  for v_el in
    select id, type, tie_notified, empty_notified
    from public.trip_elements
    where trip_id = p_trip_id
      and deleted_at is null
      and state = 'open'
      and voting_deadline is not null
      and voting_deadline <= now()
  loop
    select count(*) into v_opt_count
      from public.element_options where element_options.element_id = v_el.id;

    if v_opt_count = 0 then
      if not v_el.empty_notified then
        update public.trip_elements set empty_notified = true where id = v_el.id;
        element_id := v_el.id;
        element_type := v_el.type;
        reason := 'empty';
        return next;
      end if;
      continue;
    end if;

    if v_opt_count = 1 then
      select eo.id into v_winner_option_id
        from public.element_options eo where eo.element_id = v_el.id;
    else
      select bs.score into v_top_score
        from public.borda_scores(v_el.id) bs order by bs.score desc limit 1;
      select count(*) into v_tie_count
        from public.borda_scores(v_el.id) bs where bs.score = v_top_score;

      if v_tie_count > 1 then
        if not v_el.tie_notified then
          update public.trip_elements set tie_notified = true where id = v_el.id;
          element_id := v_el.id;
          element_type := v_el.type;
          reason := 'tie';
          return next;
        end if;
        continue;
      end if;

      select bs.option_id into v_winner_option_id
        from public.borda_scores(v_el.id) bs order by bs.score desc limit 1;
    end if;

    update public.trip_elements
      set state = 'locked',
          locked_option_id = v_winner_option_id,
          locked_via = 'vote',
          options_deadline = null,
          voting_deadline = null
      where id = v_el.id;

    perform public.create_funding_request_for_element(v_el.id);
    if v_el.type = 'dates' then
      perform public.backfill_funding_for_dates(p_trip_id);
    end if;
  end loop;
end;
$$;

create or replace function public.list_elements_due_for_price_check()
returns table (element_id uuid, stage text, option_id uuid, value jsonb, unit_price numeric, pricing_basis text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, 'submission'::text, o.id, o.value, o.unit_price, o.pricing_basis
  from public.trip_elements e
  join public.element_options o on o.element_id = e.id
  where e.deleted_at is null and e.state = 'open'
    and e.options_deadline is not null and e.options_deadline <= now()
    and o.value->>'vendor_source' in ('duffel', 'liteapi', 'viator', 'hotelbeds', 'hotelbeds_activities', 'hotelbeds_transfers')
    and (e.last_price_check_at is null or e.last_price_check_at < e.options_deadline)

  union all

  select e.id, 'voting'::text, lead.option_id, lead.value, lead.unit_price, lead.pricing_basis
  from public.trip_elements e
  cross join lateral (
    select o.id as option_id, o.value, o.unit_price, o.pricing_basis
    from public.element_options o
    left join (
      select v.option_id, count(*) filter (where v.rank = 1) as first_choice, count(*) as votes
      from public.votes v group by v.option_id
    ) vs on vs.option_id = o.id
    where o.element_id = e.id and o.value->>'vendor_source' in ('duffel', 'liteapi', 'viator', 'hotelbeds', 'hotelbeds_activities', 'hotelbeds_transfers')
    order by coalesce(vs.first_choice, 0) desc, coalesce(vs.votes, 0) desc, o.created_at
    limit 1
  ) lead
  where e.deleted_at is null and e.state = 'open'
    and e.voting_deadline is not null and e.voting_deadline > now()
    and (e.options_deadline is null or e.options_deadline <= now())
    and (e.options_deadline is null or e.last_price_check_at >= e.options_deadline)
    and (
      e.last_price_check_at is null
      or (e.voting_deadline - now() > interval '7 days' and e.last_price_check_at < now() - interval '6 days 23 hours')
      or (e.voting_deadline - now() <= interval '7 days' and e.last_price_check_at < now() - interval '23 hours')
    )

  union all

  select e.id, 'funding'::text, o.id, o.value, o.unit_price, o.pricing_basis
  from public.trip_elements e
  join public.element_options o on o.id = e.locked_option_id
  join public.funding_request_elements fre on fre.element_id = e.id
  join public.funding_requests fr on fr.id = fre.funding_request_id
  where e.deleted_at is null and e.state = 'locked' and fr.status = 'collecting' and fr.charge_status is null
    and o.value->>'vendor_source' in ('duffel', 'liteapi', 'viator', 'hotelbeds', 'hotelbeds_activities', 'hotelbeds_transfers')
    and fr.funding_deadline is not null and fr.funding_deadline > now()
    and (
      (fr.funding_deadline - now() > interval '48 hours'
        and (e.last_price_check_at is null or e.last_price_check_at < now() - interval '23 hours'))
      or (fr.funding_deadline - now() <= interval '48 hours'
        and (e.last_price_check_at is null or e.last_price_check_at < now() - interval '50 minutes'))
    );
$$;

-- ---- RLS: hide deleted trips/elements and people who left -------------------------
drop policy if exists "Organizer manages own trips" on public.trips;
create policy "Organizer manages own trips" on public.trips
  for all using (organizer_id = auth.uid() and deleted_at is null)
  with check (organizer_id = auth.uid() and deleted_at is null);

drop policy if exists "Organizer manages own trip elements" on public.trip_elements;
create policy "Organizer manages own trip elements" on public.trip_elements
  for all using (
    trip_elements.deleted_at is null
    and exists (select 1 from public.trips t
                where t.id = trip_elements.trip_id and t.organizer_id = auth.uid() and t.deleted_at is null)
  )
  with check (
    trip_elements.deleted_at is null
    and exists (select 1 from public.trips t
                where t.id = trip_elements.trip_id and t.organizer_id = auth.uid() and t.deleted_at is null)
  );

drop policy if exists "Trip members can view elements" on public.trip_elements;
create policy "Trip members can view elements" on public.trip_elements
  for select using (deleted_at is null and public.is_element_scoped(id));

drop policy if exists "Organizer manages own element options" on public.element_options;
create policy "Organizer manages own element options" on public.element_options
  for all using (exists (
    select 1 from public.trip_elements e join public.trips t on t.id = e.trip_id
    where e.id = element_options.element_id and t.organizer_id = auth.uid()
      and e.deleted_at is null and t.deleted_at is null))
  with check (exists (
    select 1 from public.trip_elements e join public.trips t on t.id = e.trip_id
    where e.id = element_options.element_id and t.organizer_id = auth.uid()
      and e.deleted_at is null and t.deleted_at is null));

drop policy if exists "Organizer can view trip participation" on public.element_participants;
create policy "Organizer can view trip participation" on public.element_participants
  for select using (exists (
    select 1 from public.trip_elements e join public.trips t on t.id = e.trip_id
    where e.id = element_participants.element_id and t.organizer_id = auth.uid()
      and e.deleted_at is null and t.deleted_at is null));

drop policy if exists "Organizer manages trip roster" on public.trip_participants;
create policy "Organizer manages trip roster" on public.trip_participants
  for all using (
    trip_participants.left_at is null
    and exists (select 1 from public.trips t
                where t.id = trip_participants.trip_id and t.organizer_id = auth.uid() and t.deleted_at is null)
  )
  with check (exists (select 1 from public.trips t
                      where t.id = trip_participants.trip_id and t.organizer_id = auth.uid() and t.deleted_at is null));

drop policy if exists "Users can view their own membership" on public.trip_participants;
create policy "Users can view their own membership" on public.trip_participants
  for select using (user_id = auth.uid() and left_at is null);
