-- ============================================================================
-- Founder decisions 2026-10-07 (platform audit follow-up):
--
-- 1. The organizer is always a traveller/participant: an "Everyone" element's
--    scope now includes the organizer, so per-person pricing, the cost split,
--    payment authorization (Stripe mandates require an opted-in participant)
--    and every headcount count them. A subgroup includes the organizer only
--    if picked ("Me" / their name); the organizer can still opt out of any
--    open element like anyone else.
--    Before: per-person elements were priced and split WITHOUT the organizer
--    (Porto Crew Trip: 3 travellers, transfer funded for 2), yet organizers
--    could vote and manually commit, which counted as a payer.
--
-- 2. Per-night pricing uses the option's OWN dates — a stay's check-in /
--    check-out (value.dates), a rental car's pickup / drop-off — and only
--    falls back to the trip's locked Dates when the option has none. A trip
--    can span several stays. Before: nights always came from the trip's
--    Dates, so a stay on a trip without locked Dates was never funded, and a
--    2-night stay on a 7-night trip was billed 7 nights.
-- ============================================================================

-- ---- 1. create_element: Everyone includes the organizer ---------------------
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
    -- Everyone = every trip participant AND the organizer (founder
    -- 2026-10-07: the organizer is always a traveller unless they leave
    -- themselves out of a subgroup, or opt out of an element).
    select array_agg(distinct s.u) into v_scope
      from (
        select tp.user_id as u from public.trip_participants tp where tp.trip_id = p_trip_id
        union select v_organizer_id
      ) s;
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

-- ---- 2. per-night pricing from the option's own dates ----------------------
create or replace function public.option_nights(p_value jsonb)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  v_s text := coalesce(p_value->'dates'->>'start_date', p_value->>'start_date', '');
  v_e text := coalesce(p_value->'dates'->>'end_date', p_value->>'end_date', '');
  v_ps text := coalesce(p_value->>'pickup_datetime', '');
  v_pe text := coalesce(p_value->>'dropoff_datetime', '');
begin
  if coalesce(p_value->>'nights', '') ~ '^\d+(\.\d+)?$' then
    return (p_value->>'nights')::numeric;
  end if;
  if v_s ~ '^\d{4}-\d{2}-\d{2}' and v_e ~ '^\d{4}-\d{2}-\d{2}' then
    return greatest(left(v_e, 10)::date - left(v_s, 10)::date, 0);
  end if;
  -- Rental car: billed per started day between pickup and drop-off.
  if v_ps ~ '^\d{4}-\d{2}-\d{2}' and v_pe ~ '^\d{4}-\d{2}-\d{2}' then
    return greatest(ceil(extract(epoch from (v_pe::timestamp - v_ps::timestamp)) / 86400.0), 1);
  end if;
  return null;
end;
$$;

create or replace function public.calculate_required_amount(p_element_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_locked_option_id uuid;
  v_value jsonb;
  v_unit_price numeric;
  v_pricing_basis text;
  v_multiplier numeric;
  v_dates_value jsonb;
  v_nights numeric;
  v_opted_in_count int;
  v_min_participants int;
begin
  select trip_id, locked_option_id into v_trip_id, v_locked_option_id
    from public.trip_elements where id = p_element_id;
  if v_locked_option_id is null then
    return null;
  end if;

  select value, unit_price, pricing_basis into v_value, v_unit_price, v_pricing_basis
    from public.element_options where id = v_locked_option_id;
  if v_unit_price is null or v_pricing_basis is null then
    return null;
  end if;

  if v_pricing_basis = 'per_night' then
    v_nights := public.option_nights(v_value);
    if v_nights is null then
      -- Fallback only: the option itself carries no dates.
      select o.value into v_dates_value
        from public.trip_elements e join public.element_options o on o.id = e.locked_option_id
        where e.trip_id = v_trip_id and e.type = 'dates' and e.state = 'locked'
        limit 1;
      if v_dates_value is not null then
        v_nights := public.option_nights(v_dates_value);
      end if;
    end if;
    if v_nights is null then
      return null;
    end if;
    v_multiplier := greatest(v_nights, 0);

  elsif v_pricing_basis = 'per_person' then
    select count(*) into v_opted_in_count
      from public.element_participants
      where element_id = p_element_id and opted_in = true;
    if v_opted_in_count > 0 then
      v_multiplier := v_opted_in_count;
    else
      select min_participants into v_min_participants from public.trips where id = v_trip_id;
      v_multiplier := greatest(coalesce(v_min_participants, 1), 1);
    end if;

  else
    v_multiplier := 1;
  end if;

  return round(v_unit_price * v_multiplier, 2);
end;
$$;

-- ---- backfill (data) --------------------------------------------------------
-- a) Organizer joins the scope of every Everyone element that has no money
--    committed yet (open, or locked with only an uncommitted funding
--    request). Elements with authorizations or payments keep their fixed
--    split — changing a headcount under committed money is exactly what the
--    opt-out guards exist to prevent.
insert into public.element_participants (element_id, participant_id, opted_in)
select e.id, t.organizer_id, true
from public.trip_elements e
join public.trips t on t.id = e.trip_id
where e.scope_all
  and not exists (
    select 1 from public.funding_request_elements fre
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = e.id and fr.status <> 'superseded'
      and (
        fr.status in ('ready_to_purchase', 'booked') or fr.charge_status is not null
        or exists (select 1 from public.funding_mandates m where m.funding_request_id = fr.id and m.status in ('active', 'charging', 'charge_succeeded'))
        or exists (select 1 from public.funding_contributions c where c.funding_request_id = fr.id and c.refunded_at is null)
      )
  )
on conflict (element_id, participant_id) do nothing;

-- b) Re-price + re-split every still-uncommitted collecting request (new
--    headcount; per-night from the stay's own dates). Pending (not yet
--    authorized) mandates carry the old share, so they're superseded too.
with candidates as (
  select fr.id,
    array(select fre.element_id from public.funding_request_elements fre where fre.funding_request_id = fr.id) as els
  from public.funding_requests fr
  where fr.status = 'collecting' and fr.charge_status is null
    and not exists (select 1 from public.funding_mandates m where m.funding_request_id = fr.id and m.status in ('active', 'charging', 'charge_succeeded'))
    and not exists (select 1 from public.funding_contributions c where c.funding_request_id = fr.id and c.refunded_at is null)
),
recomputed as (
  select c.id, c.els,
    (select sum(public.calculate_required_amount(e.id)) from public.trip_elements e
      where e.id = any(c.els) and e.type not in ('dates', 'destination')) as required
  from candidates c
)
update public.funding_requests fr
set required_amount = coalesce(r.required, fr.required_amount),
    individual_amount = round(coalesce(r.required, fr.required_amount)
      / greatest(public.funding_request_participant_population(r.els), 1), 2)
from recomputed r
where fr.id = r.id;

update public.funding_mandates m
set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'share recalculated'
from public.funding_requests fr
where m.funding_request_id = fr.id and m.status = 'pending' and m.individual_amount <> fr.individual_amount;

-- c) Locked, priced, unbundled elements that never got funding because their
--    per-night price couldn't be computed before (a stay on a trip with no
--    locked Dates) get their funding request now.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select e.id from public.trip_elements e
    where e.state = 'locked' and e.bundle_group_id is null and e.booked_at is null
      and e.type not in ('dates', 'destination')
      and not exists (
        select 1 from public.funding_request_elements fre
        join public.funding_requests fr on fr.id = fre.funding_request_id
        where fre.element_id = e.id and fr.status <> 'superseded')
      and public.calculate_required_amount(e.id) is not null
  loop
    perform public.create_funding_request_for_element(v_id);
  end loop;
end;
$$;

notify pgrst, 'reload schema';
