-- ============================================================================
-- Element page "After Commit" pass (founder build prompt, 2026-10-14).
--
-- §5 Per-participant price cushion. Each person picks their own cushion when
--    they authorize (No extra / +5% / +10% / a custom amount), stored as that
--    mandate's max_amount — the charge engine already charges
--    least(current share, max_amount) + fee on that (get_funding_charge_batch),
--    so nothing downstream changes. Replaces the one global
--    element/trip cushion for authorizations: create_funding_mandate no
--    longer reads funding_request_cushion_cap (left in place; PriceCheck's
--    label still uses the element/trip setting). Only offered when the trip
--    allows it AND every locked option in the pool came from a vendor search
--    (value.vendor_source — element_options.source is 'user_proposed' for
--    everything, so it can't tell them apart). Hand-entered options: fixed
--    price, no cushion.
-- §6 Withdraw + recalculate. Withdrawing (cancel_funding_mandate) is allowed
--    only before the funding deadline. While someone has withdrawn and the
--    organizer hasn't recalculated, new commitments pause (except the person
--    who withdrew, who can re-commit). recalculate_funding_shares() takes the
--    withdrawn people out of this funding pool's element(s) — the headcount
--    is "opted-in participants", so they must stop counting or the pool can
--    never fund — re-derives the share the same way a price change does, and
--    cancels only the authorizations that no longer cover it (they authorize
--    again at the new share); everyone still covered stays committed.
--    Only for GROUP-SPLIT pools (a flat / per-night price shared by the
--    group — founder, 2026-10-14): on a per-person price nobody else's share
--    changes, so withdrawing just releases that person's place (they're
--    opted out and the total drops), with no pause and no organizer step;
--    they can commit again before the deadline (re-opted in).
-- Cushion settings are complementary (founder, 2026-10-14): the trip's
--    "allow a cushion at checkout" switch turns the picker on, and the
--    trip's (or the element's) cushion value is the recommended choice in
--    it. Switch off = no cushion anywhere. A participant may go up to the
--    larger of +50% (custom amount: up to their share again) or the
--    recommended cushion.
-- Also: a price change now cancels only the authorizations it breaks, not
--    everyone's, now that caps differ per person.
-- ============================================================================

alter table public.trips add column if not exists allow_checkout_cushion boolean not null default true;
alter table public.funding_requests add column if not exists shares_recalculated_at timestamptz;

-- Is a cushion allowed for this pool? Trip setting on, and every locked option re-priceable.
create or replace function public.funding_request_cushion_allowed(p_funding_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select t.allow_checkout_cushion
    from public.funding_requests fr join public.trips t on t.id = fr.trip_id
    where fr.id = p_funding_request_id
  ), false)
  and not exists (
    select 1
    from public.funding_request_elements fre
    join public.trip_elements e on e.id = fre.element_id
    left join public.element_options o on o.id = e.locked_option_id
    where fre.funding_request_id = p_funding_request_id
      and e.type not in ('dates', 'destination')
      and coalesce(o.value->>'vendor_source', '') = ''
  );
$$;
revoke execute on function public.funding_request_cushion_allowed(uuid) from public, anon;
grant execute on function public.funding_request_cushion_allowed(uuid) to authenticated, service_role;

-- Is the cost split across the group (flat / per-night), so one person
-- leaving changes everyone's share? Per-person prices are not.
create or replace function public.funding_request_is_group_split(p_funding_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.funding_request_elements fre
    join public.trip_elements e on e.id = fre.element_id
    left join public.element_options o on o.id = e.locked_option_id
    where fre.funding_request_id = p_funding_request_id
      and e.type not in ('dates', 'destination')
      and coalesce(o.pricing_basis, 'flat') <> 'per_person'
  );
$$;
revoke execute on function public.funding_request_is_group_split(uuid) from public, anon;
grant execute on function public.funding_request_is_group_split(uuid) to authenticated, service_role;

-- The max_amount for a participant's cushion choice, validated. null / 'none'
-- / 0 = exactly the share.
create or replace function public.funding_mandate_cushion_max(
  p_funding_request_id uuid,
  p_share numeric,
  p_kind text,
  p_value numeric
)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_kind text := nullif(coalesce(p_kind, 'none'), 'none');
  v_value numeric := coalesce(p_value, 0);
  v_max numeric;
  v_limit numeric;
begin
  if v_kind is null or v_value = 0 then
    return p_share;
  end if;
  if not public.funding_request_cushion_allowed(p_funding_request_id) then
    raise exception 'a price cushion isn''t offered for this booking';
  end if;
  if v_value < 0 then
    raise exception 'a cushion can''t be negative';
  end if;
  if v_kind = 'percent' then
    v_max := round(p_share * (1 + v_value / 100.0), 2);
    v_limit := round(p_share * 1.5, 2);
  elsif v_kind = 'amount' then
    v_max := round(p_share + v_value, 2);
    v_limit := round(p_share * 2, 2);
  else
    raise exception 'unknown cushion choice';
  end if;
  -- The organizer's recommended cushion is always allowed, even above +50%.
  v_limit := greatest(v_limit, coalesce(public.funding_request_cushion_cap(p_funding_request_id, p_share), p_share));
  if v_max > v_limit then
    raise exception 'that cushion is more than this booking allows';
  end if;
  return v_max;
end;
$$;
revoke execute on function public.funding_mandate_cushion_max(uuid, numeric, text, numeric) from public, anon, authenticated;

-- Recompute a pool's total after its headcount changed (per-person pools:
-- the share is the unit price, so it doesn't move).
create or replace function public.refresh_funding_required_amount(p_funding_request_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.funding_requests fr
    set required_amount = coalesce((
      select sum(public.calculate_required_amount(e.id))
      from public.funding_request_elements fre join public.trip_elements e on e.id = fre.element_id
      where fre.funding_request_id = fr.id and e.type not in ('dates', 'destination')
    ), fr.required_amount)
    where fr.id = p_funding_request_id;
$$;
revoke execute on function public.refresh_funding_required_amount(uuid) from public, anon, authenticated;

-- People in this pool who withdrew and haven't re-committed (and haven't paid).
create or replace function public.funding_request_pending_withdrawals(p_funding_request_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct ep.participant_id
  from public.funding_request_elements fre
  join public.element_participants ep on ep.element_id = fre.element_id and ep.opted_in = true
  where fre.funding_request_id = p_funding_request_id
    and not exists (
      select 1 from public.funding_mandates m
      where m.funding_request_id = p_funding_request_id and m.participant_id = ep.participant_id
        and m.status in ('pending', 'active', 'charging', 'held', 'awaiting_retry', 'charge_succeeded')
    )
    and not exists (
      select 1 from public.funding_contributions c
      where c.funding_request_id = p_funding_request_id and c.contributor_id = ep.participant_id and c.refunded_at is null
    )
    and (
      select m.failure_reason from public.funding_mandates m
      where m.funding_request_id = p_funding_request_id and m.participant_id = ep.participant_id
      order by m.created_at desc limit 1
    ) = 'canceled by participant';
$$;
revoke execute on function public.funding_request_pending_withdrawals(uuid) from public, anon, authenticated;

-- For the element page: who withdrew. Names only for organizers / co-organizers.
create or replace function public.get_funding_withdrawals(p_funding_request_id uuid)
returns table (participant_id uuid, display_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_trip uuid;
  v_org boolean;
begin
  if not public.is_funding_request_member(p_funding_request_id) then
    raise exception 'not a member of this funding request';
  end if;
  select trip_id into v_trip from public.funding_requests where id = p_funding_request_id;
  v_org := public.is_trip_organizer(v_trip);
  return query
    select w.id, case when v_org or w.id = auth.uid() then p.display_name end
    from public.funding_request_pending_withdrawals(p_funding_request_id) as w(id)
    left join public.profiles p on p.id = w.id;
end;
$$;
revoke execute on function public.get_funding_withdrawals(uuid) from public, anon;
grant execute on function public.get_funding_withdrawals(uuid) to authenticated;

-- §5: the authorization takes the participant's own cushion choice.
drop function if exists public.create_funding_mandate(uuid);
create function public.create_funding_mandate(
  p_funding_request_id uuid,
  p_cushion_kind text default null,   -- null / 'none' = no cushion; 'percent' or 'amount'
  p_cushion_value numeric default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fr record;
  v_id uuid;
  v_max numeric;
  v_rejoin boolean := false;
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
    -- Per-person pools: someone who withdrew can take their place back.
    if not public.funding_request_is_group_split(p_funding_request_id)
       and exists (
         select 1 from public.funding_request_elements fre
         join public.element_participants ep on ep.element_id = fre.element_id
         where fre.funding_request_id = p_funding_request_id and ep.participant_id = v_uid
       )
       and (
         select m.failure_reason from public.funding_mandates m
         where m.funding_request_id = p_funding_request_id and m.participant_id = v_uid
         order by m.created_at desc limit 1
       ) = 'canceled by participant' then
      v_rejoin := true;
    else
      raise exception 'only participants opted into this element can authorize a payment';
    end if;
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
  -- §6: shares may change while a withdrawal is waiting on the organizer.
  if exists (
    select 1 from public.funding_request_pending_withdrawals(p_funding_request_id) w(id) where w.id <> v_uid
  ) then
    raise exception 'someone withdrew, so shares may change — you can commit once the organizer recalculates';
  end if;

  -- §5: max_amount from the participant's own choice.
  v_max := public.funding_mandate_cushion_max(p_funding_request_id, v_fr.individual_amount, p_cushion_kind, p_cushion_value);

  if v_rejoin then
    update public.element_participants ep
      set opted_in = true
      from public.funding_request_elements fre
      where fre.funding_request_id = p_funding_request_id
        and ep.element_id = fre.element_id and ep.participant_id = v_uid;
    perform public.refresh_funding_required_amount(p_funding_request_id);
  end if;

  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'superseded by a new attempt'
    where funding_request_id = p_funding_request_id and participant_id = v_uid and status = 'pending';

  insert into public.funding_mandates (funding_request_id, participant_id, individual_amount, max_amount, currency)
  values (p_funding_request_id, v_uid, v_fr.individual_amount, v_max, coalesce(v_fr.currency, 'USD'))
  returning id into v_id;

  return v_id;
end;
$$;
revoke execute on function public.create_funding_mandate(uuid, text, numeric) from public, anon;
grant execute on function public.create_funding_mandate(uuid, text, numeric) to authenticated;

-- §5: the Stripe form needs its SetupIntent (from create_funding_mandate) before
-- the participant settles on a cushion, so the choice made in the modal is
-- saved at "Authorize" — on their own still-pending authorization — just
-- before Stripe confirms it. Same rules as create_funding_mandate.
create or replace function public.set_funding_mandate_cushion(
  p_mandate_id uuid,
  p_cushion_kind text default null,
  p_cushion_value numeric default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_m record;
  v_share numeric;
  v_max numeric;
begin
  select m.id, m.participant_id, m.status, m.funding_request_id into v_m
    from public.funding_mandates m where m.id = p_mandate_id for update;
  if v_m.id is null or v_m.participant_id is distinct from v_uid then
    raise exception 'authorization not found';
  end if;
  if v_m.status <> 'pending' then
    raise exception 'this authorization is already complete';
  end if;
  select individual_amount into v_share from public.funding_requests where id = v_m.funding_request_id;
  v_max := public.funding_mandate_cushion_max(v_m.funding_request_id, v_share, p_cushion_kind, p_cushion_value);
  update public.funding_mandates
    set individual_amount = v_share, max_amount = v_max, updated_at = now()
    where id = p_mandate_id;
  return v_max;
end;
$$;
revoke execute on function public.set_funding_mandate_cushion(uuid, text, numeric) from public, anon;
grant execute on function public.set_funding_mandate_cushion(uuid, text, numeric) to authenticated;

-- Trip setting: "Let people add a price cushion when they commit".
-- (update_trip_advanced was given p_show_voters in 20261014000000; this adds
-- p_allow_checkout_cushion — null = leave as is.)
drop function if exists public.update_trip_advanced(uuid, integer, boolean, integer, boolean);
create function public.update_trip_advanced(
  p_trip_id uuid,
  p_voting_deadline_days integer,
  p_view_all_participants boolean,
  p_deadline_alert_hours integer,
  p_show_voters boolean default null,
  p_allow_checkout_cushion boolean default null
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
  if p_voting_deadline_days is not null and p_voting_deadline_days not between 1 and 90 then
    raise exception 'the voting deadline default must be 1–90 days';
  end if;
  if p_deadline_alert_hours not in (12, 24, 48) then
    raise exception 'the deadline alert must be 12, 24 or 48 hours';
  end if;
  update public.trips
    set voting_deadline_days = p_voting_deadline_days,
        view_all_participants = coalesce(p_view_all_participants, true),
        deadline_alert_hours = p_deadline_alert_hours,
        show_voters = coalesce(p_show_voters, show_voters),
        allow_checkout_cushion = coalesce(p_allow_checkout_cushion, allow_checkout_cushion)
    where id = p_trip_id;
end;
$$;
revoke execute on function public.update_trip_advanced(uuid, integer, boolean, integer, boolean, boolean) from public, anon;
grant execute on function public.update_trip_advanced(uuid, integer, boolean, integer, boolean, boolean) to authenticated;

-- §6: Withdraw only before the deadline (and before charges start, as before).
create or replace function public.cancel_funding_mandate(p_mandate_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_m record;
  v_fr record;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select id, participant_id, funding_request_id, status, stripe_payment_method_id into v_m
    from public.funding_mandates where id = p_mandate_id for update;
  if v_m.id is null or v_m.participant_id <> v_uid then
    raise exception 'mandate not found';
  end if;
  select charge_status, funding_deadline into v_fr from public.funding_requests where id = v_m.funding_request_id;
  if v_m.status not in ('pending', 'active') or v_fr.charge_status is not null then
    raise exception 'this authorization can no longer be canceled — charges have already started';
  end if;
  if v_fr.funding_deadline is not null and v_fr.funding_deadline <= now() then
    raise exception 'the funding deadline has passed, so this can no longer be withdrawn';
  end if;

  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'canceled by participant'
    where id = p_mandate_id;
  -- Per-person price: nobody else's share changes — release the place now
  -- (no organizer step). Group-split pools wait for recalculate_funding_shares.
  if not public.funding_request_is_group_split(v_m.funding_request_id) then
    update public.element_participants ep
      set opted_in = false
      from public.funding_request_elements fre
      where fre.funding_request_id = v_m.funding_request_id
        and ep.element_id = fre.element_id and ep.participant_id = v_uid;
    perform public.refresh_funding_required_amount(v_m.funding_request_id);
  end if;
  perform public.refresh_funding_mandate_readiness(v_m.funding_request_id);
  return v_m.stripe_payment_method_id;
end;
$$;

-- §6: recalculate the share for the people still in.
create or replace function public.recalculate_funding_shares(p_funding_request_id uuid)
returns table (population int, individual_amount numeric, reauthorize int)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_fr record;
  v_els uuid[];
  v_withdrawn uuid[];
  v_required numeric;
  v_pop int;
  v_individual numeric;
  v_reauth int;
begin
  select id, trip_id, status, charge_status, individual_amount into v_fr
    from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_trip_organizer(v_fr.trip_id) then
    raise exception 'only the organizer or a co-organizer can recalculate shares';
  end if;
  if v_fr.status <> 'collecting' or v_fr.charge_status is not null then
    raise exception 'funding has already moved on — shares can''t change now';
  end if;
  if exists (select 1 from public.funding_contributions c where c.funding_request_id = v_fr.id and c.refunded_at is null) then
    raise exception 'people have already paid fixed shares — shares can''t change now';
  end if;

  select array_agg(w) into v_withdrawn from public.funding_request_pending_withdrawals(v_fr.id) as w;
  if v_withdrawn is null then
    raise exception 'nobody has withdrawn — there''s nothing to recalculate';
  end if;

  select array_agg(element_id) into v_els from public.funding_request_elements where funding_request_id = v_fr.id;

  -- The withdrawn stop counting toward this pool (deliberately allowed on a
  -- locked element here — the share can't fund otherwise).
  update public.element_participants
    set opted_in = false
    where element_id = any(v_els) and participant_id = any(v_withdrawn);

  select sum(public.calculate_required_amount(e.id)) into v_required
    from public.trip_elements e where e.id = any(v_els) and e.type not in ('dates', 'destination');
  v_pop := greatest(public.funding_request_participant_population(v_els), 1);
  v_individual := round(coalesce(v_required, 0) / v_pop, 2);

  update public.funding_requests
    set required_amount = coalesce(v_required, required_amount),
        previous_individual_amount = case when v_individual <> v_fr.individual_amount then v_fr.individual_amount else previous_individual_amount end,
        individual_amount = v_individual,
        shares_recalculated_at = now()
    where id = v_fr.id;

  -- Pending setups were for the old amount; active ones stay unless they no longer cover the new share.
  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(),
        failure_reason = 'shares changed after someone withdrew — authorize again at the new share'
    where funding_request_id = v_fr.id and status = 'pending';
  with c as (
    update public.funding_mandates
      set status = 'canceled', canceled_at = now(), updated_at = now(),
          failure_reason = 'shares changed after someone withdrew — authorize again at the new share'
      where funding_request_id = v_fr.id and status = 'active'
        and coalesce(max_amount, individual_amount) < v_individual
      returning 1
  )
  select count(*)::int into v_reauth from c;

  perform public.refresh_funding_mandate_readiness(v_fr.id);
  population := v_pop;
  individual_amount := v_individual;
  reauthorize := v_reauth;
  return next;
end;
$$;
revoke execute on function public.recalculate_funding_shares(uuid) from public, anon;
grant execute on function public.recalculate_funding_shares(uuid) to authenticated;

-- A price change cancels only the authorizations it breaks (caps differ per person now).
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
  v_broken int;
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

  update public.funding_mandates
    set status = 'canceled', canceled_at = now(), updated_at = now(), failure_reason = 'price updated'
    where funding_request_id = v_fr.id and status = 'pending';

  with c as (
    update public.funding_mandates
      set status = 'canceled', canceled_at = now(), updated_at = now(),
          failure_reason = 'price rose beyond the cushion — authorize again at the new price'
      where funding_request_id = v_fr.id and status = 'active'
        and coalesce(max_amount, individual_amount) < v_individual
      returning 1
  )
  select count(*)::int into v_broken from c;

  if v_broken > 0 then
    perform public.refresh_funding_mandate_readiness(v_fr.id);
    return 'over_cushion';
  end if;
  return 'within_cushion';
end;
$$;

notify pgrst, 'reload schema';
