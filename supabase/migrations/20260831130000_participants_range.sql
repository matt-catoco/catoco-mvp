-- Flow #2 update, batch 2: Participants (locked) as a range + invite links
--
-- Participants value shape becomes {min, max, invited} (min/max nullable,
-- invited reserved/unused — the invite mechanism is a generic copy/paste
-- link, not per-person tracked sends). Locking a range does not require
-- inviting anyone yet; invites are a separate, later action.
--
-- element_participants goes from schema-only/inert to active: it's the
-- opt-in table a joining participant gets a row in, via join_trip() below.

-- ---- trip_elements: track whether invites have gone out --------------------
-- Only meaningful for type='participants'; a plain boolean rather than folding
-- into `status`, since "invites sent" doesn't fit the add/vote/settled/...
-- lifecycle and needs to be set by an explicit organizer action, not derived.
alter table public.trip_elements
  add column if not exists invites_sent boolean not null default false;

-- ---- element_participants: activate RLS (was schema-only/inert) -----------
drop policy if exists "Users manage their own participation" on public.element_participants;
create policy "Users manage their own participation"
  on public.element_participants for all
  to authenticated
  using (participant_id = auth.uid())
  with check (participant_id = auth.uid());

drop policy if exists "Organizer can view trip participation" on public.element_participants;
create policy "Organizer can view trip participation"
  on public.element_participants for select
  to authenticated
  using (exists (
    select 1 from public.trip_elements e
    join public.trips t on t.id = e.trip_id
    where e.id = element_participants.element_id and t.organizer_id = auth.uid()
  ));

grant select, insert, update, delete on public.element_participants to authenticated;

-- ---- option value validation: participants is now {min, max, invited} -----
create or replace function public.validate_option_value(p_type text, p_value jsonb)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception 'option value for % must be an object', p_type;
  end if;

  if p_type = 'dates' then
    if coalesce(p_value->>'start_date', '') = '' then
      raise exception 'dates needs a start_date';
    end if;
    if p_value ? 'end_date' and coalesce(p_value->>'end_date', '') <> '' then
      if (p_value->>'end_date')::date < (p_value->>'start_date')::date then
        raise exception 'dates end_date is before start_date';
      end if;
    end if;
    if p_value ? 'duration_nights' and jsonb_typeof(p_value->'duration_nights') <> 'null' then
      if jsonb_typeof(p_value->'duration_nights') <> 'number'
         or (p_value->>'duration_nights')::numeric <= 0 then
        raise exception 'duration_nights must be a positive number';
      end if;
    end if;
    if p_value ? 'flexibility_days' and jsonb_typeof(p_value->'flexibility_days') <> 'null' then
      if (p_value->>'flexibility_days')::int not in (0, 1, 2, 3) then
        raise exception 'flexibility_days must be 0, 1, 2, or 3';
      end if;
    end if;

  elsif p_type = 'destination' then
    if coalesce(btrim(p_value->>'name'), '') = '' then
      raise exception 'destination needs a name';
    end if;

  elsif p_type = 'budget' then
    if coalesce(btrim(p_value->>'currency'), '') = '' then
      raise exception 'budget needs a currency';
    end if;
    if coalesce(p_value->>'mode', 'single') = 'range' then
      if jsonb_typeof(p_value->'min') <> 'number' or (p_value->>'min')::numeric <= 0 then
        raise exception 'budget range needs a positive minimum';
      end if;
      if jsonb_typeof(p_value->'max') <> 'number' or (p_value->>'max')::numeric <= 0 then
        raise exception 'budget range needs a positive maximum';
      end if;
      if (p_value->>'max')::numeric < (p_value->>'min')::numeric then
        raise exception 'budget maximum is below the minimum';
      end if;
    else
      if jsonb_typeof(p_value->'amount') <> 'number' or (p_value->>'amount')::numeric <= 0 then
        raise exception 'budget needs a positive amount';
      end if;
    end if;

  elsif p_type = 'participants' then
    if not (p_value ? 'min' and jsonb_typeof(p_value->'min') <> 'null')
       and not (p_value ? 'max' and jsonb_typeof(p_value->'max') <> 'null') then
      raise exception 'participants needs a minimum or maximum group size';
    end if;
    if p_value ? 'min' and jsonb_typeof(p_value->'min') <> 'null' then
      if jsonb_typeof(p_value->'min') <> 'number'
         or (p_value->>'min')::numeric <= 0
         or (p_value->>'min')::numeric <> floor((p_value->>'min')::numeric) then
        raise exception 'participants minimum must be a positive whole number';
      end if;
    end if;
    if p_value ? 'max' and jsonb_typeof(p_value->'max') <> 'null' then
      if jsonb_typeof(p_value->'max') <> 'number'
         or (p_value->>'max')::numeric <= 0
         or (p_value->>'max')::numeric <> floor((p_value->>'max')::numeric) then
        raise exception 'participants maximum must be a positive whole number';
      end if;
    end if;
    if p_value ? 'min' and p_value ? 'max'
       and jsonb_typeof(p_value->'min') <> 'null' and jsonb_typeof(p_value->'max') <> 'null' then
      if (p_value->>'max')::numeric < (p_value->>'min')::numeric then
        raise exception 'participants maximum is below the minimum';
      end if;
    end if;

  elsif p_type = 'travel' then
    if coalesce(btrim(p_value->>'mode'), '') = '' then
      raise exception 'travel needs a mode';
    end if;

  elsif p_type in ('accommodation', 'experience', 'dining') then
    if coalesce(btrim(p_value->>'name'), '') = '' then
      raise exception '% needs a name', p_type;
    end if;

  else
    raise exception 'unknown element type: %', p_type;
  end if;

  if p_type in ('travel', 'accommodation', 'experience', 'dining')
     and p_value ? 'cost'
     and jsonb_typeof(p_value->'cost') <> 'null' then
    if jsonb_typeof(p_value->'cost') <> 'number' or (p_value->>'cost')::numeric < 0 then
      raise exception '% cost must be a number of 0 or more', p_type;
    end if;
  end if;
end;
$$;

-- ---- join_trip: records a participant's opt-in without broadening RLS -----
-- Runs as owner (security definer) so a non-organizer visitor can be looked
-- up and opted in, without granting general SELECT on trips/trip_elements to
-- every authenticated user. Silently no-ops for the organizer themselves and
-- for trips with no locked/open participants element yet.
create or replace function public.join_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
  v_element_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    return; -- trip doesn't exist; nothing to do
  end if;
  if v_organizer_id = v_uid then
    return; -- the organizer isn't a "participant" in the headcount sense
  end if;

  select id into v_element_id
    from public.trip_elements
    where trip_id = p_trip_id and type = 'participants'
    limit 1;

  if v_element_id is null then
    return; -- no participants element configured on this trip
  end if;

  insert into public.element_participants (element_id, participant_id, opted_in)
  values (v_element_id, v_uid, true)
  on conflict (element_id, participant_id) do update set opted_in = true;
end;
$$;

revoke all on function public.join_trip(uuid) from public;
grant execute on function public.join_trip(uuid) to authenticated;
