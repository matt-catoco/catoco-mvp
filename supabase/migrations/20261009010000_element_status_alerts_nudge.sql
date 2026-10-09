-- ============================================================================
-- Staging review Part C + Funding UX items 2–4 (founder, 2026-10-09).
--
-- One shared definition of "who has acted" per element, read by both the
-- element-card alerts (viewer-scoped) and Nudge (organizer-only), so they
-- never disagree:
--   submitted  proposed at least one option on the element
--   voted      ranked at least one of its options
--   committed  a live payment authorization/hold/charge, or an unrefunded
--              contribution (awaiting_retry = NOT committed: they still owe
--              an action)
--
-- Phase per element: submission (open, submissions still open) → voting
-- (open, submission deadline passed) → funding (locked, funding request
-- collecting) → done. The phase deadline is options_deadline /
-- voting_deadline / funding_deadline (or the payment retry deadline while
-- holds wait on someone). Always read live, so a reopened element's new
-- funding deadline shows up with no extra work.
-- ============================================================================

alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check check (kind in (
  'invited', 'funding_ready', 'vote_needed', 'funding_needed', 'funding_deadline_set',
  'payment_retry_needed', 'nudge', 'funding_failed'));

-- ---- the shared layer (internal: callers do their own authority checks) ----
create or replace function public.element_participant_status(p_element_id uuid)
returns table (participant_id uuid, opted_in boolean, submitted boolean, voted boolean, committed boolean)
language sql
stable
security definer
set search_path = public
as $$
  select ep.participant_id, ep.opted_in,
    exists (select 1 from public.element_options o
            where o.element_id = p_element_id and o.proposed_by = ep.participant_id),
    exists (select 1 from public.votes v join public.element_options o on o.id = v.option_id
            where o.element_id = p_element_id and v.participant_id = ep.participant_id),
    exists (select 1 from public.funding_request_elements fre
            join public.funding_requests fr on fr.id = fre.funding_request_id and fr.status <> 'superseded'
            join public.funding_mandates m on m.funding_request_id = fr.id
            where fre.element_id = p_element_id and m.participant_id = ep.participant_id
              and m.status in ('active', 'charging', 'held', 'charge_succeeded'))
    or exists (select 1 from public.funding_request_elements fre
               join public.funding_requests fr on fr.id = fre.funding_request_id and fr.status <> 'superseded'
               join public.funding_contributions c on c.funding_request_id = fr.id
               where fre.element_id = p_element_id and c.contributor_id = ep.participant_id and c.refunded_at is null)
  from public.element_participants ep
  where ep.element_id = p_element_id;
$$;
revoke execute on function public.element_participant_status(uuid) from public, anon, authenticated;

-- Phase + its live deadline for one element.
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

-- ---- card alerts: everything Trip Home needs, for the signed-in viewer ----
create or replace function public.get_trip_element_alerts(p_trip_id uuid)
returns table (
  element_id uuid, phase text, deadline timestamptz, alert_hours int,
  in_scope boolean, i_acted boolean, my_amount numeric, currency text,
  in_count int, spots int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_hours int;
begin
  if not public.is_trip_member(p_trip_id) then
    raise exception 'not a member of this trip';
  end if;
  select t.deadline_alert_hours into v_hours from public.trips t where t.id = p_trip_id;
  return query
    select e.id, ph.phase, ph.deadline, coalesce(v_hours, 24),
      coalesce(me.opted_in, false),
      case ph.phase
        when 'submission' then coalesce(me.submitted, false)
        when 'voting' then coalesce(me.voted, false)
        when 'funding' then coalesce(me.committed, false)
        else true
      end,
      case when ph.phase = 'funding' then ph.share end,
      ph.currency,
      (select count(*)::int from public.element_participants x where x.element_id = e.id and x.opted_in),
      public.element_spots(e.id)
    from public.trip_elements e
    cross join lateral public.element_phase(e.id) ph
    left join lateral (
      select s.* from public.element_participant_status(e.id) s where s.participant_id = v_uid
    ) me on true
    where e.trip_id = p_trip_id and public.is_element_scoped(e.id);
end;
$$;
grant execute on function public.get_trip_element_alerts(uuid) to authenticated;

-- ---- Nudge (organizer only): who still has to act in the current phase ----
create or replace function public.get_element_nudge_targets(p_element_id uuid)
returns table (participant_id uuid, display_name text, phase text, deadline timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_trip_id uuid;
  v_phase text;
  v_deadline timestamptz;
begin
  select trip_id into v_trip_id from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can nudge';
  end if;
  select ph.phase, ph.deadline into v_phase, v_deadline from public.element_phase(p_element_id) ph;
  if v_phase not in ('submission', 'voting', 'funding') then
    return;
  end if;
  return query
    select s.participant_id, p.display_name, v_phase, v_deadline
    from public.element_participant_status(p_element_id) s
    left join public.profiles p on p.id = s.participant_id
    where s.opted_in
      and s.participant_id <> auth.uid()
      and not (case v_phase when 'submission' then s.submitted when 'voting' then s.voted else s.committed end)
      -- a full limited-spots pool has nobody left to chase
      and not (v_phase = 'funding' and exists (
        select 1 from public.funding_request_elements fre
        join public.funding_requests fr on fr.id = fre.funding_request_id and fr.status = 'collecting'
        where fre.element_id = p_element_id
          and public.funding_request_spots_full(fr.id, s.participant_id)));
end;
$$;
grant execute on function public.get_element_nudge_targets(uuid) to authenticated;

-- ---- reopen-on-failure: which of my trip's funding needs a new deadline ----
create or replace function public.get_trip_failed_funding(p_trip_id uuid)
returns table (element_id uuid, label text, funding_request_id uuid, reason text, refunds_pending boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_trip_organizer(p_trip_id) then
    return;
  end if;
  return query
    select distinct on (fr.id) e.id, e.label, fr.id, fr.charge_failure_reason,
      public.funding_request_held_stripe_count(fr.id) > 0
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    join public.trip_elements e on e.id = fre.element_id
    where fr.trip_id = p_trip_id and fr.status = 'collecting' and fr.charge_status = 'failed'
      and fr.refund_all_requested_at is null
    order by fr.id, e.created_at;
end;
$$;
grant execute on function public.get_trip_failed_funding(uuid) to authenticated;

notify pgrst, 'reload schema';
