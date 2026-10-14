-- ============================================================================
-- Automatic recalculation after a withdrawal (founder, 2026-10-14).
--
-- On a group-split pool, a withdrawal pauses Commit until the organizer
-- recalculates the shares or someone takes the spot. If the organizer hasn't
-- acted 24 hours after the (first still-pending) withdrawal, the shares are
-- recalculated automatically — the same logic as the organizer's
-- "Recalculate" button. The funding deadline stays as it is; when a
-- withdrawal lands within 24 hours of it, there's no time to wait, so the
-- shares are recalculated straight away (in cancel_funding_mandate), and
-- the hourly funding-charges cron also recalculates any pool still waiting
-- once its deadline is within 24 hours. Per-person pools never pause, so
-- never qualify.
--
-- Everyone whose authorization no longer covers the new share is emailed
-- (notification kind shares_recalculated; sent from the app).
-- Also: get_funding_withdrawals returns withdrawn_at, so the page can say
-- when the automatic recalculation will happen.
-- ============================================================================

-- Email kind for "the shares changed — commit again".
alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check check (kind in (
  'invited', 'funding_ready', 'vote_needed', 'funding_needed', 'funding_deadline_set',
  'payment_retry_needed', 'nudge', 'funding_failed', 'shares_recalculated'));

-- The recalculation itself, without the organizer check (internal only).
create or replace function public.recalculate_funding_shares_core(p_funding_request_id uuid)
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
revoke execute on function public.recalculate_funding_shares_core(uuid) from public, anon, authenticated;

-- The organizer's "Recalculate" button.
create or replace function public.recalculate_funding_shares(p_funding_request_id uuid)
returns table (population int, individual_amount numeric, reauthorize int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip uuid;
begin
  select trip_id into v_trip from public.funding_requests where id = p_funding_request_id;
  if v_trip is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_trip_organizer(v_trip) then
    raise exception 'only the organizer or a co-organizer can recalculate shares';
  end if;
  return query select * from public.recalculate_funding_shares_core(p_funding_request_id);
end;
$$;
revoke execute on function public.recalculate_funding_shares(uuid) from public, anon;
grant execute on function public.recalculate_funding_shares(uuid) to authenticated;

-- When the oldest still-pending withdrawal on a pool happened (null = none).
create or replace function public.funding_request_withdrawn_since(p_funding_request_id uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select min((
    select m.canceled_at from public.funding_mandates m
    where m.funding_request_id = p_funding_request_id and m.participant_id = w.id
    order by m.created_at desc limit 1
  ))
  from public.funding_request_pending_withdrawals(p_funding_request_id) as w(id);
$$;
revoke execute on function public.funding_request_withdrawn_since(uuid) from public, anon, authenticated;

-- Hourly cron: recalculate every group-split pool where a withdrawal has
-- waited p_hours with no organizer action, or whose deadline is now within
-- p_hours. A pool that can't be recalculated
-- (paid manual shares, charging already started) is skipped and reported.
create or replace function public.auto_recalculate_funding_shares(p_hours int default 24)
returns table (funding_request_id uuid, population int, individual_amount numeric, reauthorize int, skipped text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_id uuid;
  v_res record;
begin
  for v_id in
    select fr.id from public.funding_requests fr
    where fr.status = 'collecting' and fr.charge_status is null
      and (fr.funding_deadline is null or fr.funding_deadline > now())
      and public.funding_request_is_group_split(fr.id)
      and public.funding_request_withdrawn_since(fr.id) is not null
      and (
        public.funding_request_withdrawn_since(fr.id) <= now() - make_interval(hours => p_hours)
        or fr.funding_deadline <= now() + make_interval(hours => p_hours)
      )
  loop
    begin
      select * into v_res from public.recalculate_funding_shares_core(v_id);
      funding_request_id := v_id;
      population := v_res.population;
      individual_amount := v_res.individual_amount;
      reauthorize := v_res.reauthorize;
      skipped := null;
    exception when others then
      funding_request_id := v_id;
      population := null;
      individual_amount := null;
      reauthorize := null;
      skipped := sqlerrm;
    end;
    return next;
  end loop;
end;
$$;
revoke execute on function public.auto_recalculate_funding_shares(int) from public, anon, authenticated;
grant execute on function public.auto_recalculate_funding_shares(int) to service_role;

-- Withdraw. Per-person pools release the place (20261014010000); on a
-- group-split pool within 24 hours of its deadline, the shares are
-- recalculated right away instead of waiting on the organizer.
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
  if not public.funding_request_is_group_split(v_m.funding_request_id) then
    -- Per-person price: nobody else's share changes — release the place now.
    update public.element_participants ep
      set opted_in = false
      from public.funding_request_elements fre
      where fre.funding_request_id = v_m.funding_request_id
        and ep.element_id = fre.element_id and ep.participant_id = v_uid;
    perform public.refresh_funding_required_amount(v_m.funding_request_id);
  elsif v_fr.funding_deadline is not null and v_fr.funding_deadline <= now() + interval '24 hours' then
    -- Too close to the deadline to wait on the organizer. If it can't be
    -- recalculated (e.g. paid manual shares), the withdrawal still stands.
    begin
      perform public.recalculate_funding_shares_core(v_m.funding_request_id);
    exception when others then
      null;
    end;
  end if;
  perform public.refresh_funding_mandate_readiness(v_m.funding_request_id);
  return v_m.stripe_payment_method_id;
end;
$$;

-- The page shows when the automatic recalculation will happen.
drop function if exists public.get_funding_withdrawals(uuid);
create function public.get_funding_withdrawals(p_funding_request_id uuid)
returns table (participant_id uuid, display_name text, withdrawn_at timestamptz)
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
    select w.id,
      case when v_org or w.id = auth.uid() then p.display_name end,
      (select m.canceled_at from public.funding_mandates m
        where m.funding_request_id = p_funding_request_id and m.participant_id = w.id
        order by m.created_at desc limit 1)
    from public.funding_request_pending_withdrawals(p_funding_request_id) as w(id)
    left join public.profiles p on p.id = w.id;
end;
$$;
revoke execute on function public.get_funding_withdrawals(uuid) from public, anon;
grant execute on function public.get_funding_withdrawals(uuid) to authenticated;

notify pgrst, 'reload schema';
