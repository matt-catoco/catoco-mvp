-- Two follow-ups (founder, 2026-10-17).
--
-- 1. prepare_notification() is server-only. Any signed-in user could call it
--    with someone else's user id and get back that person's unsubscribe
--    token (and burn their notification_log claim). The app now calls it
--    with the service-role client only (lib/notifications.ts).
--
-- 2. Price-change emails only when the move is bigger than the recommended
--    cushion. The threshold is the element's cushion (else the trip's) when
--    the trip's cushion is on; with the cushion off there's no recommendation,
--    so the old 1% noise floor applies. An amount cushion (+€20) is read
--    against one person's share: the funding share once funding exists,
--    before that the per-person price, or the price split across the
--    element's people. The baseline is the price last emailed about; on lock
--    it resets to the locked option's price, so small daily moves during
--    funding add up instead of each slipping under the threshold.

-- ---- 1. prepare_notification: service role only --------------------------
revoke execute on function public.prepare_notification(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.prepare_notification(uuid, text, uuid) to service_role;

-- ---- 2. threshold --------------------------------------------------------
-- Percent of the price a move has to exceed before the organizer is emailed.
create or replace function public.price_drift_threshold_percent(p_element_id uuid, p_baseline numeric)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_floor constant numeric := 1;
  v_allow boolean;
  v_kind text;
  v_value numeric;
  v_share numeric;
  v_basis text;
  v_people int;
begin
  select t.allow_checkout_cushion,
         coalesce(e.cushion_kind, t.price_cushion_kind),
         case when e.cushion_kind is not null then e.cushion_value else t.price_cushion_value end
    into v_allow, v_kind, v_value
    from public.trip_elements e join public.trips t on t.id = e.trip_id
    where e.id = p_element_id;

  if not coalesce(v_allow, false) or coalesce(v_value, 0) <= 0 then
    return v_floor;
  end if;
  if v_kind = 'percent' then
    return greatest(v_value, v_floor);
  end if;

  -- Amount cushion: as a percent of one person's share.
  select fr.individual_amount into v_share
    from public.funding_request_elements fre
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = p_element_id and fr.status <> 'superseded'
    limit 1;
  if v_share is null and p_baseline is not null and p_baseline > 0 then
    select o.pricing_basis into v_basis
      from public.element_options o
      join public.trip_elements e on e.id = o.element_id
      where o.element_id = p_element_id
      order by (o.id = e.locked_option_id) desc nulls last, o.created_at
      limit 1;
    if v_basis = 'per_person' then
      v_share := p_baseline;
    else
      select count(*) into v_people
        from public.element_participants ep
        where ep.element_id = p_element_id and coalesce(ep.opted_in, true);
      v_share := p_baseline / greatest(v_people, 1);
    end if;
  end if;
  if v_share is null or v_share <= 0 then
    return v_floor;
  end if;
  return greatest(round(v_value / v_share * 100, 2), v_floor);
end;
$$;
revoke execute on function public.price_drift_threshold_percent(uuid, numeric) from public, anon, authenticated;
grant execute on function public.price_drift_threshold_percent(uuid, numeric) to service_role;

-- Pre-lock check: same as before, with the cushion threshold.
create or replace function public.record_option_price_check(
  p_option_id uuid,
  p_unit_price numeric
)
returns table (unit_price numeric, drifted boolean, previous_price numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_element_id uuid;
  v_previous numeric;
  v_baseline numeric;
begin
  select o.element_id, o.unit_price into v_element_id, v_previous
    from public.element_options o where o.id = p_option_id;
  if v_element_id is null then
    raise exception 'option not found';
  end if;
  select coalesce(e.last_notified_price, v_previous) into v_baseline
    from public.trip_elements e where e.id = v_element_id;

  update public.element_options
    set unit_price = p_unit_price,
        value = jsonb_set(value, '{price}', to_jsonb(p_unit_price::text))
    where id = p_option_id;
  update public.trip_elements set last_price_check_at = now() where id = v_element_id;

  unit_price := p_unit_price;
  previous_price := coalesce(v_baseline, v_previous);
  drifted := v_baseline is not null and v_baseline > 0
    and abs(p_unit_price - v_baseline) / v_baseline * 100
        > public.price_drift_threshold_percent(v_element_id, v_baseline);
  return next;
end;
$$;
revoke execute on function public.record_option_price_check(uuid, numeric) from public, anon, authenticated;
grant execute on function public.record_option_price_check(uuid, numeric) to service_role;

-- Funding-stage check, after reprice_locked_element: has the locked price
-- moved past the threshold since the organizer was last told (or since lock)?
-- Records the new baseline when it has.
create or replace function public.check_locked_price_drift(p_element_id uuid, p_unit_price numeric)
returns table (drifted boolean, baseline numeric)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_baseline numeric;
begin
  select e.last_notified_price into v_baseline from public.trip_elements e where e.id = p_element_id;
  baseline := v_baseline;
  drifted := v_baseline is not null and v_baseline > 0
    and abs(p_unit_price - v_baseline) / v_baseline * 100
        > public.price_drift_threshold_percent(p_element_id, v_baseline);
  if drifted or v_baseline is null then
    update public.trip_elements set last_notified_price = p_unit_price where id = p_element_id;
  end if;
  return next;
end;
$$;
revoke execute on function public.check_locked_price_drift(uuid, numeric) from public, anon, authenticated;
grant execute on function public.check_locked_price_drift(uuid, numeric) to service_role;

-- On lock, the baseline becomes the locked option's price (the pre-lock
-- baseline may belong to an option that lost the vote).
create or replace function public.reset_price_baseline_on_lock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.state = 'locked' and new.locked_option_id is not null
     and (old.state is distinct from 'locked' or old.locked_option_id is distinct from new.locked_option_id) then
    select o.unit_price into new.last_notified_price
      from public.element_options o where o.id = new.locked_option_id;
  end if;
  return new;
end;
$$;
revoke execute on function public.reset_price_baseline_on_lock() from public, anon, authenticated;

drop trigger if exists trip_elements_reset_price_baseline on public.trip_elements;
create trigger trip_elements_reset_price_baseline
  before update of state, locked_option_id on public.trip_elements
  for each row execute function public.reset_price_baseline_on_lock();

-- Elements already locked: start from the current locked price.
update public.trip_elements e
  set last_notified_price = o.unit_price
  from public.element_options o
  where o.id = e.locked_option_id and e.state = 'locked';
