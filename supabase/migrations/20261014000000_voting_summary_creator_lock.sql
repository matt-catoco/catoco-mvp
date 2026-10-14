-- ============================================================================
-- Voting restyle (founder, 2026-10-14).
--
-- 1. lock_element: the element's creator can lock it whenever the trip lets
--    participants add their own elements ("it's their element"). Replaces
--    the old rule (only a participant's own SUBGROUP element, and only when
--    sub-groups were allowed). Organizers/co-organizers unchanged.
-- 2. get_element_vote_summary: counts only — never who voted for what
--    (votes stay private: RLS shows each person only their own). Per option:
--    how many people ranked it at all and how many ranked it first; plus how
--    many have voted and how many can vote (opted-in element participants).
-- 3. trips.show_voters (founder, 2026-10-14): a trip advanced setting, off by
--    default. When on, the summary also returns each option's voters as
--    INITIALS of their display names (never real names or emails).
-- ============================================================================

alter table public.trips add column if not exists show_voters boolean not null default false;

-- Advanced settings save gains p_show_voters (null = leave as is). New
-- argument list, so drop the old signature first.
drop function if exists public.update_trip_advanced(uuid, integer, boolean, integer);
create function public.update_trip_advanced(
  p_trip_id uuid,
  p_voting_deadline_days integer,
  p_view_all_participants boolean,
  p_deadline_alert_hours integer,
  p_show_voters boolean default null
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
        show_voters = coalesce(p_show_voters, show_voters)
    where id = p_trip_id;
end;
$$;
revoke execute on function public.update_trip_advanced(uuid, integer, boolean, integer, boolean) from public, anon;
grant execute on function public.update_trip_advanced(uuid, integer, boolean, integer, boolean) to authenticated;

-- "Matt Savit" -> "MS", "jordan" -> "JO"; nothing usable -> "?".
create or replace function public.display_initials(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  with w as (select regexp_split_to_array(trim(coalesce(p_name, '')), '\s+') as parts)
  select case
    when coalesce(trim(p_name), '') = '' then '?'
    when array_length(parts, 1) >= 2 then upper(left(parts[1], 1) || left(parts[array_length(parts, 1)], 1))
    else upper(left(trim(p_name), 2))
  end
  from w;
$$;

create or replace function public.lock_element(p_element_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_state text;
  v_type text;
  v_created_by uuid;
  v_is_organizer boolean;
  v_allow_elements boolean;
begin
  select e.trip_id, e.state, e.type, e.created_by, t.allow_participant_elements
    into v_trip_id, v_state, v_type, v_created_by, v_allow_elements
    from public.trip_elements e join public.trips t on t.id = e.trip_id
    where e.id = p_element_id;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  v_is_organizer := public.is_trip_organizer(v_trip_id);
  if not (
    v_is_organizer
    or (coalesce(v_allow_elements, false) and v_created_by = auth.uid())
  ) then
    raise exception 'only the organizer, a co-organizer or whoever added this can lock it in';
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
        voting_deadline = null,
        locked_via = case when v_is_organizer then 'organizer' else 'creator' end
    where id = p_element_id;

  perform public.create_funding_request_for_element(p_element_id);
  if v_type = 'dates' then
    perform public.backfill_funding_for_dates(v_trip_id);
  end if;
end;
$$;

create or replace function public.get_element_vote_summary(p_element_id uuid)
returns table (option_id uuid, votes int, first_choice int, voters int, eligible int, voter_initials text[])
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_element_scoped(p_element_id) then
    raise exception 'not a member of this element';
  end if;
  return query
  with opts as (
    select eo.id from public.element_options eo where eo.element_id = p_element_id
  ),
  v as (
    select vt.option_id, vt.participant_id, vt.rank from public.votes vt where vt.option_id in (select id from opts)
  )
  select o.id,
    (select count(distinct v.participant_id) from v where v.option_id = o.id)::int,
    (select count(*) from v where v.option_id = o.id and v.rank = 1)::int,
    (select count(distinct v.participant_id) from v)::int,
    (select count(*) from public.element_participants ep where ep.element_id = p_element_id and ep.opted_in = true)::int,
    -- Only when the trip shows voters; initials only, never names or emails.
    case when (select t.show_voters from public.trips t join public.trip_elements e on e.trip_id = t.id where e.id = p_element_id)
      then (select array_agg(public.display_initials(pr.display_name) order by v.rank, pr.display_name)
              from v left join public.profiles pr on pr.id = v.participant_id
             where v.option_id = o.id)
    end
  from opts o;
end;
$$;
revoke execute on function public.get_element_vote_summary(uuid) from public, anon;
grant execute on function public.get_element_vote_summary(uuid) to authenticated;

notify pgrst, 'reload schema';
