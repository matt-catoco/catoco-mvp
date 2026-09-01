-- ============================================================================
-- Flow #3 follow-up — an element can be removed entirely
--
-- Editing already covered fixing a mistake; this covers "this shouldn't
-- exist at all" (added the wrong type, duplicate of another element, etc).
-- Same authority as editing: the organizer, a co-organizer, or the
-- element's own creator — no state restriction, matching how editing an
-- element (not a candidate option) already works regardless of locked/open.
--
-- No cascade logic needed here: trip_elements' existing FKs already cascade
-- (element_options -> votes, element_participants), so deleting the row
-- cleanly removes everything under it.
-- ============================================================================

create or replace function public.delete_element(p_element_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_created_by uuid;
begin
  select trip_id, created_by into v_trip_id, v_created_by
    from public.trip_elements where id = p_element_id;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not (public.is_trip_organizer(v_trip_id) or auth.uid() = v_created_by) then
    raise exception 'only the organizer, a co-organizer, or the element''s creator can delete it';
  end if;

  delete from public.trip_elements where id = p_element_id;
end;
$$;

revoke all on function public.delete_element(uuid) from public;
grant execute on function public.delete_element(uuid) to authenticated;
