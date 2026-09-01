-- ============================================================================
-- Flow #3 follow-up — Co-Organizer role + participant capacity
--
-- Three-role scope: Organizer (trips.organizer_id, unchanged, still the only
-- one who can rename/delete the trip or transfer ownership) / Co-Organizer
-- (new — equal authority to Organizer everywhere else: create/lock/edit
-- elements, assign roles, full visibility) / Participant (the default for
-- anyone who joins). Co-Organizer authority is granted through the RPCs
-- below (is_trip_organizer(), used inside is_element_member/create_element/
-- update_element/set_participant_role/set_participant_capacity) rather than
-- by touching the raw "Organizer manages own ..." RLS policies — those stay
-- organizer-only as a conservative default for direct table access outside
-- the app's own write paths, which always go through these RPCs anyway.
--
-- Participant capacity: min/max don't block joining — the invite link still
-- always works. They're a target the roster page shows progress against
-- (first-come-first-served by trip_participants.joined_at, which already
-- exists). No enforcement mechanic here — "commitment"/waitlisting beyond
-- a plain capacity number is real future work, not built now.
-- ============================================================================

alter table public.trip_participants
  add column if not exists role text not null default 'participant';
alter table public.trip_participants drop constraint if exists trip_participants_role_check;
alter table public.trip_participants
  add constraint trip_participants_role_check check (role in ('participant', 'co_organizer'));

alter table public.trips
  add column if not exists min_participants integer,
  add column if not exists max_participants integer;
alter table public.trips drop constraint if exists trips_participant_range_check;
alter table public.trips
  add constraint trips_participant_range_check
    check (min_participants is null or max_participants is null or max_participants >= min_participants);

-- ---- is_trip_organizer: Organizer or Co-Organizer -------------------------
create or replace function public.is_trip_organizer(p_trip_id uuid)
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
    where tp.trip_id = p_trip_id and tp.user_id = auth.uid() and tp.role = 'co_organizer'
  );
$$;

grant execute on function public.is_trip_organizer(uuid) to authenticated;

-- ---- is_element_member: organizer branch now includes co-organizer -------
create or replace function public.is_element_member(p_element_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trip_elements e
    where e.id = p_element_id and public.is_trip_organizer(e.trip_id)
  ) or exists (
    select 1 from public.element_participants ep
    where ep.element_id = p_element_id
      and ep.participant_id = auth.uid()
      and ep.opted_in = true
  );
$$;

-- ---- create_element: co-organizer gets the same lock authority -----------
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

  -- Locking-permission rule: organizer or co-organizer always may; anyone
  -- else only when they're the sole scope member (their own solo item).
  if v_state = 'locked' then
    if not (
      public.is_trip_organizer(p_trip_id)
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

-- ---- update_element: co-organizer gets the same edit authority -----------
create or replace function public.update_element(
  p_element_id uuid,
  p_label text,
  p_metadata jsonb default '{}'::jsonb,
  p_options_deadline timestamptz default null,
  p_voting_deadline timestamptz default null,
  p_locked_value jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip_id uuid;
  v_created_by uuid;
  v_state text;
  v_locked_option_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'element needs a label';
  end if;

  select e.trip_id, e.created_by, e.state, e.locked_option_id
    into v_trip_id, v_created_by, v_state, v_locked_option_id
    from public.trip_elements e
    where e.id = p_element_id;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not (public.is_trip_organizer(v_trip_id) or v_uid = v_created_by) then
    raise exception 'only the organizer, a co-organizer, or the element''s creator can edit it';
  end if;

  if v_state = 'open' and p_options_deadline is not null and p_voting_deadline is not null
     and p_options_deadline > p_voting_deadline then
    raise exception 'options_deadline must be on or before voting_deadline';
  end if;

  update public.trip_elements
    set label = btrim(p_label),
        metadata = coalesce(p_metadata, '{}'::jsonb),
        options_deadline = case when v_state = 'open' then p_options_deadline else options_deadline end,
        voting_deadline = case when v_state = 'open' then p_voting_deadline else voting_deadline end
    where id = p_element_id;

  if v_state = 'locked' and p_locked_value is not null then
    if v_locked_option_id is null then
      raise exception 'locked element has no value to edit';
    end if;
    update public.element_options set value = p_locked_value where id = v_locked_option_id;
  end if;
end;
$$;

-- ---- set_participant_role: Organizer or Co-Organizer assigns roles -------
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
    select 1 from public.trip_participants where trip_id = p_trip_id and user_id = p_user_id
  ) then
    raise exception 'that user is not on this trip''s roster';
  end if;

  update public.trip_participants set role = p_role
    where trip_id = p_trip_id and user_id = p_user_id;
end;
$$;

-- ---- set_participant_capacity: min/max, informational only ---------------
create or replace function public.set_participant_capacity(p_trip_id uuid, p_min integer, p_max integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can set this';
  end if;
  if p_min is not null and p_max is not null and p_max < p_min then
    raise exception 'max must be greater than or equal to min';
  end if;

  update public.trips set min_participants = p_min, max_participants = p_max where id = p_trip_id;
end;
$$;

revoke all on function public.create_element(uuid, text, text, jsonb, uuid[], text, timestamptz, timestamptz, jsonb) from public;
revoke all on function public.update_element(uuid, text, jsonb, timestamptz, timestamptz, jsonb) from public;
grant execute on function public.create_element(uuid, text, text, jsonb, uuid[], text, timestamptz, timestamptz, jsonb) to authenticated;
grant execute on function public.update_element(uuid, text, jsonb, timestamptz, timestamptz, jsonb) to authenticated;
grant execute on function public.set_participant_role(uuid, uuid, text) to authenticated;
grant execute on function public.set_participant_capacity(uuid, integer, integer) to authenticated;

-- ---- get_trip_roster: include role, so the Participants page can show/
-- manage it. Postgres can't CREATE OR REPLACE a set-returning function when
-- the output columns change (3 -> 5 here) — has to be dropped first. -------
drop function if exists public.get_trip_roster(uuid);

create function public.get_trip_roster(p_trip_id uuid)
returns table(user_id uuid, display_name text, is_organizer boolean, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select t.organizer_id as user_id, p.display_name, true as is_organizer,
         'organizer'::text as role, null::timestamptz as joined_at
  from public.trips t
  left join public.profiles p on p.id = t.organizer_id
  where t.id = p_trip_id and public.is_trip_member(p_trip_id)
  union all
  select tp.user_id, p.display_name, false as is_organizer, tp.role, tp.joined_at
  from public.trip_participants tp
  left join public.profiles p on p.id = tp.user_id
  where tp.trip_id = p_trip_id and public.is_trip_member(p_trip_id)
  order by joined_at nulls first;
$$;

grant execute on function public.get_trip_roster(uuid) to authenticated;
