-- ============================================================================
-- New participants couldn't see any element created before they joined, even
-- when that element was scoped to "everyone" -- confirmed live: promoting
-- the new participant to co-organizer let them see everything (is_trip_
-- organizer() bypasses the element_participants check entirely), so the gap
-- is specific to regular participants relying on element_participants rows.
--
-- Root cause: "Everyone" scope at creation (add-element-form.tsx passes
-- scopeUserIds: null for it) just snapshots every CURRENT trip_participant
-- into element_participants at that moment -- it was never recorded as
-- "this element tracks the whole roster," so a later join_trip() had no way
-- to know which elements should retroactively include the new person.
-- join_trip() only ever inserted into trip_participants, never backfilled
-- element_participants for anything.
--
-- Fix: persist that intent as trip_elements.scope_all (true when created
-- with scopeUserIds: null / "Everyone", false for a hand-picked subgroup --
-- deliberately NOT auto-expanding subgroup-scoped elements to new joiners,
-- since that's the actual point of scoping to a subgroup in the first
-- place), then have join_trip() backfill element_participants for every
-- scope_all element on the trip when someone new joins.
-- ============================================================================

alter table public.trip_elements
  add column if not exists scope_all boolean not null default false;

-- ---- create_element: record whether this was "Everyone" scope -------------
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
  v_is_organizer boolean;
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

  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    raise exception 'trip not found';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'not a member of this trip';
  end if;

  v_is_organizer := public.is_trip_organizer(p_trip_id);

  -- Only the organizer/co-organizer may choose a custom scope (2026-09-xx:
  -- "only an organizer can dictate which invitees are part of which
  -- elements") -- everyone else's elements are always everyone-scoped,
  -- regardless of what p_scope_user_ids they pass. Silently overridden
  -- rather than an error, same "downgrade, don't reject" pattern as the
  -- locked-state check below, so this can't be bypassed by calling the RPC
  -- directly once the UI stops offering the choice.
  if not v_is_organizer or p_scope_user_ids is null or array_length(p_scope_user_ids, 1) is null then
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

  if v_state = 'locked' then
    if not (
      v_is_organizer
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
    v_locked_via := 'organizer';
  end if;

  insert into public.trip_elements
    (trip_id, type, label, metadata, state, options_deadline, voting_deadline, created_by, locked_via, scope_all)
  values
    (p_trip_id, p_type, btrim(p_label), coalesce(p_metadata, '{}'::jsonb), v_state,
     v_options_deadline, v_voting_deadline, v_uid, v_locked_via, v_scope_all)
  returning id into v_el_id;

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

  if v_state = 'locked' then
    update public.trip_elements set locked_option_id = v_first_opt_id where id = v_el_id;
    perform public.create_funding_request_for_element(v_el_id);
  end if;

  insert into public.element_participants (element_id, participant_id, opted_in)
  select v_el_id, s, true from unnest(v_scope) as s
  on conflict (element_id, participant_id) do nothing;

  return v_el_id;
end;
$$;

-- ---- join_trip: backfill element_participants for "Everyone" elements ----
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

  insert into public.element_participants (element_id, participant_id, opted_in)
  select id, v_uid, true
  from public.trip_elements
  where trip_id = p_trip_id and scope_all = true
  on conflict (element_id, participant_id) do nothing;
end;
$$;
