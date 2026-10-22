-- Pledge-only funding, founder feedback 2026-10-22:
--
-- 1. No cushion. A pledge is for exactly the share shown; it can never rise
--    on its own. pledge_cap_percent is pinned to 0 for pledges, so every new
--    pledge's cap_amount = amount. If the share goes up anyway (price change,
--    someone leaves), unpaid pledges below the new share are released and
--    those people pledge again at the new amount, or don't.
--
-- 2. Pay timing is the organizer's choice, and a deadline is optional
--    (Catoco can't force anyone to pay):
--      pay_timing 'immediate'  each person pays as soon as they pledge
--      pay_timing 'after_all'  pay once everyone has pledged (or when the
--                              organizer asks), within pay_window_hours —
--                              null = no deadline (the default)

alter table public.funding_requests alter column pledge_cap_percent set default 0;
update public.funding_requests set pledge_cap_percent = 0
  where collection_mode = 'peer_pledge' and pledge_cap_percent <> 0;

alter table public.funding_requests drop constraint if exists funding_requests_pay_window_check;
alter table public.funding_requests alter column pay_window_hours drop not null;
alter table public.funding_requests alter column pay_window_hours set default null;
alter table public.funding_requests add constraint funding_requests_pay_window_check
  check (pay_window_hours is null or pay_window_hours between 24 and 72);
update public.funding_requests set pay_window_hours = null
  where collection_mode = 'peer_pledge' and pay_window_opened_at is null;

alter table public.funding_requests add column if not exists pay_timing text not null default 'after_all';
alter table public.funding_requests drop constraint if exists funding_requests_pay_timing_check;
alter table public.funding_requests add constraint funding_requests_pay_timing_check
  check (pay_timing in ('immediate', 'after_all'));

-- ---- organizer: settings (replaces the cap + hours version) -----------------
drop function if exists public.set_pledge_settings(uuid, numeric, int);
create or replace function public.set_pledge_settings(p_funding_request_id uuid, p_pay_timing text, p_window_hours int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.funding_requests := public.pledge_require_organizer(p_funding_request_id);
begin
  if p_pay_timing not in ('immediate', 'after_all') then
    raise exception 'unknown pay timing';
  end if;
  if p_pay_timing = 'immediate' then
    p_window_hours := null;
  end if;
  if (p_pay_timing is distinct from v.pay_timing or p_window_hours is distinct from v.pay_window_hours)
     and exists (select 1 from public.funding_pledges where funding_request_id = p_funding_request_id and status <> 'withdrawn') then
    raise exception 'people have already pledged on these terms — when to pay can''t change now';
  end if;
  if p_window_hours is not null and (p_window_hours < 24 or p_window_hours > 72) then
    raise exception 'the time to pay must be 24 to 72 hours';
  end if;
  update public.funding_requests
    set pay_timing = p_pay_timing, pay_window_hours = p_window_hours, pledge_cap_percent = 0
    where id = p_funding_request_id;
end;
$$;
revoke execute on function public.set_pledge_settings(uuid, text, int) from public, anon;
grant execute on function public.set_pledge_settings(uuid, text, int) to authenticated;

-- ---- pay right away: the first pledge opens payments --------------------------
create or replace function public.pledge_open_immediately()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.funding_requests set pay_window_opened_at = now()
    where id = new.funding_request_id and pay_timing = 'immediate' and pay_window_opened_at is null;
  return new;
end;
$$;
revoke execute on function public.pledge_open_immediately() from public, anon, authenticated;
drop trigger if exists funding_pledges_open_immediately on public.funding_pledges;
create trigger funding_pledges_open_immediately
  after insert on public.funding_pledges
  for each row execute function public.pledge_open_immediately();

-- ---- no cushion: a higher share releases unpaid pledges -----------------------
-- Covers every path that moves the share (reprice, recalculation). Paid
-- members aren't touched here: reprice/recalculate already refuse once
-- anyone has paid, and remove_unpaid_and_recalculate stays within each
-- pledge's cap_amount (= the amount pledged).
create or replace function public.pledge_release_on_share_rise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.collection_mode = 'peer_pledge' and new.individual_amount > old.individual_amount then
    update public.funding_pledges p set status = 'withdrawn', withdrawn_at = now()
      where p.funding_request_id = new.id and p.status in ('pledged', 'reported_paid')
        and p.cap_amount < new.individual_amount
        and public.pledge_paid(new.id, p.participant_id) = 0;
  end if;
  return new;
end;
$$;
revoke execute on function public.pledge_release_on_share_rise() from public, anon, authenticated;
drop trigger if exists funding_requests_pledge_release_on_rise on public.funding_requests;
create trigger funding_requests_pledge_release_on_rise
  after update of individual_amount on public.funding_requests
  for each row execute function public.pledge_release_on_share_rise();
