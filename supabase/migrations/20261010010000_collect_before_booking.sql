-- ============================================================================
-- Founder correction (2026-10-10): we ALWAYS collect every participant's
-- money before anything is booked — financial commitment comes first.
--
-- Removes the "book while still collecting, fund 7 days before the supplier
-- charges" path added in 20261010000000. Vendor payment timing (pay now /
-- pay later / pay at the property) is now just part of the booking record,
-- recorded AFTER funding: it says how the vendor gets paid from money we
-- already hold — we prefer the vendor taking payment up front.
-- ============================================================================

drop trigger if exists finalize_deferred_funding on public.funding_requests;
drop function if exists public.finalize_deferred_funding();
drop function if exists public.record_deferred_booking(uuid, text, timestamptz, timestamptz, timestamptz, int);

alter table public.element_bookings drop column if exists funding_due_at;

-- Booked elements are past funding again (deferred bookings no longer exist).
create or replace function public.element_phase(p_element_id uuid)
returns table (phase text, deadline timestamptz, funding_request_id uuid, share numeric, currency text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when e.state = 'open' and (e.options_deadline is null or e.options_deadline > now()) then 'submission'
      when e.state = 'open' then 'voting'
      when e.state = 'locked' and e.booked_at is null and fr.status = 'collecting'
           and (fr.charge_status is null or fr.charge_status = 'charging') then 'funding'
      else 'done'
    end,
    case
      when e.state = 'open' and (e.options_deadline is null or e.options_deadline > now()) then e.options_deadline
      when e.state = 'open' then e.voting_deadline
      when fr.charge_status = 'charging' then fr.retry_deadline
      else fr.funding_deadline
    end,
    fr.id, fr.individual_amount, fr.currency
  from public.trip_elements e
  left join lateral (
    select f.* from public.funding_request_elements fre
    join public.funding_requests f on f.id = fre.funding_request_id
    where fre.element_id = e.id and f.status <> 'superseded'
    order by f.created_at desc limit 1
  ) fr on true
  where e.id = p_element_id;
$$;
revoke execute on function public.element_phase(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
