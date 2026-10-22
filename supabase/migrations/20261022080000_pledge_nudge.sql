-- Pledge-aware status and nudges (founder, 2026-10-22). Payment requests go
-- out only once everyone has pledged (no "ask everyone to pay now"), but the
-- organizer's Nudge stays:
--   * a live pledge counts as "committed" (card alerts, nudge targets);
--   * pledge requests nudge by stage: before payments open, those who
--     haven't pledged ('pledge'); once open, anyone who hasn't pledged or
--     still owes and hasn't said they've paid ('pay').

create or replace function public.element_participant_status(p_element_id uuid)
returns table (participant_id uuid, opted_in boolean, submitted boolean, voted boolean, committed boolean)
language sql
stable
security definer
set search_path = public
as $$
  select ep.participant_id, ep.opted_in,
    exists (select 1 from public.element_options o
            where o.element_id = p_element_id and o.proposed_by = ep.participant_id),
    exists (select 1 from public.votes v join public.element_options o on o.id = v.option_id
            where o.element_id = p_element_id and v.participant_id = ep.participant_id),
    exists (select 1 from public.funding_request_elements fre
            join public.funding_requests fr on fr.id = fre.funding_request_id and fr.status <> 'superseded'
            join public.funding_mandates m on m.funding_request_id = fr.id
            where fre.element_id = p_element_id and m.participant_id = ep.participant_id
              and m.status in ('active', 'charging', 'held', 'charge_succeeded'))
    or exists (select 1 from public.funding_request_elements fre
               join public.funding_requests fr on fr.id = fre.funding_request_id and fr.status <> 'superseded'
               join public.funding_contributions c on c.funding_request_id = fr.id
               where fre.element_id = p_element_id and c.contributor_id = ep.participant_id and c.refunded_at is null)
    or exists (select 1 from public.funding_request_elements fre
               join public.funding_requests fr on fr.id = fre.funding_request_id and fr.status <> 'superseded'
               join public.funding_pledges pl on pl.funding_request_id = fr.id
               where fre.element_id = p_element_id and pl.participant_id = ep.participant_id and pl.status <> 'withdrawn')
  from public.element_participants ep
  where ep.element_id = p_element_id;
$$;

create or replace function public.get_element_nudge_targets(p_element_id uuid)
returns table (participant_id uuid, display_name text, phase text, deadline timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_trip_id uuid;
  v_phase text;
  v_deadline timestamptz;
  v_fr record;
begin
  select trip_id into v_trip_id from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can nudge';
  end if;
  select ph.phase, ph.deadline into v_phase, v_deadline from public.element_phase(p_element_id) ph;
  if v_phase not in ('submission', 'voting', 'funding') then
    return;
  end if;

  if v_phase = 'funding' then
    select fr.id, fr.collection_mode, fr.pay_window_opened_at, fr.individual_amount into v_fr
      from public.funding_request_elements fre
      join public.funding_requests fr on fr.id = fre.funding_request_id and fr.status = 'collecting'
      where fre.element_id = p_element_id
      limit 1;
    if v_fr.collection_mode = 'peer_pledge' then
      return query
        select ep.participant_id, p.display_name,
               case when pl.id is null then 'pledge' else 'pay' end,
               v_deadline
        from public.element_participants ep
        left join public.profiles p on p.id = ep.participant_id
        left join public.funding_pledges pl
          on pl.funding_request_id = v_fr.id and pl.participant_id = ep.participant_id and pl.status <> 'withdrawn'
        where ep.element_id = p_element_id and ep.opted_in
          and ep.participant_id <> auth.uid()
          and not public.funding_request_spots_full(v_fr.id, ep.participant_id)
          and (
            pl.id is null
            or (v_fr.pay_window_opened_at is not null and pl.status = 'pledged'
                and public.pledge_paid(v_fr.id, ep.participant_id) < v_fr.individual_amount)
          );
      return;
    end if;
  end if;

  return query
    select s.participant_id, p.display_name, v_phase, v_deadline
    from public.element_participant_status(p_element_id) s
    left join public.profiles p on p.id = s.participant_id
    where s.opted_in
      and s.participant_id <> auth.uid()
      and not (case v_phase when 'submission' then s.submitted when 'voting' then s.voted else s.committed end)
      and not (v_phase = 'funding' and exists (
        select 1 from public.funding_request_elements fre
        join public.funding_requests fr on fr.id = fre.funding_request_id and fr.status = 'collecting'
        where fre.element_id = p_element_id
          and public.funding_request_spots_full(fr.id, s.participant_id)));
end;
$$;
