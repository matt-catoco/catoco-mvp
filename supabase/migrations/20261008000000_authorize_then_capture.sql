-- ============================================================================
-- Flow #4 fix: authorize-then-capture + retry buffer (founder, 2026-10-07).
-- Replaces "one failed charge fails the pool and refunds everyone".
--
-- Batch phases (funding_requests.charge_status):
--   charging   holds are being placed; a failed card hold waits in its retry
--              window (mandate 'awaiting_retry') while everyone else's hold
--              sits untouched ('held' = PaymentIntent requires_capture —
--              nothing charged, no fee).
--   capturing  every card hold succeeded: capture them all, and only now
--              confirm SEPA debits (SEPA has no hold).
--   charged    every mandate settled.
--   failed     retry window expired (other holds CANCELED — nothing to
--              refund), or a settlement failure (a SEPA debit or a capture
--              failed after money moved — the one case that still refunds).
--
-- Retry window: funding_requests.retry_deadline, set when the first hold in
-- the batch fails = max(now, funding deadline) + trips.payment_retry_hours
-- (default 24), organizer-extendable, never past hold_cap_at = 6 days after
-- the batch started (card holds last ~7 days; a day of margin).
-- retry_reason says what the participant must do:
--   payment_method_failed   declined/expired/insufficient → add a new
--                           payment method (fresh SetupIntent)
--   authentication_required SCA/3-D Secure → come back on-session and
--                           authenticate the same PaymentIntent
--
-- The organizer's "Refund everyone" (request_funding_refund_all) stays as a
-- deliberate action for cancelling a funded element; list_refundable_
-- contributions' charge_status = 'failed' branch is now reached only by a
-- settlement failure, never by an ordinary card decline.
-- ============================================================================

alter table public.funding_mandates drop constraint if exists funding_mandates_status_check;
alter table public.funding_mandates add constraint funding_mandates_status_check check (status in (
  'pending', 'active', 'charging', 'held', 'awaiting_retry',
  'charge_succeeded', 'charge_failed', 'canceled', 'refunded'));

alter table public.funding_mandates
  add column if not exists retry_reason text,
  add column if not exists hold_attempt int not null default 0,
  add column if not exists held_at timestamptz;
alter table public.funding_mandates drop constraint if exists funding_mandates_retry_reason_check;
alter table public.funding_mandates add constraint funding_mandates_retry_reason_check
  check (retry_reason is null or retry_reason in ('payment_method_failed', 'authentication_required'));

alter table public.funding_requests drop constraint if exists funding_requests_charge_status_check;
alter table public.funding_requests add constraint funding_requests_charge_status_check
  check (charge_status is null or charge_status in ('charging', 'capturing', 'charged', 'failed'));

alter table public.funding_requests
  add column if not exists retry_deadline timestamptz,
  add column if not exists hold_cap_at timestamptz;

alter table public.trips
  add column if not exists payment_retry_hours int not null default 24;
alter table public.trips drop constraint if exists trips_payment_retry_hours_check;
alter table public.trips add constraint trips_payment_retry_hours_check check (payment_retry_hours between 1 and 144);

-- ---- claim a batch: holds phase ---------------------------------------------
create or replace function public.begin_funding_charge_batch(p_funding_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fr record;
  v_attempt int;
begin
  select id, status, charge_status, funding_deadline, charge_attempt into v_fr
    from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null or v_fr.status <> 'collecting' or v_fr.charge_status is not null
     or v_fr.funding_deadline is null or v_fr.funding_deadline > now() then
    return null;
  end if;

  update public.funding_mandates m
    set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'no longer opted in'
    where m.funding_request_id = p_funding_request_id
      and m.status in ('pending', 'active')
      and not exists (
        select 1 from public.funding_request_elements fre
        join public.element_participants ep on ep.element_id = fre.element_id
        where fre.funding_request_id = p_funding_request_id
          and ep.participant_id = m.participant_id and ep.opted_in = true
      );

  if public.funding_request_covered_count(p_funding_request_id)
     < public.funding_request_population_for(p_funding_request_id) then
    perform public.fail_funding_charge_batch(p_funding_request_id, 'not_fully_mandated');
    return 'not_fully_mandated';
  end if;

  v_attempt := v_fr.charge_attempt + 1;
  update public.funding_requests
    set charge_status = 'charging', charge_attempt = v_attempt, charge_started_at = now(),
        charge_failure_reason = null, retry_deadline = null,
        hold_cap_at = now() + interval '6 days'
    where id = p_funding_request_id;

  update public.funding_mandates
    set status = 'charging', charge_attempt = v_attempt, updated_at = now(),
        retry_reason = null, held_at = null
    where funding_request_id = p_funding_request_id and status = 'active';

  return 'charging';
end;
$$;

create or replace function public.settle_funding_charge_batch(p_funding_request_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fr record;
begin
  select id, status, charge_status, charge_attempt into v_fr
    from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null then
    return null;
  end if;
  if v_fr.charge_status in ('charging', 'capturing') and not exists (
    select 1 from public.funding_mandates
    where funding_request_id = p_funding_request_id
      and charge_attempt = v_fr.charge_attempt
      and status <> 'charge_succeeded'
  ) then
    update public.funding_requests
      set charge_status = 'charged', retry_deadline = null,
          status = case when status = 'collecting' then 'ready_to_purchase' else status end
      where id = p_funding_request_id;
    return 'charged';
  end if;
  return v_fr.charge_status;
end;
$$;

-- Settlement failure / not fully mandated: every mandate still in play is
-- canceled (the caller cancels any open card holds on Stripe's side).
create or replace function public.fail_funding_charge_batch(p_funding_request_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.funding_requests
    set charge_status = 'failed',
        charge_failure_reason = coalesce(charge_failure_reason, p_reason),
        fully_mandated_at = null,
        retry_deadline = null
    where id = p_funding_request_id and charge_status is distinct from 'charged';

  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(),
        failure_reason = coalesce(failure_reason, 'batch failed: ' || p_reason)
    where funding_request_id = p_funding_request_id
      and (status in ('pending', 'active', 'held', 'awaiting_retry')
           or (status = 'charging' and stripe_payment_intent_id is null));
end;
$$;

-- Settlement failures only now (a SEPA debit or a capture failing after
-- money moved). A failed card HOLD goes to mark_mandate_awaiting_retry.
create or replace function public.mark_mandate_charge_failed(p_mandate_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fr_id uuid;
begin
  update public.funding_mandates
    set status = 'charge_failed', failure_reason = p_reason, updated_at = now()
    where id = p_mandate_id and status in ('charging', 'active', 'held')
    returning funding_request_id into v_fr_id;
  if v_fr_id is null then
    select funding_request_id into v_fr_id from public.funding_mandates where id = p_mandate_id;
    return v_fr_id;
  end if;
  perform public.fail_funding_charge_batch(v_fr_id, 'settlement_failed');
  return v_fr_id;
end;
$$;

drop function if exists public.get_funding_charge_batch(uuid);
create function public.get_funding_charge_batch(p_funding_request_id uuid)
returns table (
  mandate_id uuid, participant_id uuid, status text, stripe_customer_id text,
  stripe_payment_method_id text, payment_method_type text, individual_amount numeric,
  currency text, stripe_payment_intent_id text, updated_at timestamptz,
  retry_reason text, hold_attempt int
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.participant_id, m.status, m.stripe_customer_id, m.stripe_payment_method_id,
         m.payment_method_type,
         least(fr.individual_amount, coalesce(m.max_amount, m.individual_amount)),
         m.currency, m.stripe_payment_intent_id, m.updated_at, m.retry_reason, m.hold_attempt
  from public.funding_mandates m
  join public.funding_requests fr on fr.id = m.funding_request_id
  where m.funding_request_id = p_funding_request_id and m.charge_attempt = fr.charge_attempt
  order by m.created_at;
$$;

-- ---- hold outcomes -------------------------------------------------------------
create or replace function public.mark_mandate_held(p_mandate_id uuid, p_payment_intent_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fr_id uuid;
begin
  update public.funding_mandates m
    set status = 'held', held_at = now(), retry_reason = null, failure_reason = null,
        stripe_payment_intent_id = p_payment_intent_id, updated_at = now()
    from public.funding_requests fr
    where m.id = p_mandate_id and fr.id = m.funding_request_id
      and fr.charge_status = 'charging' and m.status in ('charging', 'awaiting_retry', 'held')
    returning m.funding_request_id into v_fr_id;
  return v_fr_id;
end;
$$;

-- Returns the funding request and whether this is a NEW entry into the
-- retry window (so the caller emails the participant + organizer once).
create or replace function public.mark_mandate_awaiting_retry(
  p_mandate_id uuid, p_payment_intent_id text, p_reason text, p_detail text
)
returns table (funding_request_id uuid, newly_awaiting boolean, retry_deadline timestamptz)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_m record;
  v_fr record;
  v_hours int;
  v_deadline timestamptz;
begin
  if p_reason not in ('payment_method_failed', 'authentication_required') then
    raise exception 'bad retry reason %', p_reason;
  end if;
  select m.id, m.status, m.funding_request_id into v_m
    from public.funding_mandates m where m.id = p_mandate_id for update;
  select fr.id, fr.charge_status, fr.funding_deadline, fr.retry_deadline, fr.hold_cap_at, fr.trip_id into v_fr
    from public.funding_requests fr where fr.id = v_m.funding_request_id for update;
  if v_m.id is null or v_fr.charge_status is distinct from 'charging'
     or v_m.status not in ('charging', 'held', 'awaiting_retry') then
    return query select v_m.funding_request_id, false, v_fr.retry_deadline;
    return;
  end if;

  select t.payment_retry_hours into v_hours from public.trips t where t.id = v_fr.trip_id;
  v_deadline := v_fr.retry_deadline;
  if v_deadline is null then
    v_deadline := least(greatest(now(), v_fr.funding_deadline) + make_interval(hours => coalesce(v_hours, 24)),
                        coalesce(v_fr.hold_cap_at, now() + interval '6 days'));
    update public.funding_requests fr2 set retry_deadline = v_deadline where fr2.id = v_fr.id;
  end if;

  update public.funding_mandates
    set status = 'awaiting_retry', retry_reason = p_reason, failure_reason = p_detail,
        stripe_payment_intent_id = coalesce(p_payment_intent_id, stripe_payment_intent_id),
        held_at = null, updated_at = now()
    where id = p_mandate_id;

  return query select v_fr.id, v_m.status <> 'awaiting_retry', v_deadline;
end;
$$;

-- Participant fixed it: a new payment method (or, with nulls, the same one
-- after an expired hold). The mandate goes back to 'charging' with no
-- PaymentIntent, and the next pass places a fresh hold.
create or replace function public.reset_mandate_for_new_hold(
  p_mandate_id uuid, p_payment_method_id text, p_payment_method_type text, p_setup_intent_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fr_id uuid;
begin
  if p_payment_method_type is not null and p_payment_method_type not in ('card', 'sepa_debit') then
    raise exception 'unsupported payment method type %', p_payment_method_type;
  end if;
  update public.funding_mandates m
    set status = 'charging', stripe_payment_intent_id = null, retry_reason = null,
        failure_reason = null, held_at = null, hold_attempt = m.hold_attempt + 1,
        stripe_payment_method_id = coalesce(p_payment_method_id, m.stripe_payment_method_id),
        payment_method_type = coalesce(p_payment_method_type, m.payment_method_type),
        stripe_setup_intent_id = coalesce(p_setup_intent_id, m.stripe_setup_intent_id),
        updated_at = now()
    from public.funding_requests fr
    where m.id = p_mandate_id and fr.id = m.funding_request_id
      and fr.charge_status = 'charging' and m.status in ('awaiting_retry', 'held')
    returning m.funding_request_id into v_fr_id;
  return v_fr_id;
end;
$$;

-- ---- capture: only when every card hold is in ------------------------------
create or replace function public.begin_funding_capture(p_funding_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fr record;
begin
  select id, charge_status, charge_attempt into v_fr
    from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null or v_fr.charge_status <> 'charging' then
    return false;
  end if;
  -- Ready = every mandate in the batch is a held card, or a SEPA mandate
  -- not yet fired (SEPA is debited in the capture pass).
  if exists (
    select 1 from public.funding_mandates m
    where m.funding_request_id = p_funding_request_id and m.charge_attempt = v_fr.charge_attempt
      and not (m.status = 'held'
               or (m.status = 'charging' and m.payment_method_type = 'sepa_debit' and m.stripe_payment_intent_id is null))
  ) then
    return false;
  end if;
  update public.funding_requests set charge_status = 'capturing', retry_deadline = null where id = p_funding_request_id;
  return true;
end;
$$;

-- ---- retry window expired: release everyone else's hold ---------------------
-- Returns the PaymentIntents the caller must cancel on Stripe (holds and
-- failed attempts). Nothing was captured, so nothing is refunded.
create or replace function public.expire_funding_retry(p_funding_request_id uuid)
returns setof text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fr record;
  v_intents text[];
begin
  select id, charge_status, retry_deadline, hold_cap_at, charge_attempt into v_fr
    from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null or v_fr.charge_status <> 'charging'
     or not (coalesce(v_fr.retry_deadline, 'infinity') <= now() or coalesce(v_fr.hold_cap_at, 'infinity') <= now()) then
    return;
  end if;

  select array_agg(stripe_payment_intent_id) into v_intents
    from public.funding_mandates
    where funding_request_id = p_funding_request_id and charge_attempt = v_fr.charge_attempt
      and status in ('held', 'awaiting_retry', 'charging') and stripe_payment_intent_id is not null;

  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(),
        failure_reason = coalesce(case when status = 'awaiting_retry' then failure_reason end, 'retry window expired — hold released')
    where funding_request_id = p_funding_request_id and charge_attempt = v_fr.charge_attempt
      and status in ('held', 'awaiting_retry', 'charging');

  update public.funding_requests
    set charge_status = 'failed', charge_failure_reason = 'retry_expired',
        fully_mandated_at = null, retry_deadline = null
    where id = p_funding_request_id;

  return query select unnest(coalesce(v_intents, array[]::text[]));
end;
$$;

create or replace function public.list_funding_retries_due()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.funding_requests
  where charge_status = 'charging'
    and (retry_deadline <= now() or hold_cap_at <= now());
$$;

-- ---- organizer: more time for the retry --------------------------------------
create or replace function public.extend_funding_retry(p_funding_request_id uuid, p_hours int)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fr record;
  v_new timestamptz;
begin
  select id, trip_id, charge_status, retry_deadline, hold_cap_at into v_fr
    from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_trip_organizer(v_fr.trip_id) then
    raise exception 'only the organizer or a co-organizer can extend the payment retry window';
  end if;
  if v_fr.charge_status <> 'charging' or v_fr.retry_deadline is null then
    raise exception 'nobody is waiting on a payment retry right now';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 144 then
    raise exception 'extend by 1–144 hours';
  end if;
  v_new := least(v_fr.retry_deadline + make_interval(hours => p_hours), v_fr.hold_cap_at);
  if v_new <= v_fr.retry_deadline then
    raise exception 'card holds only last about a week — this can''t be extended any further';
  end if;
  update public.funding_requests set retry_deadline = v_new where id = p_funding_request_id;
  return v_new;
end;
$$;
grant execute on function public.extend_funding_retry(uuid, int) to authenticated;

create or replace function public.update_trip_retry_hours(p_trip_id uuid, p_hours int)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can change trip settings';
  end if;
  if p_hours is null or p_hours not between 1 and 144 then
    raise exception 'the payment retry window must be 1–144 hours';
  end if;
  update public.trips set payment_retry_hours = p_hours where id = p_trip_id;
end;
$$;
grant execute on function public.update_trip_retry_hours(uuid, int) to authenticated;

-- ---- capture success: record the contribution (also from 'held') ------------
create or replace function public.record_stripe_contribution(
  p_mandate_id uuid, p_payment_intent_id text, p_charge_id text,
  p_amount numeric, p_fee numeric, p_fee_currency text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m record;
begin
  select id, funding_request_id, participant_id, payment_method_type, status into v_m
    from public.funding_mandates where id = p_mandate_id for update;
  if v_m.id is null then
    raise exception 'mandate % not found', p_mandate_id;
  end if;

  insert into public.funding_contributions
    (funding_request_id, contributor_id, amount, source, mandate_id,
     stripe_payment_intent_id, stripe_charge_id, payment_method_type, stripe_fee, stripe_fee_currency)
  values
    (v_m.funding_request_id, v_m.participant_id, p_amount, 'stripe', v_m.id,
     p_payment_intent_id, p_charge_id, v_m.payment_method_type, p_fee, upper(p_fee_currency))
  on conflict (stripe_payment_intent_id) where stripe_payment_intent_id is not null do nothing;

  update public.funding_mandates
    set status = 'charge_succeeded', charged_at = coalesce(charged_at, now()),
        stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
        updated_at = now()
    where id = v_m.id and status in ('charging', 'held', 'active', 'canceled');

  return public.settle_funding_charge_batch(v_m.funding_request_id);
end;
$$;

-- ---- new statuses count as "in" everywhere that asks -------------------------
create or replace function public.funding_request_spots_full(p_funding_request_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.funding_request_covered_count(p_funding_request_id)
           >= public.funding_request_population_for(p_funding_request_id)
     and not exists (
       select 1 from public.funding_mandates m
       where m.funding_request_id = p_funding_request_id and m.participant_id = p_user_id
         and m.status in ('active', 'charging', 'held', 'awaiting_retry', 'charge_succeeded'))
     and not exists (
       select 1 from public.funding_contributions c
       where c.funding_request_id = p_funding_request_id and c.contributor_id = p_user_id and c.refunded_at is null);
$$;

create or replace function public.participant_departure_block(p_trip_id uuid, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_label text;
begin
  select e.label into v_label
    from public.funding_contributions fc
    join public.funding_requests fr on fr.id = fc.funding_request_id
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    join public.trip_elements e on e.id = fre.element_id
    where fr.trip_id = p_trip_id and fc.contributor_id = p_user_id
      and fc.refunded_at is null and fr.refunded_at is null and fr.status <> 'superseded'
    limit 1;
  if v_label is not null then
    return format('an unsettled payment on "%s" — it needs to be refunded first', v_label);
  end if;

  select e.label into v_label
    from public.funding_mandates m
    join public.funding_requests fr on fr.id = m.funding_request_id
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    join public.trip_elements e on e.id = fre.element_id
    where fr.trip_id = p_trip_id and m.participant_id = p_user_id
      and m.status in ('active', 'charging', 'held', 'awaiting_retry', 'charge_succeeded')
      and fr.refunded_at is null and fr.status <> 'superseded'
    limit 1;
  if v_label is not null then
    return format('a payment authorization on "%s" — it needs to be canceled first', v_label);
  end if;

  select e.label into v_label
    from public.element_participants ep
    join public.trip_elements e on e.id = ep.element_id
    join public.funding_request_elements fre on fre.element_id = e.id
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where e.trip_id = p_trip_id and ep.participant_id = p_user_id and ep.opted_in = true
      and e.state = 'locked'
      and fr.status in ('collecting', 'ready_to_purchase', 'booked')
      and fr.refunded_at is null
    limit 1;
  if v_label is not null then
    return format('a share in "%s", which is already locked with its cost split — the organizer needs to settle that first', v_label);
  end if;

  return null;
end;
$$;

-- Email when a mandate enters its retry window (participant + organizer).
alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check check (kind in (
  'invited', 'funding_ready', 'vote_needed', 'funding_needed', 'funding_deadline_set', 'payment_retry_needed'));

-- service-role-only plumbing
revoke execute on function public.get_funding_charge_batch(uuid) from public, anon, authenticated;
revoke execute on function public.mark_mandate_held(uuid, text) from public, anon, authenticated;
revoke execute on function public.mark_mandate_awaiting_retry(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.reset_mandate_for_new_hold(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function public.begin_funding_capture(uuid) from public, anon, authenticated;
revoke execute on function public.expire_funding_retry(uuid) from public, anon, authenticated;
revoke execute on function public.list_funding_retries_due() from public, anon, authenticated;
revoke execute on function public.record_stripe_contribution(uuid, text, text, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.get_funding_charge_batch(uuid) to service_role;
grant execute on function public.mark_mandate_held(uuid, text) to service_role;
grant execute on function public.mark_mandate_awaiting_retry(uuid, text, text, text) to service_role;
grant execute on function public.reset_mandate_for_new_hold(uuid, text, text, text) to service_role;
grant execute on function public.begin_funding_capture(uuid) to service_role;
grant execute on function public.expire_funding_retry(uuid) to service_role;
grant execute on function public.list_funding_retries_due() to service_role;
grant execute on function public.record_stripe_contribution(uuid, text, text, numeric, numeric, text) to service_role;

notify pgrst, 'reload schema';

-- Live retry-buffer status for everyone on the funding request (members
-- only): "Waiting on 1 participant to update payment — 18h left".
create or replace function public.get_funding_retry_status(p_funding_request_id uuid)
returns table (waiting int, held int, total int, retry_deadline timestamptz, hold_cap_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_funding_request_member(p_funding_request_id) then
    raise exception 'not a member of this funding request';
  end if;
  return query
    select
      (count(*) filter (where m.status = 'awaiting_retry'))::int,
      (count(*) filter (where m.status = 'held'))::int,
      count(*)::int,
      fr.retry_deadline, fr.hold_cap_at
    from public.funding_requests fr
    left join public.funding_mandates m on m.funding_request_id = fr.id and m.charge_attempt = fr.charge_attempt
      and m.status in ('charging', 'held', 'awaiting_retry', 'charge_succeeded')
    where fr.id = p_funding_request_id
    group by fr.retry_deadline, fr.hold_cap_at;
end;
$$;
grant execute on function public.get_funding_retry_status(uuid) to authenticated;
notify pgrst, 'reload schema';
