-- ============================================================================
-- Platform fee, follow-up (founder, 2026-10-09): Catoco's 5% also applies to
-- manual (non-Stripe) contributions, and Stripe's processing fee is absorbed
-- by Catoco out of that 5% — participants only ever see share + 5%.
--
-- add_funding_contribution is unchanged except that it records the fee
-- beside the share (amount stays exactly the share, so collected vs
-- required still matches).
-- ============================================================================

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

  insert into public.funding_contributions (funding_request_id, contributor_id, amount, platform_fee)
  values (p_funding_request_id, v_uid, p_amount,
          round(p_amount * (select platform_fee_percent from public.funding_requests where id = p_funding_request_id) / 100, 2));

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

notify pgrst, 'reload schema';
