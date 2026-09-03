-- ============================================================================
-- delete_element() left orphaned funding_requests behind: funding_request_
-- elements.element_id cascade-deletes its own join row when the element is
-- deleted, but the funding_requests row itself has no such cascade -- it
-- keeps existing with status='collecting'/'ready_to_purchase' and no linked
-- element at all, and Trip Home's budgeted-vs-actual rollup sums every
-- non-superseded funding_request for the trip regardless of whether it's
-- still linked to a real element. Deleting an element never stopped its
-- required_amount from counting toward that total.
--
-- Fix: before deleting the element, find any of its funding_requests that
-- would be left with zero linked elements (bundling means a funding_request
-- can span several elements -- only supersede it if THIS was the last one),
-- and mark those superseded. Superseded, not deleted, to keep
-- funding_contributions history intact and match the status every other
-- retirement path (cascade_element_unavailable, bundle_funding_requests)
-- already uses to mean "no longer counts."
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
  v_fr_id uuid;
begin
  select trip_id, created_by into v_trip_id, v_created_by
    from public.trip_elements where id = p_element_id;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not (public.is_trip_organizer(v_trip_id) or auth.uid() = v_created_by) then
    raise exception 'only the organizer, a co-organizer, or the element''s creator can delete it';
  end if;

  for v_fr_id in
    select fre.funding_request_id
    from public.funding_request_elements fre
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = p_element_id
      and fr.status <> 'superseded'
  loop
    if (
      select count(*) from public.funding_request_elements
      where funding_request_id = v_fr_id and element_id <> p_element_id
    ) = 0 then
      update public.funding_requests set status = 'superseded' where id = v_fr_id;
    end if;
  end loop;

  delete from public.trip_elements where id = p_element_id;
end;
$$;
