-- ============================================================================
-- Trip settings → Default timing (founder, 2026-10-04).
--
-- Two defaults, nothing else:
--   * submission_deadline_days — pre-fills an open element's submission
--     deadline (N days after it's added). A default only: the add-element
--     form still shows the date and it stays editable per element.
--   * funding_deadline_days — unchanged (20261002000000, default 14).
-- The funding grace window is always 24 hours again — not a setting — so
-- trips.funding_grace_hours is dropped and the cron goes back to its
-- constant.
--
-- update_trip_permissions() changes its argument list, so the old 5-arg
-- version is dropped first (two overloads are ambiguous for PostgREST).
-- ============================================================================

alter table public.trips
  add column if not exists submission_deadline_days int not null default 7;

alter table public.trips drop constraint if exists trips_submission_deadline_days_check;
alter table public.trips add constraint trips_submission_deadline_days_check
  check (submission_deadline_days between 1 and 60);

alter table public.trips drop constraint if exists trips_funding_grace_hours_check;
alter table public.trips drop column if exists funding_grace_hours;

drop function if exists public.update_trip_permissions(uuid, boolean, boolean, int, int);

create or replace function public.update_trip_permissions(
  p_trip_id uuid,
  p_allow_participant_elements boolean,
  p_allow_participant_subgroups boolean,
  p_submission_deadline_days int,
  p_funding_deadline_days int
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
  if p_submission_deadline_days is null or p_submission_deadline_days not between 1 and 60 then
    raise exception 'submission deadline must be between 1 and 60 days';
  end if;
  if p_funding_deadline_days is null or p_funding_deadline_days not between 1 and 60 then
    raise exception 'funding deadline must be between 1 and 60 days';
  end if;
  update public.trips
    set allow_participant_elements = coalesce(p_allow_participant_elements, false),
        allow_participant_subgroups = coalesce(p_allow_participant_subgroups, false),
        submission_deadline_days = p_submission_deadline_days,
        funding_deadline_days = p_funding_deadline_days
    where id = p_trip_id;
end;
$$;
grant execute on function public.update_trip_permissions(uuid, boolean, boolean, int, int) to authenticated;

notify pgrst, 'reload schema';
