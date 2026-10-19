-- "Elements can have a waitlist" (founder, 2026-10-19).
--
-- One trip setting, on by default. On: an element can have more people
-- invited than it has spots (element_spots(): its own spots, else the trip's
-- maximum); the first to commit get a place and the rest are waitlisted, as
-- today. Off: an element for 4 only ever has 4 people in — adding a fifth
-- (or opting back in) is refused, automatic scoping skips a full element,
-- spots can't be set below who's already in, and the switch can't be turned
-- off while an element is already over.
--
-- The old "allow joining past the max" switch is retired: the trip's maximum
-- is now a plain cap on the invite link.

alter table public.trips
  add column if not exists allow_element_waitlist boolean not null default true;

update public.trips set allow_over_max = false where allow_over_max;

-- Is this element full for one more person (waitlist off only)?
create or replace function public.element_full_without_waitlist(p_element_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not coalesce(t.allow_element_waitlist, true)
     and public.element_spots(e.id) is not null
     and (select count(*) from public.element_participants ep
          where ep.element_id = e.id and ep.opted_in and ep.participant_id <> p_user_id)
         >= public.element_spots(e.id)
  from public.trip_elements e join public.trips t on t.id = e.trip_id
  where e.id = p_element_id;
$$;
revoke execute on function public.element_full_without_waitlist(uuid, uuid) from public, anon;
grant execute on function public.element_full_without_waitlist(uuid, uuid) to authenticated;

-- Explicit adds / opt back in: refuse with a reason.
create or replace function public.apply_element_opt_in(p_element_id uuid, p_user_id uuid, p_opted_in boolean, p_allow_insert boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid[] := public.element_scope_group(p_element_id);
  v_full text;
begin
  if exists (select 1 from public.trip_elements where id = any(v_group) and state <> 'open') then
    if array_length(v_group, 1) > 1 then
      raise exception 'part of this bundle is already locked — scope can only change while every element in it is open';
    end if;
    raise exception 'this is already locked — who''s in can only change while it''s open';
  end if;

  if p_opted_in then
    select e.label into v_full
      from public.trip_elements e
      where e.id = any(v_group)
        and not exists (select 1 from public.element_participants ep
                        where ep.element_id = e.id and ep.participant_id = p_user_id and ep.opted_in)
        and public.element_full_without_waitlist(e.id, p_user_id)
      limit 1;
    if v_full is not null then
      raise exception '% is full — this trip doesn''t use waitlists, so someone has to come out first', v_full;
    end if;
  end if;

  if p_opted_in and p_allow_insert then
    insert into public.element_participants (element_id, participant_id, opted_in)
    select g, p_user_id, true from unnest(v_group) as g
    on conflict (element_id, participant_id) do update set opted_in = true;
  else
    update public.element_participants
      set opted_in = p_opted_in
      where element_id = any(v_group) and participant_id = p_user_id;
  end if;

  if not p_opted_in then
    -- Someone who's out shouldn't still steer which option gets locked.
    delete from public.votes v
      using public.element_options o
      where v.option_id = o.id and o.element_id = any(v_group) and v.participant_id = p_user_id;
  end if;
end;
$$;

-- Automatic scoping (joining the trip, new "everyone" elements): a full
-- element is simply skipped when the trip has no waitlists.
create or replace function public.skip_full_element_scope()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.opted_in and public.element_full_without_waitlist(new.element_id, new.participant_id) then
    return null;
  end if;
  return new;
end;
$$;
revoke execute on function public.skip_full_element_scope() from public, anon, authenticated;

drop trigger if exists element_participants_skip_full on public.element_participants;
create trigger element_participants_skip_full
  before insert on public.element_participants
  for each row execute function public.skip_full_element_scope();

-- Spots can't drop below who's already in while waitlists are off.
create or replace function public.guard_spots_without_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_in int;
begin
  if new.spots is not null and new.spots is distinct from old.spots
     and not coalesce((select allow_element_waitlist from public.trips where id = new.trip_id), true) then
    select count(*) into v_in from public.element_participants where element_id = new.id and opted_in;
    if v_in > new.spots then
      raise exception '% people are already in — take some out before setting % spots (this trip doesn''t use waitlists)', v_in, new.spots;
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_spots_without_waitlist() from public, anon, authenticated;

drop trigger if exists trip_elements_guard_spots on public.trip_elements;
create trigger trip_elements_guard_spots
  before update of spots on public.trip_elements
  for each row execute function public.guard_spots_without_waitlist();

-- Trip setting: adds p_allow_element_waitlist (null = leave as is).
drop function if exists public.update_trip_advanced(uuid, integer, boolean, integer, boolean, boolean, boolean, boolean);
create function public.update_trip_advanced(
  p_trip_id uuid,
  p_voting_deadline_days integer,
  p_view_all_participants boolean,
  p_deadline_alert_hours integer,
  p_show_voters boolean default null,
  p_allow_checkout_cushion boolean default null,
  p_notify_price_drift boolean default null,
  p_view_element_participants boolean default null,
  p_allow_element_waitlist boolean default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_over int;
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
  if p_allow_element_waitlist = false then
    select count(*) into v_over
      from public.trip_elements e
      where e.trip_id = p_trip_id and e.state = 'open'
        and public.element_spots(e.id) is not null
        and (select count(*) from public.element_participants ep where ep.element_id = e.id and ep.opted_in)
            > public.element_spots(e.id);
    if v_over > 0 then
      raise exception '% element(s) already have more people in than spots — take people out first, then turn waitlists off', v_over;
    end if;
  end if;
  update public.trips
    set voting_deadline_days = p_voting_deadline_days,
        view_all_participants = coalesce(p_view_all_participants, true),
        deadline_alert_hours = p_deadline_alert_hours,
        show_voters = coalesce(p_show_voters, show_voters),
        allow_checkout_cushion = coalesce(p_allow_checkout_cushion, allow_checkout_cushion),
        notify_price_drift = coalesce(p_notify_price_drift, notify_price_drift),
        view_element_participants = coalesce(p_view_element_participants, view_element_participants),
        allow_element_waitlist = coalesce(p_allow_element_waitlist, allow_element_waitlist)
    where id = p_trip_id;
end;
$$;
revoke execute on function public.update_trip_advanced(uuid, integer, boolean, integer, boolean, boolean, boolean, boolean, boolean) from public, anon;
grant execute on function public.update_trip_advanced(uuid, integer, boolean, integer, boolean, boolean, boolean, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
