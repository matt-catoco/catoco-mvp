-- Funding deadline missed (founder, 2026-10-22), pledge and card-commit alike:
--   1. The deadline passes without everyone in → the round is called off:
--      card commitments are already cancelled by fail_funding_charge_batch
--      ('not_fully_mandated'); live, unpaid pledges are released here.
--      Recorded on the request (deadline_missed_at, the missed deadline and
--      the share at that point) and the organizer and co-organizers are
--      emailed to choose: check the price, then set a new deadline (or
--      resolve it as no longer viable).
--   2. When the organizer sets the new deadline, the group is emailed to
--      recommit / pledge again with the new date and the current share
--      (and the old one if it changed). deadline_missed_at is then cleared.

alter table public.funding_requests add column if not exists deadline_missed_at timestamptz;
alter table public.funding_requests add column if not exists missed_deadline timestamptz;
alter table public.funding_requests add column if not exists missed_share numeric;

alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('invited', 'funding_ready', 'vote_needed', 'funding_needed', 'funding_deadline_set',
                  'payment_retry_needed', 'nudge', 'funding_failed', 'shares_recalculated', 'price_drift',
                  'deadline_missed', 'recommit_requested'));

-- Finds rounds whose deadline just passed unmet, records them once per
-- deadline, releases unpaid pledges, and returns them for the emails.
create or replace function public.mark_missed_funding_deadlines()
returns table (funding_request_id uuid, collection_mode text, in_count int, population int)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v record;
  v_in int;
  v_pop int;
begin
  for v in
    select fr.id, fr.collection_mode, fr.funding_deadline, fr.individual_amount
    from public.funding_requests fr
    where fr.status = 'collecting'
      and fr.collection_mode_chosen_at is not null
      and fr.funding_deadline is not null and fr.funding_deadline <= now()
      and fr.missed_deadline is distinct from fr.funding_deadline
      and (
        -- Pledges: fewer live pledges than people (checked below); pay-right-away
        -- requests open payments on the first pledge, so the window doesn't count.
        fr.collection_mode = 'peer_pledge'
        or (fr.collection_mode = 'catoco_psp' and fr.charge_status = 'failed' and fr.charge_failure_reason = 'not_fully_mandated')
      )
    for update of fr
  loop
    v_pop := public.funding_request_population_for(v.id);
    if v.collection_mode = 'peer_pledge' then
      select count(*) into v_in from public.funding_pledges p where p.funding_request_id = v.id and p.status <> 'withdrawn';
      -- Everyone pledged: payments are under way, not a missed deadline.
      if v_in >= v_pop then
        continue;
      end if;
      update public.funding_pledges p set status = 'withdrawn', withdrawn_at = now()
        where p.funding_request_id = v.id and p.status in ('pledged', 'reported_paid')
          and public.pledge_paid(v.id, p.participant_id) = 0;
    else
      select count(*) into v_in from public.funding_mandates m
        where m.funding_request_id = v.id and m.failure_reason = 'batch failed: not_fully_mandated'
          and m.canceled_at >= v.funding_deadline;
    end if;

    update public.funding_requests
      set deadline_missed_at = now(), missed_deadline = v.funding_deadline, missed_share = v.individual_amount
      where id = v.id;

    funding_request_id := v.id;
    collection_mode := v.collection_mode;
    in_count := v_in;
    population := v_pop;
    return next;
  end loop;
end;
$$;
revoke execute on function public.mark_missed_funding_deadlines() from public, anon, authenticated;
grant execute on function public.mark_missed_funding_deadlines() to service_role;
