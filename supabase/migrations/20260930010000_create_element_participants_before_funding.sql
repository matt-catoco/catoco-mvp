-- ---- create_element: insert element_participants BEFORE funding ----------
-- Bug: create_element's locked-state branch called
-- create_funding_request_for_element(v_el_id) before the element_participants
-- rows were inserted at the very end of the function. At that moment the
-- opted-in population is zero, so both
--   * funding_request_participant_population() (the individual_amount divisor)
--   * calculate_required_amount() for per_person pricing (the multiplier)
-- fell back to trips.min_participants. An element created already-locked for
-- 2 people with a $300 flat price got individual_amount = $300 each (with
-- min_participants 1) instead of $150 -- and Flow #4 charges exactly
-- funding_requests.individual_amount per mandate at the deadline.
--
-- The same ordering bug hit the bundled path: the last chained element
-- (p_bundle_continues = false) fired the bundle's funding_request before its
-- own participants existed, so they were missing from the bundle population.
-- backfill_funding_for_dates (the p_type = 'dates' branch) is unaffected by
-- this element's participants, but moving the insert up is harmless there.
--
-- Fix: identical function, with the element_participants insert moved above
-- the locked-state branch. Same 13-arg signature, so CREATE OR REPLACE
-- replaces in place rather than adding a second overload (see
-- 20260918000000 / 20260919000000 for why two overloads break PostgREST).
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
  -- §1/§4: while a bundle is still being chained, the membership set in
  -- the DB is necessarily incomplete -- checking "is everyone in this
  -- bundle locked" against whatever members happen to exist SO FAR (not
  -- yet the real final set) would fire the funding_request the moment the
  -- FIRST locked member is created, long before chaining actually finishes.
  -- That's not a query problem SQL can solve on its own -- "more members
  -- are still coming in this session" is a client-side fact, not something
  -- derivable from DB state, so the caller has to say so explicitly. true
  -- on every chained element except the last one (the one created by
  -- clicking the plain "Add element" button, ending the chain).
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
    (trip_id, type, label, metadata, state, options_deadline, voting_deadline, created_by, locked_via, scope_all, derived_from_element_id, bundle_group_id)
  values
    (p_trip_id, p_type, btrim(p_label), coalesce(p_metadata, '{}'::jsonb), v_state,
     v_options_deadline, v_voting_deadline, v_uid, v_locked_via, v_scope_all, p_derived_from_element_id, p_bundle_group_id)
  returning id into v_el_id;

  -- §3: tag this element as its own bundle's anchor now, before the
  -- locked-state funding check below -- see the comment above this
  -- function for why a separate follow-up call is too late.
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

-- ---- backfill: requests created with the wrong population ----------------
-- Only requests nobody has committed money against yet: still collecting,
-- never charged, no mandates and no contributions. Recompute required_amount
-- too, since per_person members were multiplied by the same fallback count
-- (summed over priced members, as create_funding_request_for_element does;
-- left unchanged if it can't be computed), then re-split it.
with candidates as (
  select fr.id,
    array(select fre.element_id from public.funding_request_elements fre
          where fre.funding_request_id = fr.id) as els
  from public.funding_requests fr
  where fr.status = 'collecting'
    and fr.charge_status is null
    and fr.required_amount is not null
    and not exists (select 1 from public.funding_mandates m where m.funding_request_id = fr.id)
    and not exists (select 1 from public.funding_contributions c where c.funding_request_id = fr.id)
),
recomputed as (
  select c.id, c.els,
    (select sum(public.calculate_required_amount(e.id))
       from public.trip_elements e
       where e.id = any(c.els) and e.type not in ('dates', 'destination')) as required
  from candidates c
)
update public.funding_requests fr
set required_amount = coalesce(r.required, fr.required_amount),
    individual_amount = round(
      coalesce(r.required, fr.required_amount)
        / greatest(public.funding_request_participant_population(r.els), 1),
      2)
from recomputed r
where fr.id = r.id;
