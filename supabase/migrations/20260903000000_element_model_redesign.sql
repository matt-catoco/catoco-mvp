-- ============================================================================
-- Flow #3 — element model redesign: multi-instance, scoped, personalized
--
-- Overturns the periodic-table assumption (exactly one instance of each of
-- 8 fixed types, organizer-only creation, trip-wide visibility) built across
-- flow #2 and flow #3 batches 1-3. See the plan for full rationale. No real
-- trip data exists yet (confirmed) — this wipes existing trip rows rather
-- than trying to backfill the new required columns.
-- ============================================================================

-- ---- clean slate: confirmed disposable, avoids NOT NULL/backfill churn -----
delete from public.trips;

-- ---- trip_participants: the trip's actual roster ---------------------------
-- Replaces "membership via a fake `participants` element" — join_trip() now
-- inserts here directly. This is a real roster, not element-scoped.
create table if not exists public.trip_participants (
  trip_id uuid not null references public.trips(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);
alter table public.trip_participants enable row level security;
create index if not exists trip_participants_trip_id_idx on public.trip_participants (trip_id);

drop policy if exists "Organizer manages trip roster" on public.trip_participants;
create policy "Organizer manages trip roster"
  on public.trip_participants for all
  to authenticated
  using (exists (select 1 from public.trips t where t.id = trip_id and t.organizer_id = auth.uid()))
  with check (exists (select 1 from public.trips t where t.id = trip_id and t.organizer_id = auth.uid()));

drop policy if exists "Users can view their own membership" on public.trip_participants;
create policy "Users can view their own membership"
  on public.trip_participants for select
  to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.trip_participants to authenticated;

-- ---- trips: invites-sent moves here (was trip_elements.invites_sent on the
-- fake participants element) ------------------------------------------------
alter table public.trips add column if not exists invites_sent boolean not null default false;

-- ---- trip_elements: drop the fixed-slot shape -------------------------------
alter table public.trip_elements drop constraint if exists trip_elements_trip_id_type_key;
alter table public.trip_elements drop constraint if exists trip_elements_category_check;
alter table public.trip_elements drop column if exists category;
alter table public.trip_elements drop column if exists status;
alter table public.trip_elements drop column if exists invites_sent;

alter table public.trip_elements drop constraint if exists trip_elements_type_check;
alter table public.trip_elements
  add constraint trip_elements_type_check
    check (type in ('dates', 'destination', 'travel', 'accommodation', 'experience', 'dining'));

alter table public.trip_elements
  add column if not exists label text,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.trip_elements alter column label set not null;

comment on column public.trip_elements.label is
  'Free-text instance name (e.g. "Friday night dinner") — required because '
  'multiple instances of the same type can now exist on one trip.';
comment on column public.trip_elements.metadata is
  'Freeform, type-specific element-level fields (e.g. dining''s meal type, '
  'an optional date). Validated in TypeScript only (lib/trip-elements.ts) — '
  'no SQL-side shape enforcement, so adding/changing fields never needs a '
  'migration. Distinct from element_options.value, which is the per-'
  'candidate shape people vote on.';

-- ---- element_options: drop the rigid SQL-side validation mirror -----------
-- lib/trip-elements.ts is now the sole validator (freeform jsonb here).
drop trigger if exists enforce_option_value_trigger on public.element_options;
drop function if exists public.enforce_option_value();
drop function if exists public.validate_option_value(text, jsonb);

comment on column public.element_options.value is
  'jsonb shape varies by element type — validated in TypeScript only '
  '(lib/trip-elements.ts), no SQL-side mirror.';

-- ---- create_trip: retired — trip creation is now a bare shell (name only), -
-- a plain client insert against the existing organizer-owns-all policy.
drop function if exists public.create_trip(jsonb);

-- ---- is_trip_member: redefine against trip_participants -------------------
create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip_id and t.organizer_id = auth.uid()
  ) or exists (
    select 1 from public.trip_participants tp
    where tp.trip_id = p_trip_id and tp.user_id = auth.uid()
  );
$$;

-- ---- is_element_member: the new scope-based check, replacing trip-wide ----
-- membership for element/option/vote visibility and write eligibility.
create or replace function public.is_element_member(p_element_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_elements e
    join public.trips t on t.id = e.trip_id
    where e.id = p_element_id and t.organizer_id = auth.uid()
  ) or exists (
    select 1 from public.element_participants ep
    where ep.element_id = p_element_id
      and ep.participant_id = auth.uid()
      and ep.opted_in = true
  );
$$;

grant execute on function public.is_trip_member(uuid) to authenticated;
grant execute on function public.is_element_member(uuid) to authenticated;

-- ---- join_trip: records roster membership, not a fake-element opt-in ------
create or replace function public.join_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    return; -- trip doesn't exist; nothing to do
  end if;
  if v_organizer_id = v_uid then
    return; -- the organizer isn't a "participant" in the headcount sense
  end if;

  insert into public.trip_participants (trip_id, user_id)
  values (p_trip_id, v_uid)
  on conflict (trip_id, user_id) do nothing;
end;
$$;

revoke all on function public.join_trip(uuid) from public;
grant execute on function public.join_trip(uuid) to authenticated;

-- ---- create_element: the one place the locking-permission rule is ---------
-- enforced server-side. Any trip member can call this; a requested
-- state='locked' is only honored when the caller is the organizer, or the
-- scope is exactly {caller} (self-locking their own solo item) — otherwise
-- it's silently forced to 'open' so a client can't bypass the rule.
create or replace function public.create_element(
  p_trip_id uuid,
  p_type text,
  p_label text,
  p_metadata jsonb default '{}'::jsonb,
  p_scope_user_ids uuid[] default null,
  p_state text default 'open',
  p_options_deadline timestamptz default null,
  p_voting_deadline timestamptz default null,
  p_options jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
  v_scope uuid[];
  v_bad_count int;
  v_el_id uuid;
  v_state text := coalesce(p_state, 'open');
  v_options_deadline timestamptz := p_options_deadline;
  v_voting_deadline timestamptz := p_voting_deadline;
  v_opt jsonb;
  v_opt_id uuid;
  v_opt_count int := jsonb_array_length(coalesce(p_options, '[]'::jsonb));
  v_first_opt_id uuid;
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

  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    raise exception 'trip not found';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'not a member of this trip';
  end if;

  -- Resolve scope: explicit list (validated against the roster) or "everyone"
  -- (every current trip_participants member). The organizer is never
  -- auto-added — they already see/vote on everything via is_element_member's
  -- organizer clause, without needing a scope row.
  if p_scope_user_ids is null or array_length(p_scope_user_ids, 1) is null then
    select coalesce(array_agg(user_id), array[]::uuid[]) into v_scope
      from public.trip_participants where trip_id = p_trip_id;
  else
    select count(*) into v_bad_count
      from unnest(p_scope_user_ids) as uid
      where uid <> v_organizer_id
        and not exists (
          select 1 from public.trip_participants tp
          where tp.trip_id = p_trip_id and tp.user_id = uid
        );
    if v_bad_count > 0 then
      raise exception 'scope includes someone not on this trip';
    end if;
    v_scope := p_scope_user_ids;
  end if;

  if v_uid <> v_organizer_id and not (v_uid = any(v_scope)) then
    v_scope := array_append(v_scope, v_uid);
  end if;

  -- Locking-permission rule: organizer always may; a non-organizer only when
  -- they're the sole scope member (their own solo item). Anyone else's
  -- request to lock is silently downgraded to open, not rejected — the
  -- element still gets created, just via the normal vote lifecycle.
  if v_state = 'locked' then
    if not (
      v_uid = v_organizer_id
      or (array_length(v_scope, 1) = 1 and v_scope[1] = v_uid)
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
  end if;

  insert into public.trip_elements
    (trip_id, type, label, metadata, state, options_deadline, voting_deadline, created_by)
  values
    (p_trip_id, p_type, btrim(p_label), coalesce(p_metadata, '{}'::jsonb), v_state,
     v_options_deadline, v_voting_deadline, v_uid)
  returning id into v_el_id;

  v_first_opt_id := null;
  for v_opt in select value from jsonb_array_elements(coalesce(p_options, '[]'::jsonb))
  loop
    insert into public.element_options (element_id, value, source, proposed_by)
    values (v_el_id, v_opt->'value', 'user_proposed', v_uid)
    returning id into v_opt_id;
    if v_first_opt_id is null then
      v_first_opt_id := v_opt_id;
    end if;
  end loop;

  if v_state = 'locked' then
    update public.trip_elements set locked_option_id = v_first_opt_id where id = v_el_id;
  end if;

  insert into public.element_participants (element_id, participant_id, opted_in)
  select v_el_id, s, true from unnest(v_scope) as s
  on conflict (element_id, participant_id) do nothing;

  return v_el_id;
end;
$$;

revoke all on function public.create_element(uuid, text, text, jsonb, uuid[], text, timestamptz, timestamptz, jsonb) from public;
grant execute on function public.create_element(uuid, text, text, jsonb, uuid[], text, timestamptz, timestamptz, jsonb) to authenticated;

-- ---- RLS: swap trip-wide membership for element-scope membership ----------
drop policy if exists "Trip members can view the trip" on public.trips;
create policy "Trip members can view the trip"
  on public.trips for select
  to authenticated
  using (public.is_trip_member(id));

drop policy if exists "Trip members can view elements" on public.trip_elements;
create policy "Trip members can view elements"
  on public.trip_elements for select
  to authenticated
  using (public.is_element_member(id));

drop policy if exists "Trip members can view options" on public.element_options;
create policy "Trip members can view options"
  on public.element_options for select
  to authenticated
  using (exists (
    select 1 from public.trip_elements e
    where e.id = element_options.element_id and public.is_element_member(e.id)
  ));

drop policy if exists "Trip members can propose options on open elements" on public.element_options;
create policy "Trip members can propose options on open elements"
  on public.element_options for insert
  to authenticated
  with check (
    proposed_by = auth.uid()
    and exists (
      select 1 from public.trip_elements e
      where e.id = element_options.element_id
        and e.state = 'open'
        and (e.options_deadline is null or e.options_deadline > now())
        and public.is_element_member(e.id)
    )
  );

drop policy if exists "Users can view their own votes" on public.votes;
create policy "Users can view their own votes"
  on public.votes for select
  to authenticated
  using (participant_id = auth.uid());

-- New: a member of an element can see that element's own scope roster (who
-- else is in their subgroup) — still element-scoped, not trip-wide.
drop policy if exists "Element members can view their element's scope" on public.element_participants;
create policy "Element members can view their element's scope"
  on public.element_participants for select
  to authenticated
  using (public.is_element_member(element_id));

grant select on public.trips to authenticated;
grant select on public.trip_elements to authenticated;
grant select, insert on public.element_options to authenticated;
grant select on public.votes to authenticated;

-- ---- cast_votes: scope membership instead of trip-wide ---------------------
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

grant execute on function public.cast_votes(uuid, uuid[]) to authenticated;

-- ---- resolve_due_elements: drop the retired status column ------------------
create or replace function public.resolve_due_elements(p_trip_id uuid)
returns table(element_id uuid, element_type text, reason text)
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
      set state = 'locked', locked_option_id = v_winner_option_id
      where id = v_el.id;
  end loop;
end;
$$;

grant execute on function public.resolve_due_elements(uuid) to authenticated;

-- ---- get_trip_roster: names for the scope picker + Participants page ------
-- profiles RLS only lets a user read their own row, so listing other trip
-- members' display names needs a narrow security-definer read, same pattern
-- as get_user_email(). Trip-member-gated, not public.
create or replace function public.get_trip_roster(p_trip_id uuid)
returns table(user_id uuid, display_name text, is_organizer boolean)
language sql
stable
security definer
set search_path = public
as $$
  select t.organizer_id as user_id, p.display_name, true as is_organizer
  from public.trips t
  left join public.profiles p on p.id = t.organizer_id
  where t.id = p_trip_id and public.is_trip_member(p_trip_id)
  union all
  select tp.user_id, p.display_name, false as is_organizer
  from public.trip_participants tp
  left join public.profiles p on p.id = tp.user_id
  where tp.trip_id = p_trip_id and public.is_trip_member(p_trip_id);
$$;

grant execute on function public.get_trip_roster(uuid) to authenticated;
