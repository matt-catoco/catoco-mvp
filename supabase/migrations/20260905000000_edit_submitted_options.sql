-- ============================================================================
-- Flow #3 follow-up — a submitted candidate option can be fixed
--
-- update_element() (previous migration) only covers the element itself
-- (label/metadata/deadlines/the one locked value). It never touched
-- individual candidate options on an open element — if you proposed a
-- restaurant with the wrong price, there was no way to fix it, only to
-- submit a second, corrected candidate alongside the wrong one. This closes
-- that gap: the proposer (or organizer/co-organizer) can edit a candidate's
-- value while its element is still open. Once locked, editing candidates no
-- longer makes sense — the decided value gets fixed through update_element
-- instead, and the losing candidates are moot.
-- ============================================================================

create or replace function public.update_option(p_option_id uuid, p_value jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_element_id uuid;
  v_proposed_by uuid;
  v_state text;
  v_trip_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select eo.element_id, eo.proposed_by, e.state, e.trip_id
    into v_element_id, v_proposed_by, v_state, v_trip_id
    from public.element_options eo
    join public.trip_elements e on e.id = eo.element_id
    where eo.id = p_option_id;

  if v_element_id is null then
    raise exception 'option not found';
  end if;
  if v_state <> 'open' then
    raise exception 'this element is no longer open';
  end if;
  if not (v_uid = v_proposed_by or public.is_trip_organizer(v_trip_id)) then
    raise exception 'only the proposer, organizer, or co-organizer can edit this';
  end if;

  update public.element_options set value = p_value where id = p_option_id;
end;
$$;

revoke all on function public.update_option(uuid, jsonb) from public;
grant execute on function public.update_option(uuid, jsonb) to authenticated;
