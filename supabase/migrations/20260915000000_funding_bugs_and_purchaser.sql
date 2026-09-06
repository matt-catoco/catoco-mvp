-- ============================================================================
-- Flow-audit prompt, §9 (two real bugs) + §12 (purchaser assignment).
-- Both confirmed against actual current code before writing this fix, not
-- assumed -- reproduced live per the ticket, and independently re-verified
-- here by reading calculate_required_amount/create_funding_request_for_
-- element/add_funding_contribution directly.
--
-- Bug 1 (lock-order): calculate_required_amount() returns null for a
-- per_night option when the trip's Dates element isn't locked yet ->
-- create_funding_request_for_element() returns null -> no funding_requests
-- row is ever created, with no retry once Dates later locks. Fix:
-- backfill_funding_for_dates() finds any already-locked, per_night-priced
-- element in the trip with no active funding_requests row and creates one
-- retroactively -- called from every place a Dates element can become
-- locked (create_element, lock_element, resolve_due_elements).
--
-- Bug 2 (no auto-progress at 100%): add_funding_contribution() inserted the
-- contribution but never checked whether the new total cleared the
-- required_amount -- status stayed 'collecting' until the deadline passed
-- and the organizer manually resolved it, even if funded well before then.
-- Fix: check after inserting, transition to ready_to_purchase immediately
-- if collected >= required, independent of the deadline.
--
-- §12: purchaser now defaults to the organizer at lock-in (not "whoever
-- created the element", today's actual behavior) -- flipped in
-- create_funding_request_for_element(). New reassign_purchaser() RPC lets
-- an organizer/co-organizer name a different participant afterward.
-- ============================================================================

-- ---- backfill_funding_for_dates: retroactive fix for bug 1 ----------------
create or replace function public.backfill_funding_for_dates(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_el record;
begin
  for v_el in
    select e.id
    from public.trip_elements e
    join public.element_options o on o.id = e.locked_option_id
    where e.trip_id = p_trip_id
      and e.state = 'locked'
      and o.pricing_basis = 'per_night'
      and not exists (
        select 1 from public.funding_request_elements fre
        join public.funding_requests fr on fr.id = fre.funding_request_id
        where fre.element_id = e.id and fr.status <> 'superseded'
      )
  loop
    perform public.create_funding_request_for_element(v_el.id);
  end loop;
end;
$$;

-- ---- create_funding_request_for_element: purchaser defaults to organizer -
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

  -- §12: was coalesce(created_by, organizer_id) -- defaults to whoever
  -- proposed the element. Now always the organizer at lock-in; reassignable
  -- afterward via reassign_purchaser() below.
  v_purchaser_id := v_organizer_id;

  insert into public.funding_requests (trip_id, purchaser_id, required_amount, status)
  values (v_trip_id, v_purchaser_id, v_required, 'collecting')
  returning id into v_fr_id;

  insert into public.funding_request_elements (funding_request_id, element_id)
  values (v_fr_id, p_element_id);

  return v_fr_id;
end;
$$;

-- ---- reassign_purchaser: organizer/co-organizer manual override -----------
create or replace function public.reassign_purchaser(p_funding_request_id uuid, p_purchaser_id uuid)
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
    raise exception 'only the organizer or a co-organizer can reassign the purchaser';
  end if;
  if not exists (
    select 1 from public.trip_participants where trip_id = v_trip_id and user_id = p_purchaser_id
    union
    select 1 from public.trips where id = v_trip_id and organizer_id = p_purchaser_id
  ) then
    raise exception 'that person is not on this trip';
  end if;

  update public.funding_requests set purchaser_id = p_purchaser_id where id = p_funding_request_id;
end;
$$;

grant execute on function public.reassign_purchaser(uuid, uuid) to authenticated;

-- ---- add_funding_contribution: bug 2 fix, auto-progress at 100% -----------
create or replace function public.add_funding_contribution(p_funding_request_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_required numeric;
  v_collected numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'amount must be greater than 0';
  end if;

  select status, required_amount into v_status, v_required
    from public.funding_requests where id = p_funding_request_id;
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

  select coalesce(sum(amount), 0) into v_collected
    from public.funding_contributions where funding_request_id = p_funding_request_id;

  if v_collected >= v_required then
    update public.funding_requests set status = 'ready_to_purchase' where id = p_funding_request_id;
  end if;
end;
$$;

-- ---- create_element: backfill after locking a Dates element ---------------
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
  v_is_organizer boolean;
  v_scope uuid[];
  v_scope_all boolean;
  v_bad_count int;
  v_el_id uuid;
  v_state text := coalesce(p_state, 'open');
  v_options_deadline timestamptz := p_options_deadline;
  v_voting_deadline timestamptz := p_voting_deadline;
  v_opt jsonb;
  v_opt_id uuid;
  v_opt_count int := jsonb_array_length(coalesce(p_options, '[]'::jsonb));
  v_first_opt_id uuid;
  v_locked_via text;
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

  v_is_organizer := public.is_trip_organizer(p_trip_id);

  if not v_is_organizer or p_scope_user_ids is null or array_length(p_scope_user_ids, 1) is null then
    v_scope_all := true;
    select coalesce(array_agg(user_id), array[]::uuid[]) into v_scope
      from public.trip_participants where trip_id = p_trip_id;
  else
    v_scope_all := false;
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
      v_is_organizer
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
    v_locked_via := 'organizer';
  end if;

  insert into public.trip_elements
    (trip_id, type, label, metadata, state, options_deadline, voting_deadline, created_by, locked_via, scope_all)
  values
    (p_trip_id, p_type, btrim(p_label), coalesce(p_metadata, '{}'::jsonb), v_state,
     v_options_deadline, v_voting_deadline, v_uid, v_locked_via, v_scope_all)
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
    if p_type = 'dates' then
      perform public.backfill_funding_for_dates(p_trip_id);
    end if;
  end if;

  insert into public.element_participants (element_id, participant_id, opted_in)
  select v_el_id, s, true from unnest(v_scope) as s
  on conflict (element_id, participant_id) do nothing;

  return v_el_id;
end;
$$;

-- ---- lock_element: backfill after locking a Dates element -----------------
create or replace function public.lock_element(p_element_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_state text;
  v_type text;
begin
  select trip_id, state, type into v_trip_id, v_state, v_type
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
        voting_deadline = null,
        locked_via = 'organizer'
    where id = p_element_id;

  perform public.create_funding_request_for_element(p_element_id);
  if v_type = 'dates' then
    perform public.backfill_funding_for_dates(v_trip_id);
  end if;
end;
$$;

-- ---- resolve_due_elements: backfill after auto-locking a Dates element ----
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
      set state = 'locked', locked_option_id = v_winner_option_id, locked_via = 'vote'
      where id = v_el.id;

    perform public.create_funding_request_for_element(v_el.id);
    if v_el.type = 'dates' then
      perform public.backfill_funding_for_dates(p_trip_id);
    end if;
  end loop;
end;
$$;
