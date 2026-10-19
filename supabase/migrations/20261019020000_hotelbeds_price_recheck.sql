-- Hotelbeds in the scheduled price recheck (founder, 2026-10-19): the same
-- function as 20261015000000, with hotelbeds (hotels) and hotelbeds_activities
-- added to the vendor lists. requoteOption() handles both; a quota refusal
-- leaves the element unchecked so the next run tries again.

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
    and o.value->>'vendor_source' in ('duffel', 'liteapi', 'viator', 'hotelbeds', 'hotelbeds_activities')
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
    where o.element_id = e.id and o.value->>'vendor_source' in ('duffel', 'liteapi', 'viator', 'hotelbeds', 'hotelbeds_activities')
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
    and o.value->>'vendor_source' in ('duffel', 'liteapi', 'viator', 'hotelbeds', 'hotelbeds_activities')
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
