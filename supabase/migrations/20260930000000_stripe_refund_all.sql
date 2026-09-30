-- ============================================================================
-- Flow #4 follow-up: organizer-initiated "Refund everyone" (Stripe TEST MODE)
-- + guards so held money can't be stranded.
--
-- Before this, real Stripe refunds only happened automatically on a failed
-- charge batch. Cancelling a FUNDED element/trip had no money path at all —
-- only mark_funding_request_refunded(), a manual flag that moves nothing.
--
--   * request_funding_refund_all() — organizer asks for every succeeded
--     Stripe charge on a request to be refunded (allowed after booking too:
--     with no Issuing card yet, the pooled money is still in Catoco's Stripe
--     balance even once the purchaser has booked on their own card). Any
--     not-yet-charged authorization is canceled.
--   * The refund itself is issued server-side (lib/stripe/charges.ts) and
--     the ledger flips only on charge.refunded (webhook). Once every
--     Stripe contribution on a refund-all request is refunded,
--     funding_requests.refunded_at is set automatically — the same column
--     delete_trip() and the "Refunded" UI already read.
--   * Guards: delete_element(), "Report unavailable" (cascade), manual
--     mark-refunded, and marking a refunded pool booked all refuse while
--     real Stripe money is held / after it's been returned.
-- Additive and backward-compatible: requests with no Stripe contributions
-- (production's manual ledger) behave exactly as before.
-- ============================================================================

alter table public.funding_requests
  add column if not exists refund_all_requested_at timestamptz;

-- Real money still held on a request: Stripe charges not yet refunded.
create or replace function public.funding_request_held_stripe_count(p_funding_request_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int from public.funding_contributions
  where funding_request_id = p_funding_request_id and source = 'stripe' and refunded_at is null;
$$;
revoke execute on function public.funding_request_held_stripe_count(uuid) from public, anon, authenticated;

-- ---- organizer: refund everyone ------------------------------------------
create or replace function public.request_funding_refund_all(p_funding_request_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fr record;
  v_held int;
begin
  select id, trip_id, charge_status into v_fr
    from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_trip_organizer(v_fr.trip_id) then
    raise exception 'only the organizer or a co-organizer can refund this';
  end if;
  if v_fr.charge_status = 'charging' then
    raise exception 'charges are still processing — wait for them to settle before refunding';
  end if;
  v_held := public.funding_request_held_stripe_count(p_funding_request_id);
  if v_held = 0 then
    raise exception 'there''s no collected money on this to refund';
  end if;

  update public.funding_requests
    set refund_all_requested_at = coalesce(refund_all_requested_at, now())
    where id = p_funding_request_id;

  -- Nobody gets charged later for a pool that's being unwound.
  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(),
        failure_reason = 'pool refunded by organizer'
    where funding_request_id = p_funding_request_id and status in ('pending', 'active');

  return v_held;
end;
$$;
grant execute on function public.request_funding_refund_all(uuid) to authenticated;

-- ---- refundable = failed batch OR organizer refund-all --------------------
create or replace function public.list_refundable_contributions(p_funding_request_id uuid)
returns table (contribution_id uuid, stripe_payment_intent_id text, amount numeric)
language sql
stable
security definer
set search_path = public
as $$
  select fc.id, fc.stripe_payment_intent_id, fc.amount
  from public.funding_contributions fc
  join public.funding_requests fr on fr.id = fc.funding_request_id
  where fc.funding_request_id = p_funding_request_id
    and (fr.charge_status = 'failed' or fr.refund_all_requested_at is not null)
    and fc.source = 'stripe'
    and fc.refunded_at is null
    and fc.stripe_refund_id is null;
$$;

-- Every request the cron should (re)try refunds for.
create or replace function public.list_funding_requests_owing_refunds()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select fr.id from public.funding_requests fr
  where (fr.charge_status = 'failed' or fr.refund_all_requested_at is not null)
    and exists (
      select 1 from public.funding_contributions fc
      where fc.funding_request_id = fr.id and fc.source = 'stripe'
        and fc.refunded_at is null and fc.stripe_refund_id is null
    );
$$;
revoke execute on function public.list_funding_requests_owing_refunds() from public, anon, authenticated;
grant execute on function public.list_funding_requests_owing_refunds() to service_role;

-- charge.refunded: also closes out a refund-all request once the last
-- Stripe charge on it is back with its payer.
create or replace function public.record_contribution_refunded(p_payment_intent_id text, p_refund_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fc record;
begin
  update public.funding_contributions
    set refunded_at = coalesce(refunded_at, now()),
        stripe_refund_id = coalesce(stripe_refund_id, p_refund_id)
    where stripe_payment_intent_id = p_payment_intent_id
    returning id, funding_request_id, mandate_id into v_fc;
  if v_fc.id is null then
    return null;
  end if;
  update public.funding_mandates
    set status = 'refunded', updated_at = now()
    where id = v_fc.mandate_id and status = 'charge_succeeded';

  update public.funding_requests
    set refunded_at = now()
    where id = v_fc.funding_request_id
      and refund_all_requested_at is not null
      and refunded_at is null
      and public.funding_request_held_stripe_count(id) = 0;
  return v_fc.funding_request_id;
end;
$$;

-- ---- guards ---------------------------------------------------------------

-- Manual flag can't be used to paper over real money.
create or replace function public.mark_funding_request_refunded(p_funding_request_id uuid)
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
    raise exception 'only the organizer or a co-organizer can mark this refunded';
  end if;
  if public.funding_request_held_stripe_count(p_funding_request_id) > 0 then
    raise exception 'this has real card/bank payments on it — use Refund everyone instead';
  end if;

  update public.funding_requests set refunded_at = now() where id = p_funding_request_id;
end;
$$;

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
    from public.trip_elements where id = p_element_id;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not (public.is_trip_organizer(v_trip_id) or auth.uid() = v_created_by) then
    raise exception 'only the organizer, a co-organizer, or the element''s creator can delete it';
  end if;

  -- Money first: nothing gets deleted out from under a live charge or
  -- collected-but-unrefunded payments.
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
      select count(*) from public.funding_request_elements
      where funding_request_id = v_fr_id and element_id <> p_element_id
    ) = 0 then
      update public.funding_requests set status = 'superseded' where id = v_fr_id;
      update public.funding_mandates
        set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'element deleted'
        where funding_request_id = v_fr_id and status in ('pending', 'active');
    end if;
  end loop;

  delete from public.trip_elements where id = p_element_id;
end;
$$;

create or replace function public.cascade_element_unavailable(p_element_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_alt_option_id uuid;
begin
  select trip_id into v_trip_id from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;

  if exists (
    select 1 from public.funding_request_elements fre
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = p_element_id and fr.status in ('collecting', 'ready_to_purchase')
      and (fr.charge_status = 'charging' or public.funding_request_held_stripe_count(fr.id) > 0)
  ) then
    raise exception 'people have paid for this — refund everyone before moving on from it';
  end if;

  update public.funding_mandates m
    set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'element fell through'
    from public.funding_request_elements fre
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where m.funding_request_id = fr.id and fre.element_id = p_element_id
      and fr.status in ('collecting', 'ready_to_purchase')
      and m.status in ('pending', 'active');

  update public.funding_requests fr
    set status = 'superseded'
    where status in ('collecting', 'ready_to_purchase')
      and exists (
        select 1 from public.funding_request_elements fre
        where fre.funding_request_id = fr.id and fre.element_id = p_element_id
      );

  select public.get_runner_up_option(p_element_id) into v_alt_option_id;

  if v_alt_option_id is not null then
    update public.trip_elements
      set locked_option_id = v_alt_option_id, locked_via = 'vote'
      where id = p_element_id;
    perform public.create_funding_request_for_element(p_element_id);
  else
    update public.trip_elements
      set state = 'open', locked_option_id = null, locked_via = null
      where id = p_element_id;
  end if;
end;
$$;

create or replace function public.report_element_booked(
  p_element_id uuid,
  p_outcome text,
  p_actual_amount_paid numeric default null
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
  v_fr_id uuid;
  v_purchaser_id uuid;
  v_fr_status text;
  v_required numeric;
  v_refund_requested timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_outcome not in ('booked', 'unavailable') then
    raise exception 'bad outcome: %', p_outcome;
  end if;

  select trip_id, created_by, state into v_trip_id, v_created_by, v_state
    from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if v_state <> 'locked' then
    raise exception 'element must be locked before it can be reported';
  end if;

  select fr.id, fr.purchaser_id, fr.status, fr.required_amount, fr.refund_all_requested_at
    into v_fr_id, v_purchaser_id, v_fr_status, v_required, v_refund_requested
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    where fre.element_id = p_element_id
      and fr.status in ('collecting', 'ready_to_purchase')
    limit 1;

  if v_fr_id is not null then
    if not (v_uid = v_purchaser_id or public.is_trip_organizer(v_trip_id)) then
      raise exception 'only the purchaser, organizer, or co-organizer can report this';
    end if;
    if p_outcome = 'booked' and v_fr_status <> 'ready_to_purchase' then
      raise exception 'funding is not ready to purchase yet';
    end if;
    if p_outcome = 'booked' and v_refund_requested is not null then
      raise exception 'this pool has been refunded — it can''t be marked booked';
    end if;
  else
    if not (v_uid = v_created_by or public.is_trip_organizer(v_trip_id)) then
      raise exception 'only the organizer, a co-organizer, or the element''s creator can report this';
    end if;
  end if;

  if p_outcome = 'unavailable' then
    perform public.cascade_element_unavailable(p_element_id);
    return;
  end if;

  update public.trip_elements set booked_at = now() where id = p_element_id;

  if v_fr_id is not null then
    update public.funding_requests
      set status = 'booked',
          actual_amount_paid = coalesce(p_actual_amount_paid, v_required),
          booked_at = now()
      where id = v_fr_id;
  end if;
end;
$$;

notify pgrst, 'reload schema';

-- delete_trip: same logic as 20260929000000; only the message changes —
-- "Mark them refunded" pointed at the manual flag, which now refuses
-- whenever real Stripe money is held.
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
  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
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

  delete from public.trips where id = p_trip_id;
end;
$$;

notify pgrst, 'reload schema';
