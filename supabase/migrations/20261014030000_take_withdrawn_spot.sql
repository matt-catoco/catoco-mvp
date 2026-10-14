-- ============================================================================
-- Someone new takes a withdrawn spot (founder, 2026-10-14).
--
-- On a group-split pool, a withdrawal pauses Commit until the organizer
-- recalculates — or someone takes the spot. A trip member who isn't on the
-- (locked) element can take a withdrawn spot: the person who withdrew is
-- moved to "not participating" on the element (they stay on the trip), the
-- newcomer is added, and the headcount — so everyone's share — stays the
-- same. With every withdrawn spot filled, the pause clears by itself. The
-- newcomer then commits like anyone else.
--
-- Non-members of an element can't read its funding (RLS), so the page asks
-- get_element_open_spot() whether there's a spot to take.
-- ============================================================================

-- For a trip member who isn't on this element: is there a withdrawn spot to take?
create or replace function public.get_element_open_spot(p_element_id uuid)
returns table (funding_request_id uuid, open_spots int, individual_amount numeric, currency text, funding_deadline timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_trip uuid;
  v_fr record;
  v_open int;
begin
  select trip_id into v_trip from public.trip_elements where id = p_element_id;
  if v_trip is null or v_uid is null or not public.is_trip_member(v_trip) then
    return;
  end if;
  if exists (
    select 1 from public.element_participants ep
    where ep.element_id = p_element_id and ep.participant_id = v_uid and ep.opted_in = true
  ) then
    return;
  end if;
  select fr.id, fr.individual_amount, fr.currency, fr.funding_deadline into v_fr
    from public.funding_request_elements fre join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = p_element_id and fr.status = 'collecting' and fr.charge_status is null
      and (fr.funding_deadline is null or fr.funding_deadline > now())
    limit 1;
  if v_fr.id is null or not public.funding_request_is_group_split(v_fr.id) then
    return;
  end if;
  select count(*)::int into v_open from public.funding_request_pending_withdrawals(v_fr.id);
  if v_open = 0 then
    return;
  end if;
  funding_request_id := v_fr.id;
  open_spots := v_open;
  individual_amount := v_fr.individual_amount;
  currency := v_fr.currency;
  funding_deadline := v_fr.funding_deadline;
  return next;
end;
$$;
revoke execute on function public.get_element_open_spot(uuid) from public, anon;
grant execute on function public.get_element_open_spot(uuid) to authenticated;

-- Take the spot of whoever withdrew first.
create or replace function public.take_withdrawn_spot(p_funding_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fr record;
  v_els uuid[];
  v_out uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select id, trip_id, status, charge_status, funding_deadline into v_fr
    from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null or not public.is_trip_member(v_fr.trip_id) then
    raise exception 'funding request not found';
  end if;
  if v_fr.status <> 'collecting' or v_fr.charge_status is not null
     or (v_fr.funding_deadline is not null and v_fr.funding_deadline <= now()) then
    raise exception 'this is no longer taking new people';
  end if;
  if not public.funding_request_is_group_split(v_fr.id) then
    raise exception 'there''s no spot to take here';
  end if;
  select array_agg(element_id) into v_els from public.funding_request_elements where funding_request_id = v_fr.id;
  if exists (
    select 1 from public.element_participants
    where element_id = any(v_els) and participant_id = v_uid and opted_in = true
  ) then
    raise exception 'you''re already part of this';
  end if;

  -- whoever withdrew first
  select w.id into v_out
    from public.funding_request_pending_withdrawals(v_fr.id) as w(id)
    order by (
      select m.canceled_at from public.funding_mandates m
      where m.funding_request_id = v_fr.id and m.participant_id = w.id
      order by m.created_at desc limit 1
    )
    limit 1;
  if v_out is null then
    raise exception 'someone already took the spot';
  end if;

  update public.element_participants
    set opted_in = false
    where element_id = any(v_els) and participant_id = v_out;
  insert into public.element_participants (element_id, participant_id, opted_in)
    select e, v_uid, true from unnest(v_els) as e
    join public.trip_elements te on te.id = e and te.type not in ('dates', 'destination')
    on conflict (element_id, participant_id) do update set opted_in = true;

  perform public.refresh_funding_mandate_readiness(v_fr.id);
end;
$$;
revoke execute on function public.take_withdrawn_spot(uuid) from public, anon;
grant execute on function public.take_withdrawn_spot(uuid) to authenticated;

notify pgrst, 'reload schema';
