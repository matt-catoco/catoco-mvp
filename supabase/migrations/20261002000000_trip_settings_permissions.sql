-- ============================================================================
-- Trip Settings & Permissions (consolidated prompt, 2026-10-02).
--
-- §1 allow_participant_elements — can non-organizers add elements at all.
--    Founder decision: OFF EVERYWHERE, including existing trips (default
--    false, deliberately no backfill). Auto-spawned elements (a Nights-mode
--    Dates option creating its follow-up Dates element) are exempt — that's
--    a side effect of proposing an option, not someone adding an element.
-- §2 allow_participant_subgroups — founder decision (the spec's "creator
--    self-lock" was a no-op: only organizers could create subgroup
--    elements, and they can already lock). When ON, non-organizers may
--    create subgroup-scoped elements and lock in their own subgroup
--    elements — at creation, or later via lock_element(). "Everyone"
--    elements stay organizer-locked regardless. Default false.
--    New locked_via value 'creator' so the tile says who locked it.
-- §3 (b) funding deadline defaults — the one real default that exists:
--    funding_deadline_days (was hardcoded 14) and funding_grace_hours (the
--    24h window before funding reminders start; was a cron constant).
--    Submission/voting deadlines stay required per element (no new
--    mechanics, founder chose (b) over per-type defaults).
-- §5 stays as shipped (open-only opt-out); §6 shipped in
--    20261001000000_opt_out.sql; §4 needs no code (organizers already see
--    every element via is_element_member()).
-- ============================================================================

alter table public.trips
  add column if not exists allow_participant_elements boolean not null default false,
  add column if not exists allow_participant_subgroups boolean not null default false,
  add column if not exists funding_deadline_days int not null default 14,
  add column if not exists funding_grace_hours int not null default 24;

alter table public.trips drop constraint if exists trips_funding_deadline_days_check;
alter table public.trips add constraint trips_funding_deadline_days_check
  check (funding_deadline_days between 1 and 60);
alter table public.trips drop constraint if exists trips_funding_grace_hours_check;
alter table public.trips add constraint trips_funding_grace_hours_check
  check (funding_grace_hours between 0 and 72);

alter table public.trip_elements drop constraint if exists trip_elements_locked_via_check;
alter table public.trip_elements add constraint trip_elements_locked_via_check
  check (locked_via is null or locked_via in ('organizer', 'vote', 'creator'));

-- ---- settings RPC (organizer / co-organizer) -------------------------------
create or replace function public.update_trip_permissions(
  p_trip_id uuid,
  p_allow_participant_elements boolean,
  p_allow_participant_subgroups boolean,
  p_funding_deadline_days int,
  p_funding_grace_hours int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can change trip settings';
  end if;
  if p_funding_deadline_days is null or p_funding_deadline_days not between 1 and 60 then
    raise exception 'funding deadline must be between 1 and 60 days';
  end if;
  if p_funding_grace_hours is null or p_funding_grace_hours not between 0 and 72 then
    raise exception 'grace window must be between 0 and 72 hours';
  end if;
  update public.trips
    set allow_participant_elements = coalesce(p_allow_participant_elements, false),
        allow_participant_subgroups = coalesce(p_allow_participant_subgroups, false),
        funding_deadline_days = p_funding_deadline_days,
        funding_grace_hours = p_funding_grace_hours
    where id = p_trip_id;
end;
$$;
grant execute on function public.update_trip_permissions(uuid, boolean, boolean, int, int) to authenticated;

-- ---- create_element: §1 gate + §2 participant subgroups --------------------
-- Same 13-arg signature as the live version (20260930010000) — CREATE OR
-- REPLACE in place, no second overload. Only the marked blocks change.
create or replace function public.create_element(
  p_trip_id uuid,
  p_type text,
  p_label text,
  p_metadata jsonb default '{}'::jsonb,
  p_scope_user_ids uuid[] default null,
  p_state text default 'open',
  p_options_deadline timestamptz default null,
  p_voting_deadline timestamptz default null,
  p_options jsonb default '[]'::jsonb,
  p_derived_from_element_id uuid default null,
  p_bundle_group_id uuid default null,
  p_start_bundle boolean default false,
  p_bundle_continues boolean default false
)
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
    from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    raise exception 'trip not found';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'not a member of this trip';
  end if;

  v_is_organizer := public.is_trip_organizer(p_trip_id);

  -- §1: participants adding elements is a per-trip setting (default off).
  -- Auto-spawned follow-ups (p_derived_from_element_id) are exempt.
  if not v_is_organizer and not v_allow_elements and p_derived_from_element_id is null then
    raise exception 'the organizer has turned off adding elements for participants on this trip';
  end if;

  -- §2: organizers always may pick a subgroup; participants only when the
  -- trip allows it. Otherwise (or with no scope given) it's Everyone.
  if not (v_is_organizer or v_allow_subgroups)
     or p_scope_user_ids is null or array_length(p_scope_user_ids, 1) is null then
    v_scope_all := true;
    select coalesce(array_agg(user_id), array[]::uuid[]) into v_scope
      from public.trip_participants where trip_id = p_trip_id;
  else
    v_scope_all := false;
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

  -- Who may create it already locked: organizers; a solo self-scope; and
  -- (§2) a participant's own subgroup element when the trip allows it.
  if v_state = 'locked' then
    if not (
      v_is_organizer
      -- not v_scope_all: on a trip whose only participant is the caller, an
      -- Everyone element has scope {caller} — that must NOT count as a solo
      -- self-scope (found in testing: it let participants self-lock Everyone).
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

  -- Participants first: the locked-state funding branch below derives both
  -- the per_person required amount and the individual split from the
  -- opted-in element_participants count.
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

-- ---- lock_element: §2 creator self-lock on their own subgroup element ----
create or replace function public.lock_element(p_element_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_state text;
  v_type text;
  v_created_by uuid;
  v_scope_all boolean;
  v_is_organizer boolean;
  v_allow_subgroups boolean;
begin
  select e.trip_id, e.state, e.type, e.created_by, e.scope_all, t.allow_participant_subgroups
    into v_trip_id, v_state, v_type, v_created_by, v_scope_all, v_allow_subgroups
    from public.trip_elements e join public.trips t on t.id = e.trip_id
    where e.id = p_element_id;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  v_is_organizer := public.is_trip_organizer(v_trip_id);
  if not (
    v_is_organizer
    or (v_allow_subgroups and not v_scope_all and v_created_by = auth.uid())
  ) then
    raise exception 'only the organizer or a co-organizer can do this';
  end if;
  if v_state <> 'open' then
    raise exception 'element is not open';
  end if;
  if not exists (
    select 1 from public.element_options where id = p_option_id and element_id = p_element_id
  ) then
    raise exception 'that option does not belong to this element';
  end if;

  update public.trip_elements
    set state = 'locked',
        locked_option_id = p_option_id,
        options_deadline = null,
        voting_deadline = null,
        locked_via = case when v_is_organizer then 'organizer' else 'creator' end
    where id = p_element_id;

  perform public.create_funding_request_for_element(p_element_id);
  if v_type = 'dates' then
    perform public.backfill_funding_for_dates(v_trip_id);
  end if;
end;
$$;

-- ---- create_funding_request_for_element: §3 per-trip deadline -------------
-- Identical to the live version except the hardcoded 14 days now reads
-- trips.funding_deadline_days (default 14, so unchanged unless set).
create or replace function public.create_funding_request_for_element(p_element_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_type text;
  v_organizer_id uuid;
  v_purchaser_id uuid;
  v_bundle_group_id uuid;
  v_member_ids uuid[];
  v_unlocked_count int;
  v_required numeric := 0;
  v_member_required numeric;
  v_member_id uuid;
  v_member_type text;
  v_priced_count int := 0;
  v_population int;
  v_individual numeric;
  v_fr_id uuid;
  v_deadline_days int;
begin
  select e.trip_id, e.type, e.bundle_group_id, t.organizer_id, t.funding_deadline_days
    into v_trip_id, v_type, v_bundle_group_id, v_organizer_id, v_deadline_days
    from public.trip_elements e
    join public.trips t on t.id = e.trip_id
    where e.id = p_element_id;

  if v_trip_id is null then
    return null;
  end if;

  if v_bundle_group_id is null then
    if v_type in ('dates', 'destination') then
      return null;
    end if;
    v_required := public.calculate_required_amount(p_element_id);
    if v_required is null then
      return null;
    end if;
    v_member_ids := array[p_element_id];
  else
    select array_agg(id) into v_member_ids
      from public.trip_elements
      where bundle_group_id = v_bundle_group_id or id = v_bundle_group_id;

    select count(*) into v_unlocked_count
      from public.trip_elements
      where id = any(v_member_ids) and state <> 'locked';
    if v_unlocked_count > 0 then
      return null;
    end if;

    if exists (
      select 1 from public.funding_request_elements fre
      join public.funding_requests fr on fr.id = fre.funding_request_id
      where fre.element_id = any(v_member_ids) and fr.status <> 'superseded'
    ) then
      return null;
    end if;

    for v_member_id in select unnest(v_member_ids) loop
      select type into v_member_type from public.trip_elements where id = v_member_id;
      if v_member_type in ('dates', 'destination') then
        continue;
      end if;
      v_member_required := public.calculate_required_amount(v_member_id);
      if v_member_required is null then
        return null;
      end if;
      v_required := v_required + v_member_required;
      v_priced_count := v_priced_count + 1;
    end loop;

    if v_priced_count = 0 then
      return null;
    end if;
  end if;

  v_purchaser_id := v_organizer_id;
  v_population := public.funding_request_participant_population(v_member_ids);
  v_individual := round(v_required / greatest(v_population, 1), 2);

  insert into public.funding_requests
    (trip_id, purchaser_id, required_amount, individual_amount, status, funding_deadline)
  values
    (v_trip_id, v_purchaser_id, v_required, v_individual, 'collecting',
     now() + make_interval(days => coalesce(v_deadline_days, 14)))
  returning id into v_fr_id;

  insert into public.funding_request_elements (funding_request_id, element_id)
  select v_fr_id, m from unnest(v_member_ids) as m;

  return v_fr_id;
end;
$$;

notify pgrst, 'reload schema';

