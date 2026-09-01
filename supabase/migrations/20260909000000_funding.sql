-- ============================================================================
-- Flow #4 — funding calculation + full process
--
-- The moment an element locks, a funding_request snapshots what it costs
-- and starts collecting toward it. At its deadline: funded -> ready to
-- purchase; unfunded -> refund (notional, no real charging exists), then
-- retry (still viable) or fall back (runner-up for voted elements, reopen
-- for organizer-locked ones with no alternative). Purchaser self-reports
-- Booked or Unavailable afterward; Unavailable runs the exact same
-- fallback cascade.
--
-- Explicitly out of scope, stays out: the actual Stripe Issuing card,
-- Stripe Connect account setup, real contribution charging (a minimal
-- manual ledger stands in for it here so the outcome branch is actually
-- reachable, not just correct-looking dead code). Automated
-- Travelpayouts/Viator viability checking doesn't exist anywhere in this
-- codebase (confirmed by search) — every type gets the same manual
-- self-report viability check as Dining for now (resolve_funding_outcome's
-- p_still_viable argument), not just Dining.
-- ============================================================================

-- ---- retire tonight's manual placeholder ----------------------------------
drop function if exists public.mark_element_funded(uuid, boolean);
alter table public.trip_elements drop column if exists funded_at;

-- ---- element_options: real pricing columns ---------------------------------
-- Unlike `value`, these drive actual SQL arithmetic (required_amount =
-- unit_price * multiplier) and need to be reliably typed for that — not
-- buried in freeform jsonb like the rest of the option shape.
alter table public.element_options
  add column if not exists unit_price numeric,
  add column if not exists pricing_basis text;
alter table public.element_options drop constraint if exists element_options_pricing_basis_check;
alter table public.element_options
  add constraint element_options_pricing_basis_check
    check (pricing_basis is null or pricing_basis in ('per_night', 'per_person', 'flat'));

-- ---- trip_elements: booked_at is the real source of "this is done" --------
-- Independent of whether a funding_request exists at all — payment_type
-- none elements (Dates/Destination) still get a booking-confirmation step,
-- they just never get a funding_request.
alter table public.trip_elements add column if not exists booked_at timestamptz;

-- ---- funding_requests --------------------------------------------------
create table if not exists public.funding_requests (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  purchaser_id uuid references auth.users(id) on delete set null,
  required_amount numeric not null,
  funding_deadline timestamptz,
  status text not null default 'collecting'
    check (status in ('collecting', 'ready_to_purchase', 'booked', 'superseded')),
  actual_amount_paid numeric,
  created_at timestamptz not null default now(),
  booked_at timestamptz
);
alter table public.funding_requests enable row level security;
create index if not exists funding_requests_trip_id_idx on public.funding_requests (trip_id);

-- ---- funding_request_elements: join table for bundling ---------------------
-- "At most one ACTIVE (non-superseded) funding_request per element" is
-- enforced by the functions below, not a DB constraint — a superseded
-- chain legitimately reuses the same element_id across multiple historical
-- rows, which a plain unique index can't allow.
create table if not exists public.funding_request_elements (
  funding_request_id uuid not null references public.funding_requests(id) on delete cascade,
  element_id uuid not null references public.trip_elements(id) on delete cascade,
  primary key (funding_request_id, element_id)
);
alter table public.funding_request_elements enable row level security;
create index if not exists funding_request_elements_element_id_idx
  on public.funding_request_elements (element_id);

-- ---- funding_contributions: the manual ledger stand-in ---------------------
create table if not exists public.funding_contributions (
  id uuid primary key default gen_random_uuid(),
  funding_request_id uuid not null references public.funding_requests(id) on delete cascade,
  contributor_id uuid not null references auth.users(id) on delete cascade,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);
alter table public.funding_contributions enable row level security;
create index if not exists funding_contributions_funding_request_id_idx
  on public.funding_contributions (funding_request_id);

-- ---- is_funding_request_member: visibility check ---------------------------
create or replace function public.is_funding_request_member(p_funding_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.funding_requests fr
    where fr.id = p_funding_request_id and public.is_trip_organizer(fr.trip_id)
  ) or exists (
    select 1 from public.funding_request_elements fre
    where fre.funding_request_id = p_funding_request_id
      and public.is_element_member(fre.element_id)
  );
$$;

grant execute on function public.is_funding_request_member(uuid) to authenticated;

drop policy if exists "Funding request members can view" on public.funding_requests;
create policy "Funding request members can view"
  on public.funding_requests for select
  to authenticated
  using (public.is_funding_request_member(id));

drop policy if exists "Funding request members can view elements" on public.funding_request_elements;
create policy "Funding request members can view elements"
  on public.funding_request_elements for select
  to authenticated
  using (public.is_funding_request_member(funding_request_id));

drop policy if exists "Funding request members can view contributions" on public.funding_contributions;
create policy "Funding request members can view contributions"
  on public.funding_contributions for select
  to authenticated
  using (public.is_funding_request_member(funding_request_id));

grant select on public.funding_requests to authenticated;
grant select on public.funding_request_elements to authenticated;
grant select on public.funding_contributions to authenticated;

-- ---- calculate_required_amount ---------------------------------------------
create or replace function public.calculate_required_amount(p_element_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_locked_option_id uuid;
  v_unit_price numeric;
  v_pricing_basis text;
  v_multiplier numeric;
  v_dates_option_id uuid;
  v_dates_value jsonb;
  v_nights numeric;
  v_opted_in_count int;
  v_min_participants int;
begin
  select trip_id, locked_option_id into v_trip_id, v_locked_option_id
    from public.trip_elements where id = p_element_id;

  if v_locked_option_id is null then
    return null;
  end if;

  select unit_price, pricing_basis into v_unit_price, v_pricing_basis
    from public.element_options where id = v_locked_option_id;

  if v_unit_price is null or v_pricing_basis is null then
    return null;
  end if;

  if v_pricing_basis = 'per_night' then
    select locked_option_id into v_dates_option_id
      from public.trip_elements
      where trip_id = v_trip_id and type = 'dates' and state = 'locked'
      limit 1;
    if v_dates_option_id is null then
      return null;
    end if;
    select value into v_dates_value from public.element_options where id = v_dates_option_id;
    if v_dates_value ? 'nights' and jsonb_typeof(v_dates_value->'nights') = 'number' then
      v_nights := (v_dates_value->>'nights')::numeric;
    elsif coalesce(v_dates_value->>'start_date', '') <> '' and coalesce(v_dates_value->>'end_date', '') <> '' then
      v_nights := (v_dates_value->>'end_date')::date - (v_dates_value->>'start_date')::date;
    else
      return null;
    end if;
    v_multiplier := greatest(v_nights, 0);

  elsif v_pricing_basis = 'per_person' then
    select count(*) into v_opted_in_count
      from public.element_participants
      where element_id = p_element_id and opted_in = true;
    if v_opted_in_count > 0 then
      v_multiplier := v_opted_in_count;
    else
      select min_participants into v_min_participants from public.trips where id = v_trip_id;
      v_multiplier := greatest(coalesce(v_min_participants, 1), 1);
    end if;

  else
    v_multiplier := 1;
  end if;

  return round(v_unit_price * v_multiplier, 2);
end;
$$;

grant execute on function public.calculate_required_amount(uuid) to authenticated;

-- ---- create_funding_request_for_element: the shared lock hook -------------
create or replace function public.create_funding_request_for_element(p_element_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_type text;
  v_created_by uuid;
  v_organizer_id uuid;
  v_purchaser_id uuid;
  v_required numeric;
  v_fr_id uuid;
begin
  select e.trip_id, e.type, e.created_by, t.organizer_id
    into v_trip_id, v_type, v_created_by, v_organizer_id
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

  v_purchaser_id := coalesce(v_created_by, v_organizer_id);

  insert into public.funding_requests (trip_id, purchaser_id, required_amount, status)
  values (v_trip_id, v_purchaser_id, v_required, 'collecting')
  returning id into v_fr_id;

  insert into public.funding_request_elements (funding_request_id, element_id)
  values (v_fr_id, p_element_id);

  return v_fr_id;
end;
$$;

grant execute on function public.create_funding_request_for_element(uuid) to authenticated;

-- ---- cascade_element_unavailable: shared fallback --------------------------
-- Internal helper only — no grant to authenticated. Callable exclusively
-- via resolve_funding_outcome() and report_element_booked(), which each
-- enforce their own authority; a security-definer function's nested call
-- to another runs as the definer, not the original caller, so it doesn't
-- need its own grant.
create or replace function public.cascade_element_unavailable(p_element_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_alt_option_id uuid;
begin
  select trip_id into v_trip_id from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;

  update public.funding_requests fr
    set status = 'superseded'
    where status in ('collecting', 'ready_to_purchase')
      and exists (
        select 1 from public.funding_request_elements fre
        where fre.funding_request_id = fr.id and fre.element_id = p_element_id
      );

  select public.get_runner_up_option(p_element_id) into v_alt_option_id;

  if v_alt_option_id is not null then
    update public.trip_elements set locked_option_id = v_alt_option_id where id = p_element_id;
    perform public.create_funding_request_for_element(p_element_id);
  else
    update public.trip_elements set state = 'open', locked_option_id = null where id = p_element_id;
  end if;
end;
$$;

-- ---- resolve_funding_outcome: the lazy deadline-passed trigger -----------
create or replace function public.resolve_funding_outcome(p_funding_request_id uuid, p_still_viable boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_required numeric;
  v_collected numeric;
  v_status text;
  v_deadline timestamptz;
  v_element_id uuid;
begin
  select trip_id, required_amount, status, funding_deadline
    into v_trip_id, v_required, v_status, v_deadline
    from public.funding_requests where id = p_funding_request_id;

  if v_trip_id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can resolve a funding outcome';
  end if;
  if v_status <> 'collecting' then
    raise exception 'funding request is not currently collecting';
  end if;
  if v_deadline is null or v_deadline > now() then
    raise exception 'funding deadline has not passed yet';
  end if;

  select coalesce(sum(amount), 0) into v_collected
    from public.funding_contributions where funding_request_id = p_funding_request_id;

  if v_collected >= v_required then
    update public.funding_requests set status = 'ready_to_purchase' where id = p_funding_request_id;
    return;
  end if;

  if p_still_viable then
    update public.funding_requests set funding_deadline = null where id = p_funding_request_id;
    return;
  end if;

  for v_element_id in
    select element_id from public.funding_request_elements where funding_request_id = p_funding_request_id
  loop
    perform public.cascade_element_unavailable(v_element_id);
  end loop;
end;
$$;

grant execute on function public.resolve_funding_outcome(uuid, boolean) to authenticated;

-- ---- report_element_booked: purchaser self-report --------------------------
create or replace function public.report_element_booked(
  p_element_id uuid,
  p_outcome text,
  p_actual_amount_paid numeric default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip_id uuid;
  v_created_by uuid;
  v_state text;
  v_fr_id uuid;
  v_purchaser_id uuid;
  v_fr_status text;
  v_required numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_outcome not in ('booked', 'unavailable') then
    raise exception 'bad outcome: %', p_outcome;
  end if;

  select trip_id, created_by, state into v_trip_id, v_created_by, v_state
    from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if v_state <> 'locked' then
    raise exception 'element must be locked before it can be reported';
  end if;

  select fr.id, fr.purchaser_id, fr.status, fr.required_amount
    into v_fr_id, v_purchaser_id, v_fr_status, v_required
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    where fre.element_id = p_element_id
      and fr.status in ('collecting', 'ready_to_purchase')
    limit 1;

  if v_fr_id is not null then
    if not (v_uid = v_purchaser_id or public.is_trip_organizer(v_trip_id)) then
      raise exception 'only the purchaser, organizer, or co-organizer can report this';
    end if;
    if p_outcome = 'booked' and v_fr_status <> 'ready_to_purchase' then
      raise exception 'funding is not ready to purchase yet';
    end if;
  else
    if not (v_uid = v_created_by or public.is_trip_organizer(v_trip_id)) then
      raise exception 'only the organizer, a co-organizer, or the element''s creator can report this';
    end if;
  end if;

  if p_outcome = 'unavailable' then
    perform public.cascade_element_unavailable(p_element_id);
    return;
  end if;

  update public.trip_elements set booked_at = now() where id = p_element_id;

  if v_fr_id is not null then
    update public.funding_requests
      set status = 'booked',
          actual_amount_paid = coalesce(p_actual_amount_paid, v_required),
          booked_at = now()
      where id = v_fr_id;
  end if;
end;
$$;

grant execute on function public.report_element_booked(uuid, text, numeric) to authenticated;

-- ---- set_funding_deadline ---------------------------------------------
create or replace function public.set_funding_deadline(p_funding_request_id uuid, p_deadline timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.funding_requests where id = p_funding_request_id;
  if v_trip_id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can set the funding deadline';
  end if;

  update public.funding_requests set funding_deadline = p_deadline where id = p_funding_request_id;
end;
$$;

grant execute on function public.set_funding_deadline(uuid, timestamptz) to authenticated;

-- ---- add_funding_contribution: the manual ledger entry ---------------------
create or replace function public.add_funding_contribution(p_funding_request_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than 0';
  end if;

  select status into v_status from public.funding_requests where id = p_funding_request_id;
  if v_status is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_funding_request_member(p_funding_request_id) then
    raise exception 'not a member of this funding request';
  end if;
  if v_status <> 'collecting' then
    raise exception 'this funding request is not currently collecting';
  end if;

  insert into public.funding_contributions (funding_request_id, contributor_id, amount)
  values (p_funding_request_id, v_uid, p_amount);
end;
$$;

grant execute on function public.add_funding_contribution(uuid, numeric) to authenticated;

-- ---- get_funding_collected: read-side single source of truth --------------
create or replace function public.get_funding_collected(p_funding_request_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(amount), 0)
  from public.funding_contributions
  where funding_request_id = p_funding_request_id;
$$;

grant execute on function public.get_funding_collected(uuid) to authenticated;

-- ---- bundle_funding_requests: manual, organizer/co-organizer only --------
create or replace function public.bundle_funding_requests(p_element_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_total numeric := 0;
  v_new_fr_id uuid;
  v_el_id uuid;
  v_fr record;
begin
  if array_length(p_element_ids, 1) is null or array_length(p_element_ids, 1) < 2 then
    raise exception 'bundle needs at least two elements';
  end if;

  select trip_id into v_trip_id from public.trip_elements where id = p_element_ids[1];
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can bundle funding requests';
  end if;

  insert into public.funding_requests (trip_id, purchaser_id, required_amount, status)
  values (v_trip_id, auth.uid(), 0, 'collecting')
  returning id into v_new_fr_id;

  foreach v_el_id in array p_element_ids loop
    if exists (
      select 1 from public.trip_elements e where e.id = v_el_id and e.trip_id <> v_trip_id
    ) then
      raise exception 'all elements must belong to the same trip';
    end if;

    select fr.id, fr.required_amount, fr.status into v_fr
      from public.funding_requests fr
      join public.funding_request_elements fre on fre.funding_request_id = fr.id
      where fre.element_id = v_el_id
        and fr.status = 'collecting'
        and fr.id <> v_new_fr_id;

    if v_fr.id is null then
      raise exception 'element % has no unbundled collecting funding request', v_el_id;
    end if;

    v_total := v_total + v_fr.required_amount;

    update public.funding_requests set status = 'superseded' where id = v_fr.id;
    insert into public.funding_request_elements (funding_request_id, element_id)
    values (v_new_fr_id, v_el_id);
  end loop;

  update public.funding_requests set required_amount = v_total where id = v_new_fr_id;

  return v_new_fr_id;
end;
$$;

grant execute on function public.bundle_funding_requests(uuid[]) to authenticated;

-- ---- create_element: seed options can carry unit_price/pricing_basis,
-- and locking now creates a funding_request -------------------------------
create or replace function public.create_element(
  p_trip_id uuid,
  p_type text,
  p_label text,
  p_metadata jsonb default '{}'::jsonb,
  p_scope_user_ids uuid[] default null,
  p_state text default 'open',
  p_options_deadline timestamptz default null,
  p_voting_deadline timestamptz default null,
  p_options jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
  v_scope uuid[];
  v_bad_count int;
  v_el_id uuid;
  v_state text := coalesce(p_state, 'open');
  v_options_deadline timestamptz := p_options_deadline;
  v_voting_deadline timestamptz := p_voting_deadline;
  v_opt jsonb;
  v_opt_id uuid;
  v_opt_count int := jsonb_array_length(coalesce(p_options, '[]'::jsonb));
  v_first_opt_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'element needs a label';
  end if;
  if v_state not in ('locked', 'open') then
    raise exception 'bad element state: %', v_state;
  end if;

  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    raise exception 'trip not found';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'not a member of this trip';
  end if;

  if p_scope_user_ids is null or array_length(p_scope_user_ids, 1) is null then
    select coalesce(array_agg(user_id), array[]::uuid[]) into v_scope
      from public.trip_participants where trip_id = p_trip_id;
  else
    select count(*) into v_bad_count
      from unnest(p_scope_user_ids) as uid
      where uid <> v_organizer_id
        and not exists (
          select 1 from public.trip_participants tp
          where tp.trip_id = p_trip_id and tp.user_id = uid
        );
    if v_bad_count > 0 then
      raise exception 'scope includes someone not on this trip';
    end if;
    v_scope := p_scope_user_ids;
  end if;

  if v_uid <> v_organizer_id and not (v_uid = any(v_scope)) then
    v_scope := array_append(v_scope, v_uid);
  end if;

  if v_state = 'locked' then
    if not (
      public.is_trip_organizer(p_trip_id)
      or (array_length(v_scope, 1) = 1 and v_scope[1] = v_uid)
    ) then
      v_state := 'open';
    end if;
  end if;

  if v_state = 'locked' and v_opt_count <> 1 then
    raise exception 'a locked element needs exactly one value';
  end if;
  if v_state = 'open' and v_options_deadline is not null and v_voting_deadline is not null
     and v_options_deadline > v_voting_deadline then
    raise exception 'options_deadline must be on or before voting_deadline';
  end if;
  if v_state = 'locked' then
    v_options_deadline := null;
    v_voting_deadline := null;
  end if;

  insert into public.trip_elements
    (trip_id, type, label, metadata, state, options_deadline, voting_deadline, created_by)
  values
    (p_trip_id, p_type, btrim(p_label), coalesce(p_metadata, '{}'::jsonb), v_state,
     v_options_deadline, v_voting_deadline, v_uid)
  returning id into v_el_id;

  v_first_opt_id := null;
  for v_opt in select value from jsonb_array_elements(coalesce(p_options, '[]'::jsonb))
  loop
    insert into public.element_options (element_id, value, source, proposed_by, unit_price, pricing_basis)
    values (
      v_el_id, v_opt->'value', 'user_proposed', v_uid,
      nullif(v_opt->>'unit_price', '')::numeric,
      nullif(v_opt->>'pricing_basis', '')
    )
    returning id into v_opt_id;
    if v_first_opt_id is null then
      v_first_opt_id := v_opt_id;
    end if;
  end loop;

  if v_state = 'locked' then
    update public.trip_elements set locked_option_id = v_first_opt_id where id = v_el_id;
    perform public.create_funding_request_for_element(v_el_id);
  end if;

  insert into public.element_participants (element_id, participant_id, opted_in)
  select v_el_id, s, true from unnest(v_scope) as s
  on conflict (element_id, participant_id) do nothing;

  return v_el_id;
end;
$$;

-- ---- lock_element: locking now creates a funding_request ------------------
create or replace function public.lock_element(p_element_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_state text;
begin
  select trip_id, state into v_trip_id, v_state
    from public.trip_elements where id = p_element_id;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can do this';
  end if;
  if v_state <> 'open' then
    raise exception 'element is not open';
  end if;
  if not exists (
    select 1 from public.element_options where id = p_option_id and element_id = p_element_id
  ) then
    raise exception 'that option does not belong to this element';
  end if;

  update public.trip_elements
    set state = 'locked',
        locked_option_id = p_option_id,
        options_deadline = null,
        voting_deadline = null
    where id = p_element_id;

  perform public.create_funding_request_for_element(p_element_id);
end;
$$;

-- ---- resolve_due_elements: auto-lock now creates a funding_request -------
create or replace function public.resolve_due_elements(p_trip_id uuid)
returns table(element_id uuid, element_type text, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_el record;
  v_opt_count int;
  v_top_score bigint;
  v_tie_count int;
  v_winner_option_id uuid;
begin
  for v_el in
    select id, type, tie_notified, empty_notified
    from public.trip_elements
    where trip_id = p_trip_id
      and state = 'open'
      and voting_deadline is not null
      and voting_deadline <= now()
  loop
    select count(*) into v_opt_count
      from public.element_options where element_options.element_id = v_el.id;

    if v_opt_count = 0 then
      if not v_el.empty_notified then
        update public.trip_elements set empty_notified = true where id = v_el.id;
        element_id := v_el.id;
        element_type := v_el.type;
        reason := 'empty';
        return next;
      end if;
      continue;
    end if;

    if v_opt_count = 1 then
      select eo.id into v_winner_option_id
        from public.element_options eo where eo.element_id = v_el.id;
    else
      select bs.score into v_top_score
        from public.borda_scores(v_el.id) bs order by bs.score desc limit 1;
      select count(*) into v_tie_count
        from public.borda_scores(v_el.id) bs where bs.score = v_top_score;

      if v_tie_count > 1 then
        if not v_el.tie_notified then
          update public.trip_elements set tie_notified = true where id = v_el.id;
          element_id := v_el.id;
          element_type := v_el.type;
          reason := 'tie';
          return next;
        end if;
        continue;
      end if;

      select bs.option_id into v_winner_option_id
        from public.borda_scores(v_el.id) bs order by bs.score desc limit 1;
    end if;

    update public.trip_elements
      set state = 'locked', locked_option_id = v_winner_option_id
      where id = v_el.id;

    perform public.create_funding_request_for_element(v_el.id);
  end loop;
end;
$$;
