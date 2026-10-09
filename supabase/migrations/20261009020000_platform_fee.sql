-- ============================================================================
-- Funding UX item 1 (founder, 2026-10-09): Catoco's 5% platform fee is ADDED
-- ON TOP of each participant's share — the share still pays the vendor in
-- full, the fee is extra.
--
--  - funding_requests.platform_fee_percent: snapshot per request, so a later
--    rate change never moves a live request. Existing requests keep 0 (their
--    holds/mandates were set up without a fee); new ones get 5.
--  - get_funding_charge_batch returns platform_fee (2dp of the share being
--    charged) so the engine holds/charges share + fee.
--  - funding_contributions.amount stays the SHARE portion (so collected vs
--    required keeps matching); the fee is recorded beside it in
--    platform_fee. A refund always refunds the whole PaymentIntent (fee
--    included).
-- ============================================================================

alter table public.funding_requests
  add column if not exists platform_fee_percent numeric not null default 0
    check (platform_fee_percent >= 0 and platform_fee_percent <= 100);
alter table public.funding_requests alter column platform_fee_percent set default 5;

alter table public.funding_contributions
  add column if not exists platform_fee numeric not null default 0 check (platform_fee >= 0);

drop function if exists public.get_funding_charge_batch(uuid);
create function public.get_funding_charge_batch(p_funding_request_id uuid)
returns table (
  mandate_id uuid, participant_id uuid, status text, stripe_customer_id text,
  stripe_payment_method_id text, payment_method_type text, individual_amount numeric,
  currency text, stripe_payment_intent_id text, updated_at timestamptz,
  retry_reason text, hold_attempt int, platform_fee numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.participant_id, m.status, m.stripe_customer_id, m.stripe_payment_method_id,
         m.payment_method_type,
         s.share,
         m.currency, m.stripe_payment_intent_id, m.updated_at, m.retry_reason, m.hold_attempt,
         round(s.share * fr.platform_fee_percent / 100, 2)
  from public.funding_mandates m
  join public.funding_requests fr on fr.id = m.funding_request_id
  cross join lateral (select least(fr.individual_amount, coalesce(m.max_amount, m.individual_amount)) as share) s
  where m.funding_request_id = p_funding_request_id and m.charge_attempt = fr.charge_attempt
  order by m.created_at;
$$;
revoke execute on function public.get_funding_charge_batch(uuid) from public, anon, authenticated;
grant execute on function public.get_funding_charge_batch(uuid) to service_role;

drop function if exists public.record_stripe_contribution(uuid, text, text, numeric, numeric, text);
create function public.record_stripe_contribution(
  p_mandate_id uuid, p_payment_intent_id text, p_charge_id text,
  p_amount numeric, p_fee numeric, p_fee_currency text, p_platform_fee numeric default 0
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_m record;
  v_platform_fee numeric := least(greatest(coalesce(p_platform_fee, 0), 0), p_amount);
begin
  select id, funding_request_id, participant_id, payment_method_type, status into v_m
    from public.funding_mandates where id = p_mandate_id for update;
  if v_m.id is null then
    raise exception 'mandate % not found', p_mandate_id;
  end if;

  insert into public.funding_contributions
    (funding_request_id, contributor_id, amount, platform_fee, source, mandate_id,
     stripe_payment_intent_id, stripe_charge_id, payment_method_type, stripe_fee, stripe_fee_currency)
  values
    (v_m.funding_request_id, v_m.participant_id, p_amount - v_platform_fee, v_platform_fee, 'stripe', v_m.id,
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
revoke execute on function public.record_stripe_contribution(uuid, text, text, numeric, numeric, text, numeric) from public, anon, authenticated;
grant execute on function public.record_stripe_contribution(uuid, text, text, numeric, numeric, text, numeric) to service_role;

notify pgrst, 'reload schema';
