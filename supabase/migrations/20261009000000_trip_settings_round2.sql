-- ============================================================================
-- Staging review round (founder, 2026-10-09) — trip settings.
--
--  A2  Price cushion: no upper bound (500%+ can be legitimate; the UI warns
--      softly above 300%). Non-negative is the only rule.
--  #2  Voting-deadline default: trips.voting_deadline_days pre-fills a new
--      element's voting deadline (null = no default). Submission already has
--      trips.submission_deadline_days.
--  A3  "View all participants" (default on). Off: participants see only
--      their own name and the organizer's; everyone else is listed without a
--      name or role. Enforced in get_trip_roster() — the only path other
--      people's names reach a participant (profiles RLS is own-row only).
--      Organizers/co-organizers always see everyone.
--  C1  Deadline-alert threshold for the element card clock: 12/24/48h
--      (default 24), also meant for the future automatic reminders.
-- ============================================================================

alter table public.trips drop constraint if exists trips_price_cushion_check;
alter table public.trips add constraint trips_price_cushion_check check (
  price_cushion_kind in ('percent', 'amount') and price_cushion_value >= 0);

alter table public.trip_elements drop constraint if exists trip_elements_cushion_check;
alter table public.trip_elements add constraint trip_elements_cushion_check check (
  (cushion_kind is null and cushion_value is null)
  or (cushion_kind in ('percent', 'amount') and cushion_value >= 0));

create or replace function public.update_trip_cushion(p_trip_id uuid, p_kind text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can change trip settings';
  end if;
  if p_kind not in ('percent', 'amount') or p_value is null or p_value < 0 then
    raise exception 'the price cushion can''t be negative';
  end if;
  update public.trips set price_cushion_kind = p_kind, price_cushion_value = p_value where id = p_trip_id;
end;
$$;

create or replace function public.set_element_cushion(p_element_id uuid, p_kind text, p_value numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can set the price cushion';
  end if;
  if p_kind is not null and (p_kind not in ('percent', 'amount') or p_value is null or p_value < 0) then
    raise exception 'the price cushion can''t be negative';
  end if;
  if exists (
    select 1 from public.funding_request_elements fre
    join public.funding_mandates m on m.funding_request_id = fre.funding_request_id
    where fre.element_id = p_element_id and m.status in ('active', 'charging', 'held', 'awaiting_retry', 'charge_succeeded')
  ) then
    raise exception 'people have already authorized against the current cushion — it can''t change now';
  end if;
  update public.trip_elements
    set cushion_kind = p_kind, cushion_value = case when p_kind is null then null else p_value end
    where id = p_element_id;
end;
$$;

alter table public.trips
  add column if not exists voting_deadline_days int,
  add column if not exists view_all_participants boolean not null default true,
  add column if not exists deadline_alert_hours int not null default 24;
alter table public.trips drop constraint if exists trips_voting_deadline_days_check;
alter table public.trips add constraint trips_voting_deadline_days_check
  check (voting_deadline_days is null or voting_deadline_days between 1 and 90);
alter table public.trips drop constraint if exists trips_deadline_alert_hours_check;
alter table public.trips add constraint trips_deadline_alert_hours_check
  check (deadline_alert_hours in (12, 24, 48));

create or replace function public.update_trip_advanced(
  p_trip_id uuid, p_voting_deadline_days int, p_view_all_participants boolean, p_deadline_alert_hours int
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
        deadline_alert_hours = p_deadline_alert_hours
    where id = p_trip_id;
end;
$$;
grant execute on function public.update_trip_advanced(uuid, int, boolean, int) to authenticated;

-- A3: the roster, name-masked for participants when view-all is off.
create or replace function public.get_trip_roster(p_trip_id uuid)
returns table(user_id uuid, display_name text, is_organizer boolean, role text, joined_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  with v as (
    select public.is_trip_organizer(p_trip_id)
           or coalesce((select t.view_all_participants from public.trips t where t.id = p_trip_id), true) as see_all
  )
  select t.organizer_id as user_id, p.display_name, true as is_organizer,
         'organizer'::text as role, null::timestamptz as joined_at
  from public.trips t
  left join public.profiles p on p.id = t.organizer_id
  where t.id = p_trip_id and public.is_trip_member(p_trip_id)
  union all
  select tp.user_id,
         case when (select see_all from v) or tp.user_id = auth.uid() then p.display_name end,
         false,
         case when (select see_all from v) or tp.user_id = auth.uid() then tp.role else 'participant' end,
         tp.joined_at
  from public.trip_participants tp
  left join public.profiles p on p.id = tp.user_id
  where tp.trip_id = p_trip_id and public.is_trip_member(p_trip_id)
  order by joined_at nulls first;
$$;
grant execute on function public.get_trip_roster(uuid) to authenticated;

notify pgrst, 'reload schema';
