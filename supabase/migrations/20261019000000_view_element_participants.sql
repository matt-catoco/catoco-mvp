-- "Participants see who's on the same element" (founder, 2026-10-19).
--
-- A second visibility switch beside view_all_participants ("see everyone on
-- the trip"). With the trip list hidden and this on, a participant still
-- sees the names of the others invited to the elements they're part of —
-- a trip split into groups (a dinner, a sub-group flight) shows each group
-- to itself without opening the whole roster. Default on.

alter table public.trips
  add column if not exists view_element_participants boolean not null default true;

-- An element's invitees, as this viewer may see them. Organizers and
-- co-organizers: everyone. Participants: everyone when the trip shows its
-- whole list, or when they're on this element and the element switch is
-- on; otherwise only their own row. Hidden people aren't returned at all
-- (the page counts "N in" from element_participants, which element members
-- can already read).
create or replace function public.get_element_invitees(p_element_id uuid)
returns table (user_id uuid, display_name text, opted_in boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_all boolean;
  v_element boolean;
  v_see_all boolean;
begin
  select e.trip_id, t.view_all_participants, t.view_element_participants
    into v_trip_id, v_all, v_element
    from public.trip_elements e join public.trips t on t.id = e.trip_id
    where e.id = p_element_id;
  if v_trip_id is null or not public.is_trip_member(v_trip_id) then
    return;
  end if;

  v_see_all := public.is_trip_organizer(v_trip_id)
    or coalesce(v_all, true)
    or (coalesce(v_element, true) and exists (
          select 1 from public.element_participants me
          where me.element_id = p_element_id and me.participant_id = auth.uid()));

  return query
    select ep.participant_id, p.display_name, ep.opted_in
    from public.element_participants ep
    left join public.profiles p on p.id = ep.participant_id
    where ep.element_id = p_element_id
      and (v_see_all or ep.participant_id = auth.uid());
end;
$$;
revoke execute on function public.get_element_invitees(uuid) from public, anon;
grant execute on function public.get_element_invitees(uuid) to authenticated;

-- Trip setting: adds p_view_element_participants (null = leave as is).
drop function if exists public.update_trip_advanced(uuid, integer, boolean, integer, boolean, boolean, boolean);
create function public.update_trip_advanced(
  p_trip_id uuid,
  p_voting_deadline_days integer,
  p_view_all_participants boolean,
  p_deadline_alert_hours integer,
  p_show_voters boolean default null,
  p_allow_checkout_cushion boolean default null,
  p_notify_price_drift boolean default null,
  p_view_element_participants boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can change trip settings';
  end if;
  if p_voting_deadline_days is not null and p_voting_deadline_days not between 1 and 90 then
    raise exception 'the voting deadline default must be 1–90 days';
  end if;
  if p_deadline_alert_hours not in (12, 24, 48) then
    raise exception 'the deadline alert must be 12, 24 or 48 hours';
  end if;
  update public.trips
    set voting_deadline_days = p_voting_deadline_days,
        view_all_participants = coalesce(p_view_all_participants, true),
        deadline_alert_hours = p_deadline_alert_hours,
        show_voters = coalesce(p_show_voters, show_voters),
        allow_checkout_cushion = coalesce(p_allow_checkout_cushion, allow_checkout_cushion),
        notify_price_drift = coalesce(p_notify_price_drift, notify_price_drift),
        view_element_participants = coalesce(p_view_element_participants, view_element_participants)
    where id = p_trip_id;
end;
$$;
revoke execute on function public.update_trip_advanced(uuid, integer, boolean, integer, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.update_trip_advanced(uuid, integer, boolean, integer, boolean, boolean, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
