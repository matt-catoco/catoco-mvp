-- ============================================================================
-- Flow-audit prompt, §2: Nights-mode Dates option submission auto-creates a
-- second Dates element (exact-dates mode) for the group to pin down actual
-- calendar dates. New trip_elements.derived_from_element_id tracks that
-- relationship, purely so the app-side logic (submitOption(), app/trips/
-- [tripId]/actions.ts) can check "has this already been created for this
-- element" and avoid spawning a duplicate second element if more than one
-- Nights-mode option gets proposed for the same original element.
--
-- create_element() gets a new trailing optional param (p_derived_from_
-- element_id, defaults null) rather than a follow-up UPDATE from the client
-- -- every other trip_elements write in this codebase goes through an RPC,
-- never a raw client update, so this keeps that pattern instead of being
-- the one exception.
-- ============================================================================

alter table public.trip_elements
  add column if not exists derived_from_element_id uuid references public.trip_elements(id) on delete set null;

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
  p_derived_from_element_id uuid default null
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
    (trip_id, type, label, metadata, state, options_deadline, voting_deadline, created_by, locked_via, scope_all, derived_from_element_id)
  values
    (p_trip_id, p_type, btrim(p_label), coalesce(p_metadata, '{}'::jsonb), v_state,
     v_options_deadline, v_voting_deadline, v_uid, v_locked_via, v_scope_all, p_derived_from_element_id)
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
    if p_type = 'dates' then
      perform public.backfill_funding_for_dates(p_trip_id);
    end if;
  end if;

  insert into public.element_participants (element_id, participant_id, opted_in)
  select v_el_id, s, true from unnest(v_scope) as s
  on conflict (element_id, participant_id) do nothing;

  return v_el_id;
end;
$$;
