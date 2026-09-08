-- ============================================================================
-- Funding bundling (chain-at-creation) + fixed individual_amount.
--
-- §3 bundle_group_id: a chained bundle's members all share one
-- bundle_group_id -- the FIRST element's own id, reused as the tag (same
-- self-referential-FK pattern as derived_from_element_id). create_element()
-- takes a new p_start_bundle boolean: when true, the anchor's own row gets
-- bundle_group_id = its own id, set right after insert -- inside the same
-- function call, before the locked-state branch below it fires
-- create_funding_request_for_element(). A separate follow-up RPC to tag the
-- anchor was the first attempt here and was wrong: an anchor created
-- already-locked would get its individual funding_request made by
-- create_element's own locked-state branch before any later call had a
-- chance to set bundle_group_id first, so it was created unbundled anyway
-- (caught by the bundling regression test below). Every element chained
-- after the anchor just passes that same id as p_bundle_group_id at
-- creation. "Every member of this bundle" is then just
-- `bundle_group_id = X or id = X`.
--
-- §4 funding trigger: create_funding_request_for_element() now checks
-- bundle_group_id. Unbundled: unchanged. Bundled: no funding_request until
-- every member has locked; once they have, one funding_request covers the
-- whole group (summed required_amount, funding_request_elements row per
-- member). Replaces bundle_funding_requests() (dropped below) outright.
--
-- §5 individual_amount: computed once at funding_request creation, never
-- redistributed. Population is the union of everyone opted into ANY bundle
-- member (element_participants, opted_in = true), falling back to the
-- trip's min_participants when that union is empty -- degenerates to
-- calculate_required_amount()'s own per_person population for a single
-- unbundled element. add_funding_contribution() now rejects any amount
-- other than the caller's individual_amount, and the collecting ->
-- ready_to_purchase transition (there and in resolve_funding_outcome) is
-- "every opted-in participant has recorded exactly one contribution", not
-- a monetary sum -- sidesteps the cent-rounding trap without any
-- remainder-splitting logic.
-- ============================================================================

alter table public.trip_elements
  add column if not exists bundle_group_id uuid references public.trip_elements(id) on delete set null;

alter table public.funding_requests
  add column if not exists individual_amount numeric;

-- ---- funding_request_participant_population: shared population for the
-- individual_amount denominator and the "has everyone paid" check. -------
create or replace function public.funding_request_participant_population(p_element_ids uuid[])
returns int
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_count int;
  v_min_participants int;
begin
  if p_element_ids is null or array_length(p_element_ids, 1) is null then
    return 1;
  end if;

  select count(distinct ep.participant_id) into v_count
    from public.element_participants ep
    where ep.element_id = any(p_element_ids) and ep.opted_in = true;

  if v_count > 0 then
    return v_count;
  end if;

  select trip_id into v_trip_id from public.trip_elements where id = p_element_ids[1];
  select min_participants into v_min_participants from public.trips where id = v_trip_id;
  return greatest(coalesce(v_min_participants, 1), 1);
end;
$$;

-- ---- create_funding_request_for_element: bundle-aware ---------------------
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
  v_bundle_group_id uuid;
  v_member_ids uuid[];
  v_unlocked_count int;
  v_required numeric := 0;
  v_member_required numeric;
  v_member_id uuid;
  v_member_type text;
  v_priced_count int := 0;
  v_population int;
  v_individual numeric;
  v_fr_id uuid;
begin
  select e.trip_id, e.type, e.bundle_group_id, t.organizer_id
    into v_trip_id, v_type, v_bundle_group_id, v_organizer_id
    from public.trip_elements e
    join public.trips t on t.id = e.trip_id
    where e.id = p_element_id;

  if v_trip_id is null then
    return null;
  end if;

  if v_bundle_group_id is null then
    -- unbundled: unchanged behavior, just this one element.
    if v_type in ('dates', 'destination') then
      return null;
    end if;
    v_required := public.calculate_required_amount(p_element_id);
    if v_required is null then
      return null;
    end if;
    v_member_ids := array[p_element_id];
  else
    select array_agg(id) into v_member_ids
      from public.trip_elements
      where bundle_group_id = v_bundle_group_id or id = v_bundle_group_id;

    select count(*) into v_unlocked_count
      from public.trip_elements
      where id = any(v_member_ids) and state <> 'locked';
    if v_unlocked_count > 0 then
      return null; -- wait for the rest of the bundle to lock
    end if;

    if exists (
      select 1 from public.funding_request_elements fre
      join public.funding_requests fr on fr.id = fre.funding_request_id
      where fre.element_id = any(v_member_ids) and fr.status <> 'superseded'
    ) then
      return null; -- already created for this bundle (re-entrant call)
    end if;

    for v_member_id in select unnest(v_member_ids) loop
      select type into v_member_type from public.trip_elements where id = v_member_id;
      if v_member_type in ('dates', 'destination') then
        continue;
      end if;
      v_member_required := public.calculate_required_amount(v_member_id);
      if v_member_required is null then
        return null; -- one priced member can't compute its share yet (e.g.
                      -- per_night with Dates not locked) -- wait
      end if;
      v_required := v_required + v_member_required;
      v_priced_count := v_priced_count + 1;
    end loop;

    if v_priced_count = 0 then
      return null; -- bundle has no priced members at all -- nothing to fund
    end if;
  end if;

  v_purchaser_id := v_organizer_id;
  v_population := public.funding_request_participant_population(v_member_ids);
  v_individual := round(v_required / greatest(v_population, 1), 2);

  insert into public.funding_requests
    (trip_id, purchaser_id, required_amount, individual_amount, status, funding_deadline)
  values
    (v_trip_id, v_purchaser_id, v_required, v_individual, 'collecting', now() + interval '14 days')
  returning id into v_fr_id;

  insert into public.funding_request_elements (funding_request_id, element_id)
  select v_fr_id, m from unnest(v_member_ids) as m;

  return v_fr_id;
end;
$$;

-- ---- add_funding_contribution: fixed to individual_amount, one per person -
create or replace function public.add_funding_contribution(p_funding_request_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
  v_individual numeric;
  v_member_ids uuid[];
  v_population int;
  v_paid_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select status, individual_amount into v_status, v_individual
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
  if v_individual is null or p_amount is distinct from v_individual then
    raise exception 'amount must be exactly your fixed share: %', v_individual;
  end if;
  if exists (
    select 1 from public.funding_contributions
    where funding_request_id = p_funding_request_id and contributor_id = v_uid
  ) then
    raise exception 'you already contributed to this funding request';
  end if;

  insert into public.funding_contributions (funding_request_id, contributor_id, amount)
  values (p_funding_request_id, v_uid, p_amount);

  select array_agg(element_id) into v_member_ids
    from public.funding_request_elements where funding_request_id = p_funding_request_id;
  v_population := public.funding_request_participant_population(v_member_ids);

  select count(distinct contributor_id) into v_paid_count
    from public.funding_contributions where funding_request_id = p_funding_request_id;

  if v_paid_count >= v_population then
    update public.funding_requests set status = 'ready_to_purchase' where id = p_funding_request_id;
  end if;
end;
$$;

-- ---- resolve_funding_outcome: same "everyone's paid" transition ----------
create or replace function public.resolve_funding_outcome(p_funding_request_id uuid, p_still_viable boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_status text;
  v_deadline timestamptz;
  v_element_id uuid;
  v_member_ids uuid[];
  v_population int;
  v_paid_count int;
begin
  select trip_id, status, funding_deadline
    into v_trip_id, v_status, v_deadline
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

  select array_agg(element_id) into v_member_ids
    from public.funding_request_elements where funding_request_id = p_funding_request_id;
  v_population := public.funding_request_participant_population(v_member_ids);

  select count(distinct contributor_id) into v_paid_count
    from public.funding_contributions where funding_request_id = p_funding_request_id;

  if v_paid_count >= v_population then
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

-- ---- backfill individual_amount on funding_requests created before this --
update public.funding_requests fr
set individual_amount = round(
  fr.required_amount / greatest(
    public.funding_request_participant_population(
      array(select fre.element_id from public.funding_request_elements fre where fre.funding_request_id = fr.id)
    ), 1
  ), 2
)
where fr.individual_amount is null and fr.required_amount is not null;

-- ---- create_element: 3 new trailing bundling params ------------------------
-- Same lesson as the just-fixed production outage: CREATE OR REPLACE with a
-- different argument list creates a SECOND overload rather than replacing
-- the first, and two overloads make every named-parameter call ambiguous to
-- PostgREST. Create the new 13-arg version, then explicitly drop the old
-- 10-arg one in the same migration so exactly one ever exists.
--
-- p_start_bundle handles tagging the anchor element of a new bundle with
-- its own id (bundle_group_id can't be included in the INSERT that creates
-- it -- the id doesn't exist yet). A separate follow-up RPC to do that
-- tagging was tried first and was wrong: an anchor created already-locked
-- gets its individual funding_request made by this function's own
-- locked-state branch before returning, so a later call setting
-- bundle_group_id arrives too late -- the funding_request was already
-- created unbundled. Folding the tag into this same function, right after
-- the insert and before the locked-state branch, closes that gap.
create or replace function public.create_element(
  p_trip_id uuid,
  p_type text,
  p_label text,
  p_metadata jsonb default '{}'::jsonb,
  p_scope_user_ids uuid[] default null,
  p_state text default 'open',
  p_options_deadline timestamptz default null,
  p_voting_deadline timestamptz default null,
  p_options jsonb default '[]'::jsonb,
  p_derived_from_element_id uuid default null,
  p_bundle_group_id uuid default null,
  p_start_bundle boolean default false,
  -- §1/§4: while a bundle is still being chained, the membership set in
  -- the DB is necessarily incomplete -- checking "is everyone in this
  -- bundle locked" against whatever members happen to exist SO FAR (not
  -- yet the real final set) would fire the funding_request the moment the
  -- FIRST locked member is created, long before chaining actually finishes.
  -- That's not a query problem SQL can solve on its own -- "more members
  -- are still coming in this session" is a client-side fact, not something
  -- derivable from DB state, so the caller has to say so explicitly. true
  -- on every chained element except the last one (the one created by
  -- clicking the plain "Add element" button, ending the chain).
  p_bundle_continues boolean default false
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
  if p_start_bundle and p_bundle_group_id is not null then
    raise exception 'an element cannot both start a new bundle and join an existing one';
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
    (trip_id, type, label, metadata, state, options_deadline, voting_deadline, created_by, locked_via, scope_all, derived_from_element_id, bundle_group_id)
  values
    (p_trip_id, p_type, btrim(p_label), coalesce(p_metadata, '{}'::jsonb), v_state,
     v_options_deadline, v_voting_deadline, v_uid, v_locked_via, v_scope_all, p_derived_from_element_id, p_bundle_group_id)
  returning id into v_el_id;

  -- §3: tag this element as its own bundle's anchor now, before the
  -- locked-state funding check below -- see the comment above this
  -- function for why a separate follow-up call is too late.
  if p_start_bundle then
    update public.trip_elements set bundle_group_id = v_el_id where id = v_el_id;
  end if;

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
    if not p_bundle_continues then
      perform public.create_funding_request_for_element(v_el_id);
    end if;
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

drop function public.create_element(uuid, text, text, jsonb, uuid[], text, timestamp with time zone, timestamp with time zone, jsonb, uuid);

grant execute on function public.funding_request_participant_population(uuid[]) to authenticated;

-- ---- bundle_funding_requests: replaced outright by the automatic path ----
drop function if exists public.bundle_funding_requests(uuid[]);

notify pgrst, 'reload schema';
