-- ============================================================================
-- Trip capacity, invites and element spots (founder, 2026-10-07).
--
--  * trips.allow_over_max (default off): when OFF and the trip has a max,
--    a newcomer can't join once it's full (organizer + participants >=
--    max) — the trip page shows "this trip is full" instead. When ON,
--    anyone with the link can join past the max.
--  * trips.allow_participant_invites (default off): participants see the
--    invite link too (it's one shared link; this is a UI permission).
--  * trip_elements.spots: how many people an element can actually take
--    (ski house sleeps 8), defaulting to the trip's max. When more people
--    are opted in than there are spots, the cost is split per spot and the
--    first `spots` people to COMMIT (authorize payment / record a share) are
--    in; everyone after that is waitlisted until a spot frees up.
--  * max_participants now counts the organizer (a traveller since
--    20261007000000).
-- ============================================================================

alter table public.trips
  add column if not exists allow_over_max boolean not null default false,
  add column if not exists allow_participant_invites boolean not null default false;

alter table public.trip_elements
  add column if not exists spots int;
alter table public.trip_elements drop constraint if exists trip_elements_spots_check;
alter table public.trip_elements add constraint trip_elements_spots_check check (spots is null or spots >= 1);

-- ---- settings RPC: + allow_over_max, allow_participant_invites -------------
drop function if exists public.update_trip_permissions(uuid, boolean, boolean, int, int);

create or replace function public.update_trip_permissions(
  p_trip_id uuid,
  p_allow_participant_elements boolean,
  p_allow_participant_subgroups boolean,
  p_submission_deadline_days int,
  p_funding_deadline_days int,
  p_allow_over_max boolean,
  p_allow_participant_invites boolean
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
  if p_submission_deadline_days is null or p_submission_deadline_days not between 1 and 60 then
    raise exception 'submission deadline must be between 1 and 60 days';
  end if;
  if p_funding_deadline_days is null or p_funding_deadline_days not between 1 and 60 then
    raise exception 'funding deadline must be between 1 and 60 days';
  end if;
  update public.trips
    set allow_participant_elements = coalesce(p_allow_participant_elements, false),
        allow_participant_subgroups = coalesce(p_allow_participant_subgroups, false),
        submission_deadline_days = p_submission_deadline_days,
        funding_deadline_days = p_funding_deadline_days,
        allow_over_max = coalesce(p_allow_over_max, false),
        allow_participant_invites = coalesce(p_allow_participant_invites, false)
    where id = p_trip_id;
end;
$$;
grant execute on function public.update_trip_permissions(uuid, boolean, boolean, int, int, boolean, boolean) to authenticated;

-- ---- capacity helpers --------------------------------------------------------
-- Travellers on a trip = the organizer + every trip participant.
create or replace function public.trip_traveller_count(p_trip_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select 1 + (select count(*)::int from public.trip_participants where trip_id = p_trip_id);
$$;
revoke execute on function public.trip_traveller_count(uuid) from public, anon, authenticated;

-- Spots an element can take: its own, else the trip's max, else unlimited (null).
create or replace function public.element_spots(p_element_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(e.spots, t.max_participants)
  from public.trip_elements e join public.trips t on t.id = e.trip_id
  where e.id = p_element_id;
$$;
grant execute on function public.element_spots(uuid) to authenticated;

-- For the trip page: what a signed-in non-member sees. 'member' | 'full' |
-- 'open' (they'll be joined) ; null when the trip doesn't exist.
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
        or exists (select 1 from public.trip_participants tp where tp.trip_id = t.id and tp.user_id = auth.uid())
        then 'member'
      when t.max_participants is not null and not t.allow_over_max
        and public.trip_traveller_count(t.id) >= t.max_participants
        then 'full'
      else 'open'
    end
  from public.trips t
  where t.id = p_trip_id;
$$;
grant execute on function public.trip_join_status(uuid) to authenticated;

-- ---- join_trip: refuse newcomers when the trip is full ----------------------
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
    from public.trips where id = p_trip_id;
  if v_trip.organizer_id is null then
    return false; -- trip doesn't exist; nothing to do
  end if;
  if v_trip.organizer_id = v_uid then
    return false; -- the organizer is on the trip by definition
  end if;

  -- Newcomers only: an existing participant is never pushed out.
  if not exists (select 1 from public.trip_participants where trip_id = p_trip_id and user_id = v_uid)
     and v_trip.max_participants is not null and not v_trip.allow_over_max
     and public.trip_traveller_count(p_trip_id) >= v_trip.max_participants then
    return false; -- full; the trip page explains (trip_join_status)
  end if;

  insert into public.trip_participants (trip_id, user_id)
  values (p_trip_id, v_uid)
  on conflict (trip_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;

  insert into public.element_participants (element_id, participant_id, opted_in)
  select id, v_uid, true
  from public.trip_elements
  where trip_id = p_trip_id and scope_all = true and state = 'open'
  on conflict (element_id, participant_id) do nothing;

  return v_inserted > 0;
end;
$$;

-- ---- spots in the cost split -------------------------------------------------
-- Headcount behind a funding request = opted-in people, capped at the
-- fewest spots among its elements (a bundle is only as big as its smallest
-- member).
create or replace function public.funding_request_participant_population(p_element_ids uuid[])
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_count int;
  v_spots int;
  v_min_participants int;
begin
  if p_element_ids is null or array_length(p_element_ids, 1) is null then
    return 1;
  end if;

  select count(distinct ep.participant_id) into v_count
    from public.element_participants ep
    where ep.element_id = any(p_element_ids) and ep.opted_in = true;

  select min(public.element_spots(x)) into v_spots from unnest(p_element_ids) as x;

  if v_count > 0 then
    return least(v_count, coalesce(v_spots, v_count));
  end if;

  select trip_id into v_trip_id from public.trip_elements where id = p_element_ids[1];
  select min_participants into v_min_participants from public.trips where id = v_trip_id;
  return greatest(coalesce(v_min_participants, 1), 1);
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
  v_spots int;
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
    v_spots := public.element_spots(p_element_id);
    if v_opted_in_count > 0 then
      -- Only as many seats as there are spots get bought.
      v_multiplier := least(v_opted_in_count, coalesce(v_spots, v_opted_in_count));
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

-- ---- first to commit gets the spot ------------------------------------------
create or replace function public.funding_request_spots_full(p_funding_request_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Full = every spot is already committed by someone else.
  select public.funding_request_covered_count(p_funding_request_id)
           >= public.funding_request_population_for(p_funding_request_id)
     and not exists (
       select 1 from public.funding_mandates m
       where m.funding_request_id = p_funding_request_id and m.participant_id = p_user_id
         and m.status in ('active', 'charging', 'charge_succeeded'))
     and not exists (
       select 1 from public.funding_contributions c
       where c.funding_request_id = p_funding_request_id and c.contributor_id = p_user_id and c.refunded_at is null);
$$;
grant execute on function public.funding_request_spots_full(uuid, uuid) to authenticated;

create or replace function public.create_funding_mandate(p_funding_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fr record;
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select id, status, charge_status, funding_deadline, individual_amount, currency
    into v_fr from public.funding_requests where id = p_funding_request_id;
  if v_fr.id is null then
    raise exception 'funding request not found';
  end if;
  if v_fr.status <> 'collecting' or v_fr.charge_status is not null then
    raise exception 'this funding request is not accepting payment authorizations right now';
  end if;
  if v_fr.funding_deadline is not null and v_fr.funding_deadline <= now() then
    raise exception 'the funding deadline has passed';
  end if;
  if v_fr.individual_amount is null or v_fr.individual_amount <= 0 then
    raise exception 'this funding request has no per-person share to authorize';
  end if;
  if not exists (
    select 1 from public.funding_request_elements fre
    join public.element_participants ep on ep.element_id = fre.element_id
    where fre.funding_request_id = p_funding_request_id
      and ep.participant_id = v_uid and ep.opted_in = true
  ) then
    raise exception 'only participants opted into this element can authorize a payment';
  end if;
  if exists (
    select 1 from public.funding_mandates
    where funding_request_id = p_funding_request_id and participant_id = v_uid
      and status in ('active', 'charging', 'charge_succeeded')
  ) then
    raise exception 'you''ve already authorized your share';
  end if;
  if exists (
    select 1 from public.funding_contributions
    where funding_request_id = p_funding_request_id and contributor_id = v_uid and refunded_at is null
  ) then
    raise exception 'you already contributed to this funding request';
  end if;
  if public.funding_request_spots_full(p_funding_request_id, v_uid) then
    raise exception 'every spot is taken — you''re on the waitlist and can authorize if someone drops out';
  end if;

  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'superseded by a new attempt'
    where funding_request_id = p_funding_request_id and participant_id = v_uid and status = 'pending';

  insert into public.funding_mandates (funding_request_id, participant_id, individual_amount, currency)
  values (p_funding_request_id, v_uid, v_fr.individual_amount, coalesce(v_fr.currency, 'USD'))
  returning id into v_id;

  return v_id;
end;
$$;

-- A mandate can only ACTIVATE while a spot is still free — two people can
-- start authorizing at once; the first to finish wins, the other is told.
create or replace function public.activate_funding_mandate(
  p_setup_intent_id text, p_payment_method_id text, p_payment_method_type text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m record;
begin
  select id, funding_request_id, participant_id, status, currency into v_m
    from public.funding_mandates where stripe_setup_intent_id = p_setup_intent_id for update;
  if v_m.id is null or v_m.status <> 'pending' then
    return null;
  end if;
  if p_payment_method_type not in ('card', 'sepa_debit') then
    raise exception 'unsupported payment method type %', p_payment_method_type;
  end if;
  if p_payment_method_type = 'sepa_debit' and v_m.currency <> 'EUR' then
    raise exception 'SEPA Direct Debit is only available for EUR funding requests';
  end if;

  perform 1 from public.funding_requests where id = v_m.funding_request_id for update;
  if public.funding_request_spots_full(v_m.funding_request_id, v_m.participant_id) then
    update public.funding_mandates
      set status = 'canceled', canceled_at = now(), updated_at = now(),
          stripe_payment_method_id = p_payment_method_id, payment_method_type = p_payment_method_type,
          failure_reason = 'spots filled before this authorization finished — waitlisted'
      where id = v_m.id;
    return v_m.funding_request_id;
  end if;

  update public.funding_mandates
    set status = 'active',
        stripe_payment_method_id = p_payment_method_id,
        payment_method_type = p_payment_method_type,
        activated_at = now(),
        failure_reason = null,
        updated_at = now()
    where id = v_m.id;
  perform public.refresh_funding_mandate_readiness(v_m.funding_request_id);
  return v_m.funding_request_id;
end;
$$;
revoke execute on function public.activate_funding_mandate(text, text, text) from public, anon, authenticated;
grant execute on function public.activate_funding_mandate(text, text, text) to service_role;

create or replace function public.add_funding_contribution(p_funding_request_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_charge_status text;
  v_individual numeric;
  v_member_ids uuid[];
  v_population int;
  v_paid_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select status, charge_status, individual_amount into v_status, v_charge_status, v_individual
    from public.funding_requests where id = p_funding_request_id for update;
  if v_status is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_funding_request_member(p_funding_request_id) then
    raise exception 'not a member of this funding request';
  end if;
  if v_status <> 'collecting' or v_charge_status is not null then
    raise exception 'this funding request is not currently collecting';
  end if;
  -- Only someone actually in the element pays a share (the organizer
  -- included now that they're a traveller).
  if not exists (
    select 1 from public.funding_request_elements fre
    join public.element_participants ep on ep.element_id = fre.element_id
    where fre.funding_request_id = p_funding_request_id and ep.participant_id = v_uid and ep.opted_in = true
  ) then
    raise exception 'only participants opted into this element can commit a share';
  end if;
  if v_individual is null or p_amount is distinct from v_individual then
    raise exception 'amount must be exactly your fixed share: %', v_individual;
  end if;
  if exists (
    select 1 from public.funding_contributions
    where funding_request_id = p_funding_request_id and contributor_id = v_uid and refunded_at is null
  ) then
    raise exception 'you already contributed to this funding request';
  end if;
  if public.funding_request_spots_full(p_funding_request_id, v_uid) then
    raise exception 'every spot is taken — you''re on the waitlist';
  end if;

  insert into public.funding_contributions (funding_request_id, contributor_id, amount)
  values (p_funding_request_id, v_uid, p_amount);

  select array_agg(element_id) into v_member_ids
    from public.funding_request_elements where funding_request_id = p_funding_request_id;
  v_population := public.funding_request_participant_population(v_member_ids);

  select count(distinct contributor_id) into v_paid_count
    from public.funding_contributions
    where funding_request_id = p_funding_request_id and refunded_at is null;

  if v_paid_count >= v_population then
    update public.funding_requests set status = 'ready_to_purchase' where id = p_funding_request_id;
  end if;
end;
$$;

-- ---- organizer sets an element's spots ---------------------------------------
-- While open: freely. Once locked: only while nobody has committed money to
-- its funding (same guard as scope changes) — the split is then re-priced.
create or replace function public.set_element_spots(p_element_id uuid, p_spots int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_state text;
  v_fr_id uuid;
  v_els uuid[];
  v_required numeric;
begin
  select trip_id, state into v_trip_id, v_state from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can set spots';
  end if;
  if p_spots is not null and p_spots < 1 then
    raise exception 'spots must be at least 1';
  end if;
  if v_state <> 'open' and exists (
    select 1 from public.funding_request_elements fre
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = p_element_id and fr.status <> 'superseded'
      and (fr.status in ('ready_to_purchase', 'booked') or fr.charge_status is not null
        or exists (select 1 from public.funding_mandates m where m.funding_request_id = fr.id and m.status in ('active', 'charging', 'charge_succeeded'))
        or exists (select 1 from public.funding_contributions c where c.funding_request_id = fr.id and c.refunded_at is null))
  ) then
    raise exception 'people have already committed money to this — spots can''t change now';
  end if;

  update public.trip_elements set spots = p_spots where id = p_element_id;

  -- Re-price an uncommitted funding request for the new headcount.
  select fre.funding_request_id into v_fr_id
    from public.funding_request_elements fre
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = p_element_id and fr.status = 'collecting'
    limit 1;
  if v_fr_id is not null then
    select array_agg(element_id) into v_els from public.funding_request_elements where funding_request_id = v_fr_id;
    select sum(public.calculate_required_amount(e.id)) into v_required
      from public.trip_elements e where e.id = any(v_els) and e.type not in ('dates', 'destination');
    update public.funding_requests
      set required_amount = coalesce(v_required, required_amount),
          individual_amount = round(coalesce(v_required, required_amount)
            / greatest(public.funding_request_participant_population(v_els), 1), 2)
      where id = v_fr_id;
    update public.funding_mandates
      set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'share recalculated'
      where funding_request_id = v_fr_id and status = 'pending';
  end if;
end;
$$;
grant execute on function public.set_element_spots(uuid, int) to authenticated;

notify pgrst, 'reload schema';
