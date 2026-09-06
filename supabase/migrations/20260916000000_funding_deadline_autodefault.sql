-- ============================================================================
-- Flow-audit prompt, §13: funding deadline auto-default + 24h grace window.
-- Replaces relying on the organizer to remember to set a deadline manually.
--
-- - create_funding_request_for_element() now sets funding_deadline =
--   creation time + 14 days, instead of leaving it null.
-- - The 24h grace window itself needs no new column -- funding_requests.
--   created_at already exists, so "within the grace window" is just
--   created_at > now() - interval '24 hours'. set_funding_deadline() stays
--   unrestricted (organizer could always edit anytime; that doesn't change)
--   -- what actually changes is notification behavior, handled in the cron
--   route (app/api/cron/notifications/route.ts), not here: no funding_needed
--   reminder fires while a request is still within its grace window.
-- - New notification_log kind 'funding_deadline_set' for the organizer's
--   non-blocking FYI ("deadline auto-set to X, update if needed"). This has
--   to be picked up by the daily cron rather than fired at the exact moment
--   of creation -- create_funding_request_for_element() is a Postgres
--   function with no email-sending capability (no pg_net/extension set up
--   for that here), so there's no way to send from inside the DB layer
--   directly. Given the notification is explicitly informational-only and
--   non-blocking, catching it on the next daily cron run (funding_requests
--   created within the last 24h with no funding_deadline_set log row yet)
--   is a reasonable fit, not a workaround -- flagging the reasoning here
--   rather than silently deciding.
-- ============================================================================

alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log
  add constraint notification_log_kind_check
    check (kind in ('invited', 'funding_ready', 'vote_needed', 'funding_needed', 'funding_deadline_set'));

create or replace function public.create_funding_request_for_element(p_element_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_type text;
  v_organizer_id uuid;
  v_purchaser_id uuid;
  v_required numeric;
  v_fr_id uuid;
begin
  select e.trip_id, e.type, t.organizer_id
    into v_trip_id, v_type, v_organizer_id
    from public.trip_elements e
    join public.trips t on t.id = e.trip_id
    where e.id = p_element_id;

  if v_trip_id is null then
    return null;
  end if;
  if v_type in ('dates', 'destination') then
    return null;
  end if;

  v_required := public.calculate_required_amount(p_element_id);
  if v_required is null then
    return null;
  end if;

  v_purchaser_id := v_organizer_id;

  -- §13: auto-default the deadline to 14 days out instead of leaving it
  -- null. The 24h grace window is derived from created_at, not stored
  -- separately -- see the cron route for how it's used.
  insert into public.funding_requests (trip_id, purchaser_id, required_amount, status, funding_deadline)
  values (v_trip_id, v_purchaser_id, v_required, 'collecting', now() + interval '14 days')
  returning id into v_fr_id;

  insert into public.funding_request_elements (funding_request_id, element_id)
  values (v_fr_id, p_element_id);

  return v_fr_id;
end;
$$;
