-- ============================================================================
-- Flow #3 follow-up — organizer/co-organizer can lock an open element early
--
-- Every existing path to "locked" was automatic: locking at creation (the
-- creator declares it, subject to the existing solo-scope rule) or
-- resolve_due_elements() auto-locking on voting_deadline. There was no way
-- for an organizer to just end the vote and pick a winner on their own
-- authority. This adds that — picks one of the element's current candidates
-- and locks it immediately, bypassing the rest of voting.
-- ============================================================================

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
end;
$$;

revoke all on function public.lock_element(uuid, uuid) from public;
grant execute on function public.lock_element(uuid, uuid) to authenticated;
