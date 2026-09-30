-- ============================================================================
-- Flow #4: mandate-based payments (Stripe, TEST MODE ONLY).
--
-- Participants authorize a payment method now (a Stripe SetupIntent — no
-- money moves, no fee); at the real funding_deadline a scheduled job fires
-- one off-session PaymentIntent per mandate. All-or-nothing: a request that
-- isn't fully mandated at its deadline, or any single charge failing, fails
-- the whole funding_request — already-succeeded charges in that batch are
-- refunded through the Stripe API, not by an organizer click.
--
-- funding_mandates is pre-charge authorization state. funding_contributions
-- keeps its meaning (real, settled money) and gains a 'stripe' source: a
-- row lands only from a succeeded PaymentIntent (webhook), and a refunded
-- one is flagged refunded_at rather than deleted, so the ledger stays whole.
--
-- Deliberately additive/backward-compatible: this database is shared with
-- the production deploy, which still calls add_funding_contribution() for
-- the manual Commit button. That RPC is left callable here (only its
-- counting is made refund-aware); revoke it once prod ships the mandate UI.
--
-- Authority split, same security-definer pattern as the rest of funding:
--   * authenticated — create/cancel your own mandate, read a summary.
--   * service_role  — everything Stripe-driven (webhook + cron): activation,
--     charge batch claim, recording charges/refunds. Nothing here trusts a
--     client to say "this charge succeeded".
-- service_role has no table grants on these tables in this project (same as
-- funding_requests), so the server side goes exclusively through RPCs.
--
-- Charge batches: funding_requests.charge_attempt increments each time a
-- batch starts; mandates pulled into it are stamped with the same number,
-- so a retried request (after a failed batch → organizer resolves "still
-- viable" → participants re-authorize) never mixes old and new mandates.
-- ============================================================================

-- ---- funding_requests: currency + charge-batch state -----------------------
alter table public.funding_requests
  add column if not exists currency text,
  add column if not exists charge_status text,
  add column if not exists charge_attempt int not null default 0,
  add column if not exists charge_started_at timestamptz,
  add column if not exists charge_failure_reason text,
  add column if not exists fully_mandated_at timestamptz;

alter table public.funding_requests drop constraint if exists funding_requests_charge_status_check;
alter table public.funding_requests
  add constraint funding_requests_charge_status_check
    check (charge_status is null or charge_status in ('charging', 'charged', 'failed'));

-- Currency was only ever in the locked option's jsonb value. Money needs it
-- snapshotted on the request itself (a SEPA mandate is only valid for EUR,
-- and a PaymentIntent needs a currency), so it's filled from the first
-- member element's locked option the moment that link row lands — keeps
-- create_funding_request_for_element() untouched. Bundles already share
-- one currency by construction (add-element-form's bundleContext).
create or replace function public.funding_request_set_currency()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.funding_requests fr
    set currency = upper(coalesce(nullif(btrim(o.value->>'currency'), ''), 'USD'))
    from public.trip_elements e
    left join public.element_options o on o.id = e.locked_option_id
    where fr.id = new.funding_request_id
      and e.id = new.element_id
      and fr.currency is null;
  return new;
end;
$$;

drop trigger if exists funding_request_elements_set_currency on public.funding_request_elements;
create trigger funding_request_elements_set_currency
  after insert on public.funding_request_elements
  for each row execute function public.funding_request_set_currency();

update public.funding_requests fr
  set currency = sub.currency
  from (
    select distinct on (fre.funding_request_id)
      fre.funding_request_id,
      upper(coalesce(nullif(btrim(o.value->>'currency'), ''), 'USD')) as currency
    from public.funding_request_elements fre
    join public.trip_elements e on e.id = fre.element_id
    left join public.element_options o on o.id = e.locked_option_id
    order by fre.funding_request_id, e.created_at
  ) sub
  where fr.id = sub.funding_request_id and fr.currency is null;

-- ---- stripe_customers: one Stripe Customer per user per mode ---------------
-- Keyed by livemode too, so a test-mode customer id can never be reused
-- against live keys. No RLS policies/grants: service role (via RPC) only.
create table if not exists public.stripe_customers (
  user_id uuid not null references auth.users(id) on delete cascade,
  livemode boolean not null,
  stripe_customer_id text not null unique,
  created_at timestamptz not null default now(),
  primary key (user_id, livemode)
);
alter table public.stripe_customers enable row level security;

-- ---- funding_mandates -------------------------------------------------------
create table if not exists public.funding_mandates (
  id uuid primary key default gen_random_uuid(),
  funding_request_id uuid not null references public.funding_requests(id) on delete cascade,
  participant_id uuid not null references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_setup_intent_id text unique,
  stripe_payment_method_id text,
  -- null while pending: the Payment Element lets the participant pick
  -- (SEPA vs card on a EUR trip), so it's only known once the SetupIntent
  -- succeeds.
  payment_method_type text check (payment_method_type is null or payment_method_type in ('card', 'sepa_debit')),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'charging', 'charge_succeeded', 'charge_failed', 'canceled', 'refunded')),
  -- Copy of the locked per-person share at mandate time — never a chosen
  -- amount, same rule as add_funding_contribution().
  individual_amount numeric not null check (individual_amount > 0),
  currency text not null,
  charge_attempt int,
  stripe_payment_intent_id text unique,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  charged_at timestamptz,
  canceled_at timestamptz
);
alter table public.funding_mandates enable row level security;
create index if not exists funding_mandates_funding_request_id_idx
  on public.funding_mandates (funding_request_id);
-- At most one live mandate per participant per request. Terminal states
-- (failed/canceled/refunded) stay as history and don't block a re-mandate
-- on a retried request.
create unique index if not exists funding_mandates_one_live_per_participant
  on public.funding_mandates (funding_request_id, participant_id)
  where status in ('pending', 'active', 'charging', 'charge_succeeded');

drop policy if exists "Participants can view their own mandates" on public.funding_mandates;
create policy "Participants can view their own mandates"
  on public.funding_mandates for select
  to authenticated
  using (participant_id = auth.uid());

drop policy if exists "Organizers can view mandates on their trips" on public.funding_mandates;
create policy "Organizers can view mandates on their trips"
  on public.funding_mandates for select
  to authenticated
  using (exists (
    select 1 from public.funding_requests fr
    where fr.id = funding_request_id and public.is_trip_organizer(fr.trip_id)
  ));

grant select on public.funding_mandates to authenticated;

-- ---- funding_contributions: Stripe-sourced rows ----------------------------
alter table public.funding_contributions
  add column if not exists source text not null default 'manual',
  add column if not exists mandate_id uuid references public.funding_mandates(id) on delete set null,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_charge_id text,
  add column if not exists payment_method_type text,
  add column if not exists stripe_fee numeric,
  add column if not exists stripe_refund_id text,
  add column if not exists refund_requested_at timestamptz,
  add column if not exists refunded_at timestamptz;

alter table public.funding_contributions drop constraint if exists funding_contributions_source_check;
alter table public.funding_contributions
  add constraint funding_contributions_source_check check (source in ('manual', 'stripe'));
create unique index if not exists funding_contributions_stripe_pi_unique
  on public.funding_contributions (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

-- ============================================================================
-- Internal helpers (no grants — reached only through the RPCs below)
-- ============================================================================

-- Distinct currently-opted-in participants across the request's elements
-- who either hold an active mandate or already have an unrefunded manual
-- contribution (pre-Stripe ledger rows still count as "covered").
create or replace function public.funding_request_covered_count(p_funding_request_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct ep.participant_id)::int
  from public.funding_request_elements fre
  join public.element_participants ep on ep.element_id = fre.element_id and ep.opted_in = true
  where fre.funding_request_id = p_funding_request_id
    and (
      exists (
        select 1 from public.funding_mandates m
        where m.funding_request_id = p_funding_request_id
          and m.participant_id = ep.participant_id
          and m.status = 'active'
      )
      or exists (
        select 1 from public.funding_contributions fc
        where fc.funding_request_id = p_funding_request_id
          and fc.contributor_id = ep.participant_id
          and fc.refunded_at is null
      )
    );
$$;

create or replace function public.funding_request_population_for(p_funding_request_id uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select public.funding_request_participant_population(
    array(select element_id from public.funding_request_elements where funding_request_id = p_funding_request_id)
  );
$$;

-- Readiness is eager (evaluated on every mandate change), the charge event
-- is not — fully_mandated_at is display state only; the cron re-checks
-- coverage for real at the deadline.
create or replace function public.refresh_funding_mandate_readiness(p_funding_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ready boolean;
begin
  v_ready := public.funding_request_covered_count(p_funding_request_id)
             >= public.funding_request_population_for(p_funding_request_id);
  update public.funding_requests
    set fully_mandated_at = case
      when v_ready then coalesce(fully_mandated_at, now())
      else null
    end
    where id = p_funding_request_id;
end;
$$;

-- Moves the request to ready_to_purchase once every mandate in the current
-- batch has a settled, succeeded charge. Returns the request's charge_status
-- afterward so callers know whether refunds are owed ('failed').
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
  if v_fr.charge_status = 'charging' and not exists (
    select 1 from public.funding_mandates
    where funding_request_id = p_funding_request_id
      and charge_attempt = v_fr.charge_attempt
      and status <> 'charge_succeeded'
  ) then
    update public.funding_requests
      set charge_status = 'charged',
          status = case when status = 'collecting' then 'ready_to_purchase' else status end
      where id = p_funding_request_id;
    return 'charged';
  end if;
  return v_fr.charge_status;
end;
$$;

-- Fails the current batch: request -> charge_status 'failed', any mandate
-- that hasn't been fired yet (or never will be) -> canceled. Mandates with a
-- PaymentIntent already in flight stay 'charging' — their outcome still
-- arrives by webhook, and a late success gets refunded then.
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
        fully_mandated_at = null
    where id = p_funding_request_id and charge_status is distinct from 'charged';

  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(),
        failure_reason = coalesce(failure_reason, 'batch failed: ' || p_reason)
    where funding_request_id = p_funding_request_id
      and (status in ('pending', 'active') or (status = 'charging' and stripe_payment_intent_id is null));
end;
$$;

-- ============================================================================
-- Participant-facing RPCs (authenticated)
-- ============================================================================

-- Creates (or restarts) the caller's pending mandate. The Stripe SetupIntent
-- is created server-side right after and attached via
-- attach_mandate_setup_intent(); a still-pending earlier attempt is
-- canceled first, so abandoning the form and coming back just works.
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

  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'superseded by a new attempt'
    where funding_request_id = p_funding_request_id and participant_id = v_uid and status = 'pending';

  insert into public.funding_mandates (funding_request_id, participant_id, individual_amount, currency)
  values (p_funding_request_id, v_uid, v_fr.individual_amount, coalesce(v_fr.currency, 'USD'))
  returning id into v_id;

  return v_id;
end;
$$;

-- Participant withdraws their authorization before the batch starts.
-- Returns the Stripe payment method id (if any) so the server can detach it.
create or replace function public.cancel_funding_mandate(p_mandate_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_m record;
  v_charge_status text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select id, participant_id, funding_request_id, status, stripe_payment_method_id into v_m
    from public.funding_mandates where id = p_mandate_id for update;
  if v_m.id is null or v_m.participant_id <> v_uid then
    raise exception 'mandate not found';
  end if;
  select charge_status into v_charge_status from public.funding_requests where id = v_m.funding_request_id;
  if v_m.status not in ('pending', 'active') or v_charge_status is not null then
    raise exception 'this authorization can no longer be canceled — charges have already started';
  end if;

  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'canceled by participant'
    where id = p_mandate_id;
  perform public.refresh_funding_mandate_readiness(v_m.funding_request_id);
  return v_m.stripe_payment_method_id;
end;
$$;

-- Counts for the funding card (members see counts, not each other's rows).
create or replace function public.get_funding_mandate_summary(p_funding_request_id uuid)
returns table (population int, covered int, active_mandates int, stripe_fees numeric)
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
      public.funding_request_population_for(p_funding_request_id),
      public.funding_request_covered_count(p_funding_request_id),
      (select count(*)::int from public.funding_mandates
        where funding_request_id = p_funding_request_id and status = 'active'),
      (select coalesce(sum(stripe_fee), 0) from public.funding_contributions
        where funding_request_id = p_funding_request_id and source = 'stripe' and refunded_at is null);
end;
$$;

grant execute on function public.create_funding_mandate(uuid) to authenticated;
grant execute on function public.cancel_funding_mandate(uuid) to authenticated;
grant execute on function public.get_funding_mandate_summary(uuid) to authenticated;

-- ============================================================================
-- Stripe-driven RPCs (service_role only: webhook + cron)
-- ============================================================================

create or replace function public.get_stripe_customer(p_user_id uuid, p_livemode boolean)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select stripe_customer_id from public.stripe_customers where user_id = p_user_id and livemode = p_livemode;
$$;

-- First writer wins; returns whichever id is stored (so a race between two
-- tabs creating a customer still converges on one).
create or replace function public.save_stripe_customer(p_user_id uuid, p_livemode boolean, p_stripe_customer_id text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
begin
  insert into public.stripe_customers (user_id, livemode, stripe_customer_id)
  values (p_user_id, p_livemode, p_stripe_customer_id)
  on conflict (user_id, livemode) do nothing;
  select stripe_customer_id into v_id from public.stripe_customers where user_id = p_user_id and livemode = p_livemode;
  return v_id;
end;
$$;

create or replace function public.attach_mandate_setup_intent(
  p_mandate_id uuid, p_stripe_customer_id text, p_setup_intent_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.funding_mandates
    set stripe_customer_id = p_stripe_customer_id,
        stripe_setup_intent_id = p_setup_intent_id,
        updated_at = now()
    where id = p_mandate_id and status = 'pending';
  if not found then
    raise exception 'mandate % is not pending', p_mandate_id;
  end if;
end;
$$;

-- setup_intent.succeeded (webhook) or the client's post-confirm sync —
-- both idempotent. Returns the funding_request_id, or null if nothing
-- changed (unknown intent / already active / no longer pending).
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
  select id, funding_request_id, status, currency into v_m
    from public.funding_mandates where stripe_setup_intent_id = p_setup_intent_id for update;
  if v_m.id is null or v_m.status <> 'pending' then
    return null;
  end if;
  if p_payment_method_type not in ('card', 'sepa_debit') then
    raise exception 'unsupported payment method type %', p_payment_method_type;
  end if;
  -- SEPA only settles in EUR; the SetupIntent is only ever offered SEPA on
  -- EUR requests, this is the backstop.
  if p_payment_method_type = 'sepa_debit' and v_m.currency <> 'EUR' then
    raise exception 'SEPA Direct Debit is only available for EUR funding requests';
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

-- setup_intent.setup_failed: the SetupIntent returns to
-- requires_payment_method and the same form can retry, so the mandate stays
-- pending — just record why.
create or replace function public.record_mandate_setup_failure(p_setup_intent_id text, p_reason text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.funding_mandates
    set failure_reason = p_reason, updated_at = now()
    where stripe_setup_intent_id = p_setup_intent_id and status = 'pending';
$$;

-- Requests whose deadline has passed and that haven't started a batch.
create or replace function public.list_due_funding_charges()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.funding_requests
  where status = 'collecting'
    and charge_status is null
    and funding_deadline is not null
    and funding_deadline <= now()
  order by funding_deadline;
$$;

-- Atomically claims a due request for charging. Returns:
--   'charging'           — batch started, mandates stamped 'charging'
--   'not_fully_mandated' — deadline missed; request failed, nothing charged
--   null                 — not claimable (already claimed / not due)
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

  -- Anyone who opted back out since authorizing isn't part of this pool.
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
        charge_failure_reason = null
    where id = p_funding_request_id;

  update public.funding_mandates
    set status = 'charging', charge_attempt = v_attempt, updated_at = now()
    where funding_request_id = p_funding_request_id and status = 'active';

  -- Edge: everyone was covered by legacy manual contributions, so there's
  -- nothing to charge — settle straight through.
  perform public.settle_funding_charge_batch(p_funding_request_id);
  return 'charging';
end;
$$;

-- Everything the charge job needs for the current batch.
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
         m.payment_method_type, m.individual_amount, m.currency, m.stripe_payment_intent_id, m.updated_at
  from public.funding_mandates m
  join public.funding_requests fr on fr.id = m.funding_request_id
  where m.funding_request_id = p_funding_request_id and m.charge_attempt = fr.charge_attempt
  order by m.created_at;
$$;

create or replace function public.list_funding_requests_by_charge_status(p_charge_status text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.funding_requests where charge_status = p_charge_status;
$$;

create or replace function public.set_mandate_payment_intent(p_mandate_id uuid, p_payment_intent_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.funding_mandates
    set stripe_payment_intent_id = p_payment_intent_id, updated_at = now()
    where id = p_mandate_id and (stripe_payment_intent_id is null or stripe_payment_intent_id = p_payment_intent_id);
$$;

-- A charge failed (sync decline in the job, or payment_intent.payment_failed
-- webhook). Marks the mandate and fails the whole batch. Returns the
-- funding_request_id so the caller can run refunds.
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
    where id = p_mandate_id and status in ('charging', 'active')
    returning funding_request_id into v_fr_id;
  if v_fr_id is null then
    select funding_request_id into v_fr_id from public.funding_mandates where id = p_mandate_id;
    return v_fr_id;
  end if;
  perform public.fail_funding_charge_batch(v_fr_id, 'charge_failed');
  return v_fr_id;
end;
$$;

-- payment_intent.succeeded: the ONLY way a Stripe-sourced contribution row
-- is written. Idempotent on the PaymentIntent id. Returns the request's
-- charge_status afterward ('failed' => caller must refund this charge too).
create or replace function public.record_stripe_contribution(
  p_mandate_id uuid, p_payment_intent_id text, p_charge_id text,
  p_amount numeric, p_fee numeric
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
     stripe_payment_intent_id, stripe_charge_id, payment_method_type, stripe_fee)
  values
    (v_m.funding_request_id, v_m.participant_id, p_amount, 'stripe', v_m.id,
     p_payment_intent_id, p_charge_id, v_m.payment_method_type, p_fee)
  on conflict (stripe_payment_intent_id) where stripe_payment_intent_id is not null do nothing;

  update public.funding_mandates
    set status = 'charge_succeeded', charged_at = coalesce(charged_at, now()),
        stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
        updated_at = now()
    where id = v_m.id and status in ('charging', 'active', 'canceled');

  return public.settle_funding_charge_batch(v_m.funding_request_id);
end;
$$;

-- Succeeded Stripe charges on a failed request that haven't been refunded
-- (or had a refund requested) yet.
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
    and fr.charge_status = 'failed'
    and fc.source = 'stripe'
    and fc.refunded_at is null
    and fc.stripe_refund_id is null;
$$;

create or replace function public.mark_contribution_refund_requested(p_payment_intent_id text, p_refund_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.funding_contributions
    set stripe_refund_id = p_refund_id, refund_requested_at = coalesce(refund_requested_at, now())
    where stripe_payment_intent_id = p_payment_intent_id;
$$;

-- charge.refunded (fully refunded): reconciles the ledger + mandate.
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
  return v_fc.funding_request_id;
end;
$$;

grant execute on function public.get_stripe_customer(uuid, boolean) to service_role;
grant execute on function public.save_stripe_customer(uuid, boolean, text) to service_role;
grant execute on function public.attach_mandate_setup_intent(uuid, text, text) to service_role;
grant execute on function public.activate_funding_mandate(text, text, text) to service_role;
grant execute on function public.record_mandate_setup_failure(text, text) to service_role;
grant execute on function public.list_due_funding_charges() to service_role;
grant execute on function public.begin_funding_charge_batch(uuid) to service_role;
grant execute on function public.get_funding_charge_batch(uuid) to service_role;
grant execute on function public.list_funding_requests_by_charge_status(text) to service_role;
grant execute on function public.set_mandate_payment_intent(uuid, text) to service_role;
grant execute on function public.mark_mandate_charge_failed(uuid, text) to service_role;
grant execute on function public.record_stripe_contribution(uuid, text, text, numeric, numeric) to service_role;
grant execute on function public.list_refundable_contributions(uuid) to service_role;
grant execute on function public.mark_contribution_refund_requested(text, text) to service_role;
grant execute on function public.record_contribution_refunded(text, text) to service_role;

-- Postgres grants EXECUTE to PUBLIC by default on new functions; the
-- service-role and internal ones must not be callable by a signed-in user.
revoke execute on function public.get_stripe_customer(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.save_stripe_customer(uuid, boolean, text) from public, anon, authenticated;
revoke execute on function public.attach_mandate_setup_intent(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.activate_funding_mandate(text, text, text) from public, anon, authenticated;
revoke execute on function public.record_mandate_setup_failure(text, text) from public, anon, authenticated;
revoke execute on function public.list_due_funding_charges() from public, anon, authenticated;
revoke execute on function public.begin_funding_charge_batch(uuid) from public, anon, authenticated;
revoke execute on function public.get_funding_charge_batch(uuid) from public, anon, authenticated;
revoke execute on function public.list_funding_requests_by_charge_status(text) from public, anon, authenticated;
revoke execute on function public.set_mandate_payment_intent(uuid, text) from public, anon, authenticated;
revoke execute on function public.mark_mandate_charge_failed(uuid, text) from public, anon, authenticated;
revoke execute on function public.record_stripe_contribution(uuid, text, text, numeric, numeric) from public, anon, authenticated;
revoke execute on function public.list_refundable_contributions(uuid) from public, anon, authenticated;
revoke execute on function public.mark_contribution_refund_requested(text, text) from public, anon, authenticated;
revoke execute on function public.record_contribution_refunded(text, text) from public, anon, authenticated;
revoke execute on function public.funding_request_set_currency() from public, anon, authenticated;
revoke execute on function public.funding_request_covered_count(uuid) from public, anon, authenticated;
revoke execute on function public.funding_request_population_for(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_funding_mandate_readiness(uuid) from public, anon, authenticated;
revoke execute on function public.settle_funding_charge_batch(uuid) from public, anon, authenticated;
revoke execute on function public.fail_funding_charge_batch(uuid, text) from public, anon, authenticated;

-- ============================================================================
-- Existing funding functions: refund-aware counting + batch awareness
-- ============================================================================

create or replace function public.get_funding_collected(p_funding_request_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)
  from public.funding_contributions
  where funding_request_id = p_funding_request_id and refunded_at is null;
$$;

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
    from public.funding_requests where id = p_funding_request_id;
  if v_status is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_funding_request_member(p_funding_request_id) then
    raise exception 'not a member of this funding request';
  end if;
  if v_status <> 'collecting' or v_charge_status is not null then
    raise exception 'this funding request is not currently collecting';
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

-- Same "underfunded" semantics as before; a failed charge batch lands here
-- exactly like an unfunded deadline. "Still viable" now also resets the
-- charge state so participants can re-authorize for a retry.
create or replace function public.resolve_funding_outcome(p_funding_request_id uuid, p_still_viable boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_status text;
  v_charge_status text;
  v_deadline timestamptz;
  v_element_id uuid;
  v_member_ids uuid[];
  v_population int;
  v_paid_count int;
begin
  select trip_id, status, charge_status, funding_deadline
    into v_trip_id, v_status, v_charge_status, v_deadline
    from public.funding_requests where id = p_funding_request_id;

  if v_trip_id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can resolve a funding outcome';
  end if;
  if v_status <> 'collecting' then
    raise exception 'funding request is not currently collecting';
  end if;
  if v_charge_status = 'charging' then
    raise exception 'charges are still processing — wait for them to settle';
  end if;
  if v_deadline is null or v_deadline > now() then
    raise exception 'funding deadline has not passed yet';
  end if;
  if v_charge_status = 'failed' and exists (
    select 1 from public.funding_contributions
    where funding_request_id = p_funding_request_id and source = 'stripe' and refunded_at is null
  ) then
    raise exception 'refunds from the failed charge are still being processed — try again shortly';
  end if;

  select array_agg(element_id) into v_member_ids
    from public.funding_request_elements where funding_request_id = p_funding_request_id;
  v_population := public.funding_request_participant_population(v_member_ids);

  select count(distinct contributor_id) into v_paid_count
    from public.funding_contributions
    where funding_request_id = p_funding_request_id and refunded_at is null;

  if v_paid_count >= v_population then
    update public.funding_requests set status = 'ready_to_purchase' where id = p_funding_request_id;
    return;
  end if;

  if p_still_viable then
    update public.funding_requests
      set funding_deadline = null, charge_status = null, charge_failure_reason = null, fully_mandated_at = null
      where id = p_funding_request_id;
    return;
  end if;

  for v_element_id in
    select element_id from public.funding_request_elements where funding_request_id = p_funding_request_id
  loop
    perform public.cascade_element_unavailable(v_element_id);
  end loop;
end;
$$;

create or replace function public.set_funding_deadline(p_funding_request_id uuid, p_deadline timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_charge_status text;
begin
  select trip_id, charge_status into v_trip_id, v_charge_status
    from public.funding_requests where id = p_funding_request_id;
  if v_trip_id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can set the funding deadline';
  end if;
  if v_charge_status = 'charging' then
    raise exception 'charges are already running for this deadline';
  end if;
  if v_charge_status = 'failed' and exists (
    select 1 from public.funding_contributions
    where funding_request_id = p_funding_request_id and source = 'stripe' and refunded_at is null
  ) then
    raise exception 'refunds from the failed charge are still being processed — try again shortly';
  end if;

  -- A new deadline after a failed batch is a fresh collection round.
  update public.funding_requests
    set funding_deadline = p_deadline,
        charge_status = case when charge_status = 'failed' then null else charge_status end,
        charge_failure_reason = case when charge_status = 'failed' then null else charge_failure_reason end
    where id = p_funding_request_id;
end;
$$;

-- delete_trip: a refunded contribution no longer blocks deletion.
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
    raise exception 'Can''t delete — these elements still have unrefunded funding: %. Mark them refunded first.', v_blocking_labels;
  end if;

  delete from public.trips where id = p_trip_id;
end;
$$;

notify pgrst, 'reload schema';
