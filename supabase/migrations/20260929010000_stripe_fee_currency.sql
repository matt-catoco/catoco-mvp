-- ============================================================================
-- Stripe fee currency. The real fee comes from the charge's balance
-- transaction, which is in the ACCOUNT's settlement currency (EUR for the
-- NL-domiciled account), not the charge currency — a USD trip's fee lands
-- in EUR. Store it with its currency instead of silently mixing units, and
-- only sum fees that match the request's own currency in the summary.
-- ============================================================================

alter table public.funding_contributions
  add column if not exists stripe_fee_currency text;

drop function if exists public.record_stripe_contribution(uuid, text, text, numeric, numeric);

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

  -- 'canceled' included: a charge already in flight when its batch failed
  -- can still succeed late; it's recorded (real money moved) and then
  -- refunded by the caller.
  update public.funding_mandates
    set status = 'charge_succeeded', charged_at = coalesce(charged_at, now()),
        stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
        updated_at = now()
    where id = v_m.id and status in ('charging', 'active', 'canceled');

  return public.settle_funding_charge_batch(v_m.funding_request_id);
end;
$$;

revoke execute on function public.record_stripe_contribution(uuid, text, text, numeric, numeric, text) from public, anon, authenticated;
grant execute on function public.record_stripe_contribution(uuid, text, text, numeric, numeric, text) to service_role;

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
      (select coalesce(sum(fc.stripe_fee), 0) from public.funding_contributions fc
        join public.funding_requests fr on fr.id = fc.funding_request_id
        where fc.funding_request_id = p_funding_request_id and fc.source = 'stripe'
          and fc.refunded_at is null and fc.stripe_fee_currency = fr.currency);
end;
$$;

notify pgrst, 'reload schema';
