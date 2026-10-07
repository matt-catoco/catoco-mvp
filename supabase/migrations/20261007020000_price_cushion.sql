-- ============================================================================
-- Price cushion (founder, 2026-10-07). Prices drift between submission,
-- lock and booking (a Duffel fare is only held ~30 minutes), so:
--
--  * trips.price_cushion_kind/value: default cushion for the trip — a
--    percent of each share (default 10%) or a fixed amount per person.
--    trip_elements.cushion_kind/value override it per element.
--  * Each person authorizes UP TO their share + the cushion; the cap is
--    stored on the mandate (funding_mandates.max_amount).
--  * reprice_locked_element(): the organizer/purchaser (or the automatic
--    recheck for Duffel/LiteAPI options) sets the current price. The split
--    is recomputed; authorizations whose cap covers the new share stay
--    valid, and everyone is charged the NEW share (lower if it dropped).
--    If the new share is above anyone's cap, every authorization is
--    canceled and people re-authorize at the new price (or the organizer
--    drops the element).
--  * The charge job charges the current share, never above a mandate's cap.
-- Only while nothing's been charged and nobody paid a fixed manual share.
-- ============================================================================

alter table public.trips
  add column if not exists price_cushion_kind text not null default 'percent',
  add column if not exists price_cushion_value numeric not null default 10;
alter table public.trips drop constraint if exists trips_price_cushion_check;
alter table public.trips add constraint trips_price_cushion_check check (
  price_cushion_kind in ('percent', 'amount') and price_cushion_value >= 0
  and (price_cushion_kind <> 'percent' or price_cushion_value <= 100));

alter table public.trip_elements
  add column if not exists cushion_kind text,
  add column if not exists cushion_value numeric;
alter table public.trip_elements drop constraint if exists trip_elements_cushion_check;
alter table public.trip_elements add constraint trip_elements_cushion_check check (
  (cushion_kind is null and cushion_value is null)
  or (cushion_kind in ('percent', 'amount') and cushion_value >= 0
      and (cushion_kind <> 'percent' or cushion_value <= 100)));

alter table public.funding_mandates
  add column if not exists max_amount numeric;

alter table public.funding_requests
  add column if not exists previous_individual_amount numeric,
  add column if not exists price_changed_at timestamptz;

-- ---- the cap for a share -----------------------------------------------------
-- A bundle uses the first member's override, else the trip's cushion.
create or replace function public.funding_request_cushion_cap(p_funding_request_id uuid, p_individual numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text;
  v_value numeric;
begin
  if p_individual is null then
    return null;
  end if;
  select e.cushion_kind, e.cushion_value into v_kind, v_value
    from public.funding_request_elements fre join public.trip_elements e on e.id = fre.element_id
    where fre.funding_request_id = p_funding_request_id and e.cushion_kind is not null
    order by e.created_at limit 1;
  if v_kind is null then
    select t.price_cushion_kind, t.price_cushion_value into v_kind, v_value
      from public.funding_requests fr join public.trips t on t.id = fr.trip_id
      where fr.id = p_funding_request_id;
  end if;
  if v_kind = 'amount' then
    return round(p_individual + coalesce(v_value, 0), 2);
  end if;
  return round(p_individual * (1 + coalesce(v_value, 0) / 100.0), 2);
end;
$$;
grant execute on function public.funding_request_cushion_cap(uuid, numeric) to authenticated;

-- ---- mandates record their cap ----------------------------------------------
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

  insert into public.funding_mandates (funding_request_id, participant_id, individual_amount, max_amount, currency)
  values (p_funding_request_id, v_uid, v_fr.individual_amount,
          public.funding_request_cushion_cap(p_funding_request_id, v_fr.individual_amount),
          coalesce(v_fr.currency, 'USD'))
  returning id into v_id;

  return v_id;
end;
$$;

-- ---- charge the CURRENT share, never above the cap -----------------------------
create or replace function public.get_funding_charge_batch(p_funding_request_id uuid)
returns table (
  mandate_id uuid, participant_id uuid, status text, stripe_customer_id text,
  stripe_payment_method_id text, payment_method_type text, individual_amount numeric,
  currency text, stripe_payment_intent_id text, updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.participant_id, m.status, m.stripe_customer_id, m.stripe_payment_method_id,
         m.payment_method_type,
         least(fr.individual_amount, coalesce(m.max_amount, m.individual_amount)),
         m.currency, m.stripe_payment_intent_id, m.updated_at
  from public.funding_mandates m
  join public.funding_requests fr on fr.id = m.funding_request_id
  where m.funding_request_id = p_funding_request_id and m.charge_attempt = fr.charge_attempt
  order by m.created_at;
$$;
revoke execute on function public.get_funding_charge_batch(uuid) from public, anon, authenticated;
grant execute on function public.get_funding_charge_batch(uuid) to service_role;

-- ---- reprice a locked element ------------------------------------------------
-- Returns 'unchanged' | 'within_cushion' | 'over_cushion'.
create or replace function public.reprice_locked_element(p_element_id uuid, p_unit_price numeric)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_state text;
  v_option_id uuid;
  v_fr record;
  v_els uuid[];
  v_required numeric;
  v_individual numeric;
  v_min_cap numeric;
  v_is_service boolean := coalesce(auth.role(), '') = 'service_role';
begin
  if p_unit_price is null or p_unit_price < 0 then
    raise exception 'enter a valid price';
  end if;
  select trip_id, state, locked_option_id into v_trip_id, v_state, v_option_id
    from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if v_state <> 'locked' or v_option_id is null then
    raise exception 'only a locked element''s price can be updated';
  end if;

  select fr.id, fr.status, fr.charge_status, fr.individual_amount, fr.purchaser_id into v_fr
    from public.funding_request_elements fre join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = p_element_id and fr.status <> 'superseded'
    limit 1 for update of fr;

  if not v_is_service and not (public.is_trip_organizer(v_trip_id) or auth.uid() = v_fr.purchaser_id) then
    raise exception 'only the organizer, a co-organizer or the purchaser can update the price';
  end if;
  if v_fr.id is not null then
    if v_fr.status <> 'collecting' or v_fr.charge_status is not null then
      raise exception 'funding has already moved on — the price can''t change now';
    end if;
    if exists (select 1 from public.funding_contributions c where c.funding_request_id = v_fr.id and c.refunded_at is null) then
      raise exception 'people have already paid fixed shares — the price can''t change now';
    end if;
  end if;

  update public.element_options
    set unit_price = p_unit_price,
        value = jsonb_set(value, '{price}', to_jsonb(p_unit_price::text))
    where id = v_option_id;

  if v_fr.id is null then
    return 'unchanged';
  end if;

  select array_agg(element_id) into v_els from public.funding_request_elements where funding_request_id = v_fr.id;
  select sum(public.calculate_required_amount(e.id)) into v_required
    from public.trip_elements e where e.id = any(v_els) and e.type not in ('dates', 'destination');
  v_individual := round(coalesce(v_required, 0) / greatest(public.funding_request_participant_population(v_els), 1), 2);

  if v_individual = v_fr.individual_amount then
    return 'unchanged';
  end if;

  update public.funding_requests
    set required_amount = coalesce(v_required, required_amount),
        previous_individual_amount = v_fr.individual_amount,
        individual_amount = v_individual,
        price_changed_at = now()
    where id = v_fr.id;

  -- Not-yet-finished authorizations carry the old share/cap: restart them.
  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'price updated'
    where funding_request_id = v_fr.id and status = 'pending';

  select min(coalesce(max_amount, individual_amount)) into v_min_cap
    from public.funding_mandates where funding_request_id = v_fr.id and status = 'active';

  if v_min_cap is not null and v_individual > v_min_cap then
    update public.funding_mandates
      set status = 'canceled', canceled_at = now(), updated_at = now(),
          failure_reason = 'price rose beyond the cushion — authorize again at the new price'
      where funding_request_id = v_fr.id and status = 'active';
    perform public.refresh_funding_mandate_readiness(v_fr.id);
    return 'over_cushion';
  end if;
  return 'within_cushion';
end;
$$;
grant execute on function public.reprice_locked_element(uuid, numeric) to authenticated, service_role;

-- ---- cushion settings --------------------------------------------------------
create or replace function public.update_trip_cushion(p_trip_id uuid, p_kind text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can change trip settings';
  end if;
  if p_kind not in ('percent', 'amount') or p_value is null or p_value < 0 or (p_kind = 'percent' and p_value > 100) then
    raise exception 'the price cushion must be 0–100%% or a non-negative amount';
  end if;
  update public.trips set price_cushion_kind = p_kind, price_cushion_value = p_value where id = p_trip_id;
end;
$$;
grant execute on function public.update_trip_cushion(uuid, text, numeric) to authenticated;

-- Element override; null kind = use the trip's. Same window as spots.
create or replace function public.set_element_cushion(p_element_id uuid, p_kind text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can set the price cushion';
  end if;
  if p_kind is not null and (p_kind not in ('percent', 'amount') or p_value is null or p_value < 0 or (p_kind = 'percent' and p_value > 100)) then
    raise exception 'the price cushion must be 0–100%% or a non-negative amount';
  end if;
  if exists (
    select 1 from public.funding_request_elements fre
    join public.funding_mandates m on m.funding_request_id = fre.funding_request_id
    where fre.element_id = p_element_id and m.status in ('active', 'charging', 'charge_succeeded')
  ) then
    raise exception 'people have already authorized against the current cushion — it can''t change now';
  end if;
  update public.trip_elements
    set cushion_kind = p_kind, cushion_value = case when p_kind is null then null else p_value end
    where id = p_element_id;
end;
$$;
grant execute on function public.set_element_cushion(uuid, text, numeric) to authenticated;

-- ---- recheck support: what the job should re-quote ---------------------------
-- Collecting, uncharged requests with a vendor-sourced locked option,
-- deadline within p_hours (the charge job rechecks right before charging).
create or replace function public.list_vendor_priced_elements_due(p_hours int)
returns table (element_id uuid, value jsonb, unit_price numeric, pricing_basis text)
language sql
stable
security definer
set search_path = public
as $$
  select e.id, o.value, o.unit_price, o.pricing_basis
  from public.trip_elements e
  join public.element_options o on o.id = e.locked_option_id
  join public.funding_request_elements fre on fre.element_id = e.id
  join public.funding_requests fr on fr.id = fre.funding_request_id
  where e.state = 'locked' and fr.status = 'collecting' and fr.charge_status is null
    and o.value->>'vendor_source' in ('duffel', 'liteapi')
    and fr.funding_deadline is not null and fr.funding_deadline <= now() + make_interval(hours => p_hours);
$$;
revoke execute on function public.list_vendor_priced_elements_due(int) from public, anon, authenticated;
grant execute on function public.list_vendor_priced_elements_due(int) to service_role;

notify pgrst, 'reload schema';
