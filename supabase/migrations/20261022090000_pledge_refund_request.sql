-- Paid, then pushed above the cushion (founder, 2026-10-22): when a price
-- rise releases the pledge of someone who has already paid, they choose
-- between "Pledge the difference" (accept_pledge again; what they paid still
-- counts) and "Request a refund" (they leave the element and the organizer,
-- who holds the money, refunds them outside Catoco and marks it here).

alter table public.funding_pledges add column if not exists refund_requested_at timestamptz;
alter table public.funding_pledges add column if not exists refunded_at timestamptz;

alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('invited', 'funding_ready', 'vote_needed', 'funding_needed', 'funding_deadline_set',
                  'payment_retry_needed', 'nudge', 'funding_failed', 'shares_recalculated', 'price_drift',
                  'deadline_missed', 'recommit_requested', 'refund_requested'));

create or replace function public.request_pledge_refund(p_funding_request_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_paid numeric;
  v_pledge uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_funding_request_member(p_funding_request_id) then
    raise exception 'not a member of this funding request';
  end if;
  if exists (select 1 from public.funding_pledges where funding_request_id = p_funding_request_id
             and participant_id = v_uid and status <> 'withdrawn') then
    raise exception 'you still have a pledge here — withdraw it first';
  end if;
  v_paid := public.pledge_paid(p_funding_request_id, v_uid);
  if coalesce(v_paid, 0) <= 0 then
    raise exception 'there''s nothing to refund';
  end if;
  select id into v_pledge from public.funding_pledges
    where funding_request_id = p_funding_request_id and participant_id = v_uid
    order by coalesce(withdrawn_at, accepted_at) desc limit 1;
  update public.funding_pledges set refund_requested_at = now(), refunded_at = null where id = v_pledge;
  -- Asking for the money back means leaving this element.
  update public.element_participants ep set opted_in = false
    where ep.participant_id = v_uid
      and ep.element_id in (select element_id from public.funding_request_elements where funding_request_id = p_funding_request_id);
  return v_paid;
end;
$$;
revoke execute on function public.request_pledge_refund(uuid) from public, anon;
grant execute on function public.request_pledge_refund(uuid) to authenticated;

-- The organizer refunded them (outside Catoco): their payments stop counting.
create or replace function public.mark_pledge_refunded(p_funding_request_id uuid, p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.funding_requests := public.pledge_require_organizer(p_funding_request_id);
begin
  update public.funding_contributions set refunded_at = now()
    where funding_request_id = v.id and contributor_id = p_participant_id
      and source = 'peer' and refunded_at is null;
  update public.funding_pledges set refunded_at = now()
    where funding_request_id = v.id and participant_id = p_participant_id
      and refund_requested_at is not null and refunded_at is null;
end;
$$;
revoke execute on function public.mark_pledge_refunded(uuid, uuid) from public, anon;
grant execute on function public.mark_pledge_refunded(uuid, uuid) to authenticated;
