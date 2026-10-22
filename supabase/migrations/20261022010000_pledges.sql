-- ============================================================================
-- Prong 1: pledge-only collection (three-prong Prompt 1, founder 2026-10-22).
--
-- Members pledge their share in Catoco under stated terms, then pay the
-- organizer (the funding request's purchaser) directly: bank transfer,
-- payment link or QR. Catoco NEVER holds, routes or processes this money; it
-- records pledges and the organizer's confirmations, nudges, and unlocks
-- Book. Nothing here charges anyone, ever.
--
-- Flow:  accept_pledge (terms record + reference code)
--        → pay window opens when everyone in has pledged, or the organizer
--          opens it early (default 48h, 24–72)
--        → member pays outside Catoco, optionally reports "I've paid"
--        → organizer confirms (writes a funding_contributions row,
--          source 'peer', no Catoco fee)
--        → everyone paid their share → ready_to_purchase (Book unlocks)
--   Gap when the window closes: the organizer either covers it
--   (proceed_with_shortfall, recorded) or drops the unpaid and recalculates
--   — only within the cap everyone agreed to. Or cancels.
-- ============================================================================

-- ---- contributions can now come from a peer payment -------------------------
alter table public.funding_contributions drop constraint if exists funding_contributions_source_check;
alter table public.funding_contributions add constraint funding_contributions_source_check
  check (source in ('manual', 'stripe', 'peer'));

-- ---- per-request pledge settings ------------------------------------------
alter table public.funding_requests
  add column if not exists pledge_cap_percent numeric not null default 10,
  add column if not exists pay_window_hours int not null default 48,
  add column if not exists pay_window_opened_at timestamptz,
  add column if not exists shortfall_accepted_at timestamptz,
  add column if not exists shortfall_accepted_by uuid references auth.users (id),
  add column if not exists shortfall_amount numeric;
alter table public.funding_requests drop constraint if exists funding_requests_pledge_cap_check;
alter table public.funding_requests add constraint funding_requests_pledge_cap_check
  check (pledge_cap_percent >= 0 and pledge_cap_percent <= 50);
alter table public.funding_requests drop constraint if exists funding_requests_pay_window_check;
alter table public.funding_requests add constraint funding_requests_pay_window_check
  check (pay_window_hours between 24 and 72);

-- ---- pledges: the conditional contract -------------------------------------
create table if not exists public.funding_pledges (
  id uuid primary key default gen_random_uuid(),
  funding_request_id uuid not null references public.funding_requests (id) on delete cascade,
  participant_id uuid not null references auth.users (id) on delete cascade,
  -- The accepted-terms record: share and cap as shown, the terms version and
  -- the language they were read in, and when.
  amount numeric not null check (amount > 0),
  cap_amount numeric not null check (cap_amount >= amount),
  terms_version text not null,
  terms_locale text not null default 'en',
  accepted_at timestamptz not null default now(),
  -- Short code the member puts on their transfer so the organizer can match it.
  reference_code text not null unique,
  status text not null default 'pledged' check (status in ('pledged', 'reported_paid', 'confirmed', 'withdrawn')),
  reported_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users (id),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists funding_pledges_one_live
  on public.funding_pledges (funding_request_id, participant_id) where status <> 'withdrawn';
alter table public.funding_pledges enable row level security;
drop policy if exists "Funding members see pledges" on public.funding_pledges;
create policy "Funding members see pledges" on public.funding_pledges
  for select using (public.is_funding_request_member(funding_request_id));
grant select on public.funding_pledges to authenticated;
-- Writes go through the RPCs below only.

-- ---- where the organizer gets paid -----------------------------------------
create table if not exists public.payout_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('iban', 'link', 'qr')),
  label text,
  account_name text,
  iban text,
  url text,
  qr_path text,
  created_at timestamptz not null default now(),
  check (
    (kind = 'iban' and iban is not null and account_name is not null)
    or (kind = 'link' and url is not null)
    or (kind = 'qr' and qr_path is not null)
  )
);
alter table public.payout_methods enable row level security;
drop policy if exists "Own payout methods" on public.payout_methods;
create policy "Own payout methods" on public.payout_methods
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on public.payout_methods to authenticated;

-- Private bucket for uploaded payment QR images; members get short-lived
-- signed URLs from the server.
insert into storage.buckets (id, name, public) values ('payout-qr', 'payout-qr', false)
  on conflict (id) do nothing;
drop policy if exists "Own payout QR read" on storage.objects;
create policy "Own payout QR read" on storage.objects for select
  using (bucket_id = 'payout-qr' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Own payout QR write" on storage.objects;
create policy "Own payout QR write" on storage.objects for insert
  with check (bucket_id = 'payout-qr' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Own payout QR delete" on storage.objects;
create policy "Own payout QR delete" on storage.objects for delete
  using (bucket_id = 'payout-qr' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---- helpers -----------------------------------------------------------------
-- What this person has paid on the request (confirmed, unrefunded).
create or replace function public.pledge_paid(p_funding_request_id uuid, p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0) from public.funding_contributions
  where funding_request_id = p_funding_request_id and contributor_id = p_user_id and refunded_at is null;
$$;
revoke execute on function public.pledge_paid(uuid, uuid) from public, anon;
grant execute on function public.pledge_paid(uuid, uuid) to authenticated, service_role;

-- Organizer of the request's trip, as the signed-in caller.
create or replace function public.pledge_require_organizer(p_funding_request_id uuid)
returns public.funding_requests
language plpgsql
security definer
set search_path = public
as $
declare
  v public.funding_requests;
begin
  select * into v from public.funding_requests f where f.id = p_funding_request_id for update;
  if v.id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_trip_organizer(v.trip_id) then
    raise exception 'only the organizer or a co-organizer can do this';
  end if;
  if v.collection_mode <> 'peer_pledge' then
    raise exception 'this funding isn''t collected by pledges';
  end if;
  if v.status <> 'collecting' then
    raise exception 'funding has already moved on';
  end if;
  return v;
end;
$$;
revoke execute on function public.pledge_require_organizer(uuid) from public, anon, authenticated;

-- Everyone in has paid their full share → Book unlocks.
create or replace function public.pledge_settle(p_funding_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_share numeric;
  v_population int := public.funding_request_population_for(p_funding_request_id);
  v_paid_full int;
begin
  select individual_amount into v_share from public.funding_requests where id = p_funding_request_id;
  select count(*) into v_paid_full
    from public.funding_pledges p
    where p.funding_request_id = p_funding_request_id and p.status <> 'withdrawn'
      and public.pledge_paid(p_funding_request_id, p.participant_id) >= v_share;
  if v_population > 0 and v_paid_full >= v_population then
    update public.funding_requests set status = 'ready_to_purchase'
      where id = p_funding_request_id and status = 'collecting';
  end if;
end;
$$;
revoke execute on function public.pledge_settle(uuid) from public, anon, authenticated;

-- Pledges now count as commitments (locks the collection mode).
create or replace function public.funding_request_has_commitments(p_funding_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.funding_mandates m
    where m.funding_request_id = p_funding_request_id and m.status not in ('pending', 'canceled', 'refunded')
  ) or exists (
    select 1 from public.funding_contributions c
    where c.funding_request_id = p_funding_request_id and c.refunded_at is null
  ) or exists (
    select 1 from public.funding_pledges p
    where p.funding_request_id = p_funding_request_id and p.status <> 'withdrawn'
  );
$$;

-- Choosing pledge-only also clears the Catoco fee on the request (no fee in
-- that mode); collect-and-hold restores the standard 5%.
create or replace function public.set_collection_mode(p_funding_request_id uuid, p_mode text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fr record;
begin
  if p_mode not in ('peer_pledge', 'catoco_psp', 'vendor_direct') then
    raise exception 'that isn''t a way to collect';
  end if;
  select id, status, charge_status into v_fr from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_funding_request_organizer(p_funding_request_id, p_actor) then
    raise exception 'only the organizer or a co-organizer can choose how to collect';
  end if;
  if v_fr.status <> 'collecting' or v_fr.charge_status is not null then
    raise exception 'funding has already moved on — the way to collect can''t change now';
  end if;
  if public.funding_request_has_commitments(p_funding_request_id) then
    raise exception 'people have already committed — the way to collect can''t change now';
  end if;
  update public.funding_requests
    set collection_mode = p_mode,
        collection_mode_chosen_at = now(),
        platform_fee_percent = case when p_mode = 'peer_pledge' then 0 else 5 end
    where id = p_funding_request_id;
end;
$$;
revoke execute on function public.set_collection_mode(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.set_collection_mode(uuid, text, uuid) to service_role;

-- ---- organizer: settings -----------------------------------------------------
create or replace function public.set_pledge_settings(p_funding_request_id uuid, p_cap_percent numeric, p_window_hours int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.funding_requests := public.pledge_require_organizer(p_funding_request_id);
begin
  if p_cap_percent is distinct from v.pledge_cap_percent then
    if exists (select 1 from public.funding_pledges where funding_request_id = p_funding_request_id and status <> 'withdrawn') then
      raise exception 'people have already pledged on these terms — the cap can''t change now';
    end if;
    if p_cap_percent < 0 or p_cap_percent > 50 then
      raise exception 'the cap must be between 0%% and 50%%';
    end if;
  end if;
  if p_window_hours is distinct from v.pay_window_hours then
    if v.pay_window_opened_at is not null then
      raise exception 'the pay window is already open';
    end if;
    if p_window_hours < 24 or p_window_hours > 72 then
      raise exception 'the pay window must be 24 to 72 hours';
    end if;
  end if;
  update public.funding_requests
    set pledge_cap_percent = p_cap_percent, pay_window_hours = p_window_hours
    where id = p_funding_request_id;
end;
$$;
revoke execute on function public.set_pledge_settings(uuid, numeric, int) from public, anon;
grant execute on function public.set_pledge_settings(uuid, numeric, int) to authenticated;

create or replace function public.open_pay_window(p_funding_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.funding_requests := public.pledge_require_organizer(p_funding_request_id);
begin
  if v.pay_window_opened_at is null then
    update public.funding_requests set pay_window_opened_at = now() where id = p_funding_request_id;
  end if;
end;
$$;
revoke execute on function public.open_pay_window(uuid) from public, anon;
grant execute on function public.open_pay_window(uuid) to authenticated;

-- ---- member: pledge, withdraw, "I've paid" -----------------------------------
create or replace function public.accept_pledge(p_funding_request_id uuid, p_terms_version text, p_locale text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fr record;
  v_ref text;
  v_pledged int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select id, status, charge_status, collection_mode, collection_mode_chosen_at, individual_amount,
         pledge_cap_percent, funding_deadline, pay_window_opened_at
    into v_fr from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_funding_request_member(p_funding_request_id) then
    raise exception 'not a member of this funding request';
  end if;
  if v_fr.collection_mode <> 'peer_pledge' or v_fr.collection_mode_chosen_at is null then
    raise exception 'the organizer hasn''t set up pledges for this yet';
  end if;
  if v_fr.status <> 'collecting' then
    raise exception 'this isn''t collecting anymore';
  end if;
  if v_fr.funding_deadline is not null and v_fr.funding_deadline <= now() then
    raise exception 'the deadline to pledge has passed';
  end if;
  if not exists (
    select 1 from public.funding_request_elements fre
    join public.element_participants ep on ep.element_id = fre.element_id
    where fre.funding_request_id = p_funding_request_id and ep.participant_id = v_uid and ep.opted_in = true
  ) then
    raise exception 'only people in this element can pledge a share';
  end if;
  if exists (select 1 from public.funding_pledges where funding_request_id = p_funding_request_id and participant_id = v_uid and status <> 'withdrawn') then
    raise exception 'you''ve already pledged';
  end if;
  if public.funding_request_spots_full(p_funding_request_id, v_uid) then
    raise exception 'every spot is taken — you''re on the waitlist';
  end if;
  if coalesce(p_terms_version, '') = '' then
    raise exception 'accept the pledge terms first';
  end if;

  loop
    v_ref := 'CTC-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.funding_pledges where reference_code = v_ref);
  end loop;

  insert into public.funding_pledges (funding_request_id, participant_id, amount, cap_amount, terms_version, terms_locale, reference_code)
  values (p_funding_request_id, v_uid, v_fr.individual_amount,
          round(v_fr.individual_amount * (1 + v_fr.pledge_cap_percent / 100), 2),
          p_terms_version, case when p_locale in ('en', 'nl') then p_locale else 'en' end, v_ref);

  -- Everyone in has pledged → the pay window opens.
  select count(*) into v_pledged from public.funding_pledges
    where funding_request_id = p_funding_request_id and status <> 'withdrawn';
  if v_fr.pay_window_opened_at is null and v_pledged >= public.funding_request_population_for(p_funding_request_id) then
    update public.funding_requests set pay_window_opened_at = now() where id = p_funding_request_id;
  end if;
  return v_ref;
end;
$$;
revoke execute on function public.accept_pledge(uuid, text, text) from public, anon;
grant execute on function public.accept_pledge(uuid, text, text) to authenticated;

create or replace function public.withdraw_pledge(p_funding_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if public.pledge_paid(p_funding_request_id, v_uid) > 0 then
    raise exception 'your payment has been confirmed — ask the organizer to sort out a refund';
  end if;
  update public.funding_pledges set status = 'withdrawn', withdrawn_at = now()
    where funding_request_id = p_funding_request_id and participant_id = v_uid and status in ('pledged', 'reported_paid');
  if not found then
    raise exception 'you don''t have a pledge to withdraw';
  end if;
end;
$$;
revoke execute on function public.withdraw_pledge(uuid) from public, anon;
grant execute on function public.withdraw_pledge(uuid) to authenticated;

create or replace function public.report_pledge_paid(p_funding_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.funding_pledges set status = 'reported_paid', reported_at = now()
    where funding_request_id = p_funding_request_id and participant_id = auth.uid() and status = 'pledged';
  if not found then
    raise exception 'there''s no pledge waiting for payment';
  end if;
end;
$$;
revoke execute on function public.report_pledge_paid(uuid) from public, anon;
grant execute on function public.report_pledge_paid(uuid) to authenticated;

-- ---- organizer: confirm / undo payments --------------------------------------
-- Records what each person still owes on their share as received. Returns
-- how many payments were confirmed.
create or replace function public.confirm_pledge_payments(p_funding_request_id uuid, p_participant_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.funding_requests := public.pledge_require_organizer(p_funding_request_id);
  p record;
  v_owed numeric;
  v_n int := 0;
begin
  for p in
    select * from public.funding_pledges
    where funding_request_id = p_funding_request_id and participant_id = any(p_participant_ids) and status <> 'withdrawn'
  loop
    v_owed := v.individual_amount - public.pledge_paid(p_funding_request_id, p.participant_id);
    if v_owed > 0 then
      insert into public.funding_contributions (funding_request_id, contributor_id, amount, platform_fee, source)
      values (p_funding_request_id, p.participant_id, v_owed, 0, 'peer');
      v_n := v_n + 1;
    end if;
    update public.funding_pledges set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid() where id = p.id;
  end loop;
  perform public.pledge_settle(p_funding_request_id);
  return v_n;
end;
$$;
revoke execute on function public.confirm_pledge_payments(uuid, uuid[]) from public, anon;
grant execute on function public.confirm_pledge_payments(uuid, uuid[]) to authenticated;

create or replace function public.undo_pledge_payment(p_funding_request_id uuid, p_participant_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.funding_requests := public.pledge_require_organizer(p_funding_request_id);
begin
  update public.funding_contributions set refunded_at = now()
    where funding_request_id = p_funding_request_id and contributor_id = p_participant_id
      and source = 'peer' and refunded_at is null;
  update public.funding_pledges set status = 'pledged', confirmed_at = null, confirmed_by = null
    where funding_request_id = p_funding_request_id and participant_id = p_participant_id and status = 'confirmed';
end;
$$;
revoke execute on function public.undo_pledge_payment(uuid, uuid) from public, anon;
grant execute on function public.undo_pledge_payment(uuid, uuid) to authenticated;

-- ---- organizer: when the window closes with a gap ----------------------------
-- Option 1: cover the gap personally and book anyway. Recorded; nobody is
-- charged anything.
create or replace function public.proceed_with_shortfall(p_funding_request_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.funding_requests := public.pledge_require_organizer(p_funding_request_id);
  v_paid numeric;
  v_gap numeric;
begin
  select coalesce(sum(amount), 0) into v_paid from public.funding_contributions
    where funding_request_id = p_funding_request_id and refunded_at is null;
  v_gap := greatest(v.required_amount - v_paid, 0);
  update public.funding_requests
    set shortfall_accepted_at = now(), shortfall_accepted_by = auth.uid(), shortfall_amount = v_gap,
        status = 'ready_to_purchase'
    where id = p_funding_request_id;
  return v_gap;
end;
$$;
revoke execute on function public.proceed_with_shortfall(uuid) from public, anon;
grant execute on function public.proceed_with_shortfall(uuid) to authenticated;

-- Option 2: drop everyone who hasn't paid (unpaid pledges withdrawn, those
-- people taken out of the element) and spread the cost over who's left —
-- only if the new share stays within the cap everyone agreed to. Paid
-- members then owe the difference, confirmed the same way.
create or replace function public.remove_unpaid_and_recalculate(p_funding_request_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.funding_requests := public.pledge_require_organizer(p_funding_request_id);
  v_els uuid[];
  v_required numeric;
  v_share numeric;
  v_cap numeric;
begin
  if v.pay_window_opened_at is null then
    raise exception 'open the pay window first';
  end if;
  select array_agg(element_id) into v_els from public.funding_request_elements where funding_request_id = p_funding_request_id;

  update public.funding_pledges p set status = 'withdrawn', withdrawn_at = now()
    where p.funding_request_id = p_funding_request_id and p.status in ('pledged', 'reported_paid')
      and public.pledge_paid(p_funding_request_id, p.participant_id) = 0;
  -- Anyone in the element without a live pledge is out.
  update public.element_participants ep set opted_in = false
    where ep.element_id = any(v_els) and ep.opted_in
      and not exists (select 1 from public.funding_pledges p
                      where p.funding_request_id = p_funding_request_id and p.participant_id = ep.participant_id and p.status <> 'withdrawn');

  select sum(public.calculate_required_amount(e.id)) into v_required
    from public.trip_elements e where e.id = any(v_els) and e.type not in ('dates', 'destination');
  v_share := round(coalesce(v_required, v.required_amount) / greatest(public.funding_request_population_for(p_funding_request_id), 1), 2);
  select min(cap_amount) into v_cap from public.funding_pledges
    where funding_request_id = p_funding_request_id and status <> 'withdrawn';
  if v_cap is not null and v_share > v_cap then
    raise exception 'the new share (%) would be above what people agreed to (up to %) — cover the gap yourself or cancel', v_share, v_cap;
  end if;
  update public.funding_requests
    set required_amount = coalesce(v_required, required_amount),
        previous_individual_amount = individual_amount,
        individual_amount = v_share,
        shares_recalculated_at = now()
    where id = p_funding_request_id;
  -- Paid members now owe the difference: back to 'pledged' until confirmed.
  update public.funding_pledges p set status = 'pledged', confirmed_at = null
    where p.funding_request_id = p_funding_request_id and p.status = 'confirmed'
      and public.pledge_paid(p_funding_request_id, p.participant_id) < v_share;
  perform public.pledge_settle(p_funding_request_id);
  return v_share;
end;
$$;
revoke execute on function public.remove_unpaid_and_recalculate(uuid) from public, anon;
grant execute on function public.remove_unpaid_and_recalculate(uuid) to authenticated;

-- ---- what a member needs to pay ---------------------------------------------
-- The purchaser's payout methods, for members of the request only.
create or replace function public.get_pledge_payout_methods(p_funding_request_id uuid)
returns table (id uuid, kind text, label text, account_name text, iban text, url text, qr_path text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_funding_request_member(p_funding_request_id) then
    raise exception 'not a member of this funding request';
  end if;
  return query
    select m.id, m.kind, m.label, m.account_name, m.iban, m.url, m.qr_path
    from public.payout_methods m
    join public.funding_requests f on f.purchaser_id = m.user_id
    where f.id = p_funding_request_id
    order by m.created_at;
end;
$$;
revoke execute on function public.get_pledge_payout_methods(uuid) from public, anon;
grant execute on function public.get_pledge_payout_methods(uuid) to authenticated;

-- ---- the charge job never touches pledge funding ------------------------------
create or replace function public.list_due_funding_charges()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.funding_requests
  where status = 'collecting'
    and charge_status is null
    and collection_mode = 'catoco_psp'
    and funding_deadline is not null
    and funding_deadline <= now()
  order by funding_deadline;
$$;
revoke execute on function public.list_due_funding_charges() from public, anon, authenticated;
grant execute on function public.list_due_funding_charges() to service_role;

-- ---- payments tracker: pledges report as committed / funded -------------------
create or replace function public.get_my_trip_payments(p_trip_id uuid)
returns table (
  funding_request_id uuid, element_id uuid, element_type text, element_label text,
  currency text, amount numeric, status text, failure_reason text, retry_deadline timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_trip_member(p_trip_id) then
    raise exception 'not a member of this trip';
  end if;
  return query
  with fr as (
    select f.id, coalesce(f.currency, 'USD') as currency, f.individual_amount, f.platform_fee_percent, f.retry_deadline
    from public.funding_requests f
    where f.trip_id = p_trip_id and f.status in ('collecting', 'ready_to_purchase', 'booked')
  ),
  mine as (
    select fr.id as fr_id, fr.currency, fr.retry_deadline,
      c.funded_total,
      m.status as mandate_status, m.retry_reason,
      case
        when c.funded_total is not null then 'funded'
        when m.status in ('awaiting_retry', 'charge_failed') then 'failed'
        when m.status in ('active', 'charging', 'held', 'charge_succeeded') then 'committed'
        when pl.id is not null then 'committed'
      end as my_status,
      coalesce(c.funded_total, fr.individual_amount + round(fr.individual_amount * fr.platform_fee_percent / 100, 2)) as total
    from fr
    left join lateral (
      select sum(x.amount + x.platform_fee) as funded_total
      from public.funding_contributions x
      where x.funding_request_id = fr.id and x.contributor_id = v_uid and x.refunded_at is null
      having count(*) > 0
    ) c on true
    left join lateral (
      select mm.status, mm.retry_reason from public.funding_mandates mm
      where mm.funding_request_id = fr.id and mm.participant_id = v_uid
        and mm.status not in ('pending', 'canceled', 'refunded')
      order by mm.created_at desc limit 1
    ) m on true
    left join lateral (
      select p.id from public.funding_pledges p
      where p.funding_request_id = fr.id and p.participant_id = v_uid and p.status <> 'withdrawn'
      limit 1
    ) pl on true
  ),
  els as (
    select mine.*, e.id as el_id, e.type as el_type, e.label as el_label,
      greatest(coalesce(public.calculate_required_amount(e.id), 0), 0) as w,
      row_number() over (partition by mine.fr_id order by e.created_at, e.id) as rn,
      count(*) over (partition by mine.fr_id) as n
    from mine
    join public.funding_request_elements fre on fre.funding_request_id = mine.fr_id
    join public.trip_elements e on e.id = fre.element_id
    where mine.my_status is not null
  ),
  split as (
    select els.*,
      case when sum(w) over (partition by fr_id) > 0
           then round(total * w / sum(w) over (partition by fr_id), 2)
           else round(total / n, 2) end as raw
    from els
  )
  select s.fr_id, s.el_id, s.el_type, s.el_label, s.currency,
    case when s.rn = s.n then s.total - (sum(s.raw) over (partition by s.fr_id) - s.raw) else s.raw end,
    s.my_status,
    case when s.my_status = 'failed' then coalesce(s.retry_reason, case when s.mandate_status = 'charge_failed' then 'settlement_failed' end) end,
    case when s.my_status = 'failed' then s.retry_deadline end
  from split s
  order by s.currency, s.fr_id, s.rn;
end;
$$;
grant execute on function public.get_my_trip_payments(uuid) to authenticated;

create or replace function public.get_trip_payment_summary(p_trip_id uuid)
returns table (
  element_id uuid, element_type text, element_label text, currency text,
  required numeric, committed numeric, captured numeric, paid_to_vendor numeric,
  n_committed int, n_funded int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can see trip payments';
  end if;
  return query
  with fr as (
    select f.id, coalesce(f.currency, 'USD') as currency, f.required_amount, f.individual_amount, f.actual_amount_paid, f.status
    from public.funding_requests f
    where f.trip_id = p_trip_id and f.status in ('collecting', 'ready_to_purchase', 'booked')
  ),
  per_person as (
    select fr.id as fr_id, p.uid,
      exists (select 1 from public.funding_contributions x where x.funding_request_id = fr.id and x.contributor_id = p.uid and x.refunded_at is null) as funded,
      exists (select 1 from public.funding_mandates m where m.funding_request_id = fr.id and m.participant_id = p.uid
              and m.status in ('active', 'charging', 'held', 'awaiting_retry', 'charge_succeeded'))
      or exists (select 1 from public.funding_pledges pl where pl.funding_request_id = fr.id and pl.participant_id = p.uid
              and pl.status <> 'withdrawn') as has_mandate
    from fr
    cross join lateral (
      select distinct m.participant_id as uid from public.funding_mandates m where m.funding_request_id = fr.id
      union
      select distinct x.contributor_id from public.funding_contributions x where x.funding_request_id = fr.id
      union
      select distinct pl.participant_id from public.funding_pledges pl where pl.funding_request_id = fr.id
    ) p
  ),
  fr_tot as (
    select fr.*,
      (select count(*) from per_person pp where pp.fr_id = fr.id and (pp.funded or pp.has_mandate))::int as n_committed,
      (select count(*) from per_person pp where pp.fr_id = fr.id and pp.funded)::int as n_funded,
      coalesce((select sum(x.amount) from public.funding_contributions x where x.funding_request_id = fr.id and x.refunded_at is null), 0) as captured
    from fr
  ),
  els as (
    select t.*, e.id as el_id, e.type as el_type, e.label as el_label,
      greatest(coalesce(public.calculate_required_amount(e.id), 0), 0) as w,
      count(*) over (partition by t.id) as n,
      b.amount_charged
    from fr_tot t
    join public.funding_request_elements fre on fre.funding_request_id = t.id
    join public.trip_elements e on e.id = fre.element_id
    left join public.element_bookings b on b.element_id = e.id
  ),
  ratio as (
    select els.*, case when sum(w) over (partition by id) > 0 then w / sum(w) over (partition by id) else 1.0 / n end as r
    from els
  )
  select r.el_id, r.el_type, r.el_label, r.currency,
    round(r.required_amount * r.r, 2),
    round(r.individual_amount * r.n_committed * r.r, 2),
    round(r.captured * r.r, 2),
    coalesce(r.amount_charged, case when r.status = 'booked' then round(coalesce(r.actual_amount_paid, r.required_amount) * r.r, 2) end),
    r.n_committed, r.n_funded
  from ratio r
  order by r.currency, r.el_label;
end;
$$;
grant execute on function public.get_trip_payment_summary(uuid) to authenticated;

notify pgrst, 'reload schema';
