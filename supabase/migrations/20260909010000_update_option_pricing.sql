-- ============================================================================
-- Flow #4 follow-up — update_option() can also fix unit_price/pricing_basis
--
-- Editing a submitted-but-not-yet-locked candidate should be able to fix its
-- real pricing columns too, not just the display value — if it later wins
-- the vote and locks, calculate_required_amount() needs the corrected
-- numbers.
--
-- CREATE OR REPLACE does NOT collapse this into the existing 2-arg version —
-- Postgres treats a different parameter count as a different overload
-- regardless of defaults, so without the explicit drop below this would
-- silently leave both update_option(uuid, jsonb) and update_option(uuid,
-- jsonb, numeric, text) coexisting.
-- ============================================================================

drop function if exists public.update_option(uuid, jsonb);

create or replace function public.update_option(
  p_option_id uuid,
  p_value jsonb,
  p_unit_price numeric default null,
  p_pricing_basis text default null
)
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

  update public.element_options
    set value = p_value,
        unit_price = p_unit_price,
        pricing_basis = p_pricing_basis
    where id = p_option_id;
end;
$$;

grant execute on function public.update_option(uuid, jsonb, numeric, text) to authenticated;
