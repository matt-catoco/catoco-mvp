-- ============================================================================
-- Flow #3 follow-up — a third element status: Funded
--
-- Mirrors the homepage hero mockup's 3-item key: open/still voting ->
-- confirmed/locked in by the group -> funded/ready to go. "Confirmed"
-- already meant exactly "locked in by the group" — this adds the milestone
-- beyond it. No real funding/payment mechanism exists yet, so this is a
-- manually-settable flag with no functional teeth (yet) — same authority
-- model as editing an element (organizer, co-organizer, or the element's
-- own creator), gated to already-locked elements only (nothing can be
-- "funded" before the group has actually decided on it).
-- ============================================================================

alter table public.trip_elements add column if not exists funded_at timestamptz;

create or replace function public.mark_element_funded(p_element_id uuid, p_funded boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_created_by uuid;
  v_state text;
begin
  select trip_id, created_by, state into v_trip_id, v_created_by, v_state
    from public.trip_elements where id = p_element_id;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not (public.is_trip_organizer(v_trip_id) or auth.uid() = v_created_by) then
    raise exception 'only the organizer, a co-organizer, or the element''s creator can do this';
  end if;
  if v_state <> 'locked' then
    raise exception 'element must be confirmed (locked) before it can be marked funded';
  end if;

  update public.trip_elements
    set funded_at = case when p_funded then now() else null end
    where id = p_element_id;
end;
$$;

revoke all on function public.mark_element_funded(uuid, boolean) from public;
grant execute on function public.mark_element_funded(uuid, boolean) to authenticated;
