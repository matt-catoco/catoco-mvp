-- ============================================================================
-- Price-drift scheduled recheck + organizer notification (founder, 2026-10-14).
--
-- Widens the hourly funding-charges job's vendor recheck (was: only the last
-- 2 hours before a funding deadline) to the founder's cadence:
--   submission stage — once, when options_deadline passes (every
--                      vendor-priced option still in the running);
--   voting stage     — the leading option, weekly while the vote deadline is
--                      more than 7 days out, daily inside 7 days;
--   funding stage    — the locked option, daily while the funding deadline is
--                      more than 48h out, hourly inside 48h.
-- The job runs at :15 every hour and stamps last_price_check_at a little
-- after, so each bucket allows a small tolerance (50 min / 23 h / 6 d 23 h)
-- — otherwise "hourly" would land every other run.
-- Organizers (not participants) are emailed when a price moves; gated by the
-- account email setting AND the new per-trip notify_price_drift setting
-- (independent of allow_checkout_cushion; default on).
-- ============================================================================

-- When an element (open) or its locked option (locked) was last rechecked.
alter table public.trip_elements
  add column if not exists last_price_check_at timestamptz;

-- The price the organizer was last told about (pre-lock drift emails).
alter table public.trip_elements
  add column if not exists last_notified_price numeric;

-- "Email me if a price moves" — independent of the checkout cushion.
alter table public.trips
  add column if not exists notify_price_drift boolean not null default true;

alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check check (kind in (
  'invited', 'funding_ready', 'vote_needed', 'funding_needed', 'funding_deadline_set',
  'payment_retry_needed', 'nudge', 'funding_failed', 'shares_recalculated', 'price_drift'));

-- Replaces list_vendor_priced_elements_due (its only caller moves here).
drop function if exists public.list_vendor_priced_elements_due(int);

create or replace function public.list_elements_due_for_price_check()
returns table (
  element_id uuid,
  stage text,          -- 'submission' | 'voting' | 'funding'
  option_id uuid,
  value jsonb,
  unit_price numeric,
  pricing_basis text
)
language sql
stable
security definer
set search_path = public
as $$
  -- Submission stage: every vendor-priced option, once the submission
  -- deadline has passed and it hasn't been checked since.
  select e.id, 'submission'::text, o.id, o.value, o.unit_price, o.pricing_basis
  from public.trip_elements e
  join public.element_options o on o.element_id = e.id
  where e.state = 'open'
    and e.options_deadline is not null and e.options_deadline <= now()
    and o.value->>'vendor_source' in ('duffel', 'liteapi', 'viator')
    and (e.last_price_check_at is null or e.last_price_check_at < e.options_deadline)

  union all

  -- Voting stage: only the leading option (most first choices, then most
  -- votes), weekly / daily as the vote deadline closes in. Waits for the
  -- submission-stage check to have run first.
  select e.id, 'voting'::text, lead.option_id, lead.value, lead.unit_price, lead.pricing_basis
  from public.trip_elements e
  cross join lateral (
    select o.id as option_id, o.value, o.unit_price, o.pricing_basis
    from public.element_options o
    left join (
      select v.option_id, count(*) filter (where v.rank = 1) as first_choice, count(*) as votes
      from public.votes v group by v.option_id
    ) vs on vs.option_id = o.id
    where o.element_id = e.id and o.value->>'vendor_source' in ('duffel', 'liteapi', 'viator')
    order by coalesce(vs.first_choice, 0) desc, coalesce(vs.votes, 0) desc, o.created_at
    limit 1
  ) lead
  where e.state = 'open'
    and e.voting_deadline is not null and e.voting_deadline > now()
    and (e.options_deadline is null or e.options_deadline <= now())
    and (e.options_deadline is null or e.last_price_check_at >= e.options_deadline)
    and (
      e.last_price_check_at is null
      or (e.voting_deadline - now() > interval '7 days' and e.last_price_check_at < now() - interval '6 days 23 hours')
      or (e.voting_deadline - now() <= interval '7 days' and e.last_price_check_at < now() - interval '23 hours')
    )

  union all

  -- Funding stage: the locked option, daily / hourly as the funding
  -- deadline closes in.
  select e.id, 'funding'::text, o.id, o.value, o.unit_price, o.pricing_basis
  from public.trip_elements e
  join public.element_options o on o.id = e.locked_option_id
  join public.funding_request_elements fre on fre.element_id = e.id
  join public.funding_requests fr on fr.id = fre.funding_request_id
  where e.state = 'locked' and fr.status = 'collecting' and fr.charge_status is null
    and o.value->>'vendor_source' in ('duffel', 'liteapi', 'viator')
    and fr.funding_deadline is not null and fr.funding_deadline > now()
    and (
      (fr.funding_deadline - now() > interval '48 hours'
        and (e.last_price_check_at is null or e.last_price_check_at < now() - interval '23 hours'))
      or (fr.funding_deadline - now() <= interval '48 hours'
        and (e.last_price_check_at is null or e.last_price_check_at < now() - interval '50 minutes'))
    );
$$;
revoke execute on function public.list_elements_due_for_price_check() from public, anon, authenticated;
grant execute on function public.list_elements_due_for_price_check() to service_role;

-- Pre-lock price check (submission / voting): updates the option's price and
-- the element's cadence stamp. No mandates exist yet, so no cushion logic.
-- "Drifted" = moved more than 1% from the price last emailed about (or the
-- previous price, if none was) — a placeholder floor so rounding noise
-- doesn't email anyone; change it here.
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
  previous_price := v_previous;
  drifted := v_baseline is not null and v_baseline > 0 and abs(p_unit_price - v_baseline) / v_baseline > 0.01;
  return next;
end;
$$;
revoke execute on function public.record_option_price_check(uuid, numeric) from public, anon, authenticated;
grant execute on function public.record_option_price_check(uuid, numeric) to service_role;

-- Funding-stage cadence stamp (reprice_locked_element is reused unchanged).
create or replace function public.mark_element_price_checked(p_element_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.trip_elements set last_price_check_at = now() where id = p_element_id;
$$;
revoke execute on function public.mark_element_price_checked(uuid) from public, anon, authenticated;
grant execute on function public.mark_element_price_checked(uuid) to service_role;

-- Trip setting: adds p_notify_price_drift (null = leave as is).
drop function if exists public.update_trip_advanced(uuid, integer, boolean, integer, boolean, boolean);
create function public.update_trip_advanced(
  p_trip_id uuid,
  p_voting_deadline_days integer,
  p_view_all_participants boolean,
  p_deadline_alert_hours integer,
  p_show_voters boolean default null,
  p_allow_checkout_cushion boolean default null,
  p_notify_price_drift boolean default null
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
        allow_checkout_cushion = coalesce(p_allow_checkout_cushion, allow_checkout_cushion),
        notify_price_drift = coalesce(p_notify_price_drift, notify_price_drift)
    where id = p_trip_id;
end;
$$;
revoke execute on function public.update_trip_advanced(uuid, integer, boolean, integer, boolean, boolean, boolean) from public, anon;
grant execute on function public.update_trip_advanced(uuid, integer, boolean, integer, boolean, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
