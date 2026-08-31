-- ============================================================================
-- Flow #3, batch 1 — ranked-vote schema, option submission, link preview
--
-- This is the first migration where anyone besides the organizer gets read
-- access to trip data, and the first new element_options write path besides
-- create_trip(). See the plan for full rationale.
-- ============================================================================

-- ---- votes: add rank (replaces the earlier boolean-pick assumption) -------
-- Schema only — nothing writes here yet, voting logic is a later batch.
alter table public.votes
  add column if not exists rank smallint;
alter table public.votes
  add constraint votes_rank_range check (rank between 1 and 3);
alter table public.votes
  alter column rank set not null;

-- ---- trip_elements: locked_option_id ---------------------------------------
alter table public.trip_elements
  add column if not exists locked_option_id uuid references public.element_options(id) on delete set null;

-- ---- element_options: rename url->booking_link, cost->price; add preview --
-- No existing rows use the old key names (pre-launch), so this is a pure
-- forward-looking shape change — nothing to backfill.
comment on column public.element_options.value is
  'jsonb shape varies by element type. Micro types (travel/accommodation/'
  'experience/dining) use booking_link (renamed from url), price (renamed '
  'from cost), and auto-extracted title/description/thumbnail_url.';

-- ---- validation trigger: applies to every write path, not just create_trip -
create or replace function public.enforce_option_value()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
begin
  select type into v_type from public.trip_elements where id = new.element_id;
  if v_type is null then
    raise exception 'trip_elements row % not found', new.element_id;
  end if;
  perform public.validate_option_value(v_type, new.value);
  return new;
end;
$$;

drop trigger if exists enforce_option_value_trigger on public.element_options;
create trigger enforce_option_value_trigger
  before insert or update of value on public.element_options
  for each row execute function public.enforce_option_value();

-- ---- option value validation: booking_link/price naming, unchanged rules --
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

  -- price (renamed from cost) — optional, non-negative, cost-bearing types only.
  if p_type in ('travel', 'accommodation', 'experience', 'dining')
     and p_value ? 'price'
     and jsonb_typeof(p_value->'price') <> 'null' then
    if jsonb_typeof(p_value->'price') <> 'number' or (p_value->>'price')::numeric < 0 then
      raise exception '% price must be a number of 0 or more', p_type;
    end if;
  end if;
  -- title/description/thumbnail_url are server-populated (link preview), not
  -- user-supplied input — deliberately unvalidated here.
end;
$$;

-- ---- create_trip: locked_option_id, deadline cross-check, drop redundant --
-- validation call (the trigger above now covers every write path uniformly).
create or replace function public.create_trip(payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip_id uuid;
  v_name text := btrim(coalesce(payload->>'name', ''));
  v_icon text := nullif(payload->>'icon', '');
  v_el jsonb;
  v_el_id uuid;
  v_type text;
  v_category text;
  v_state text;
  v_options_deadline timestamptz;
  v_voting_deadline timestamptz;
  v_status text;
  v_opts jsonb;
  v_opt jsonb;
  v_opt_id uuid;
  v_opt_count int;
  v_first_opt_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if v_name = '' then
    raise exception 'trip name is required';
  end if;

  insert into public.trips (name, icon, organizer_id, status)
  values (v_name, v_icon, v_uid, 'planning')
  returning id into v_trip_id;

  for v_el in
    select value from jsonb_array_elements(coalesce(payload->'elements', '[]'::jsonb))
  loop
    v_type := v_el->>'type';
    v_category := v_el->>'category';
    v_state := v_el->>'state';
    v_opts := coalesce(v_el->'options', '[]'::jsonb);
    v_opt_count := jsonb_array_length(v_opts);

    if v_category not in ('macro', 'micro') then
      raise exception 'bad element category: %', v_category;
    end if;
    if v_state not in ('locked', 'open') then
      raise exception 'bad element state: %', v_state;
    end if;
    if v_state = 'locked' and v_opt_count <> 1 then
      raise exception 'locked element % needs exactly one value', v_type;
    end if;

    if v_state = 'open' then
      v_options_deadline := nullif(v_el->>'options_deadline', '')::timestamptz;
      v_voting_deadline := nullif(v_el->>'voting_deadline', '')::timestamptz;
      if v_options_deadline is not null and v_voting_deadline is not null
         and v_options_deadline > v_voting_deadline then
        raise exception '% options_deadline must be on or before voting_deadline', v_type;
      end if;
      v_status := case when v_opt_count >= 1 then 'add' else null end;
    else
      v_options_deadline := null;
      v_voting_deadline := null;
      v_status := 'settled';
    end if;

    insert into public.trip_elements
      (trip_id, category, type, state, status, options_deadline, voting_deadline)
    values
      (v_trip_id, v_category, v_type, v_state, v_status, v_options_deadline, v_voting_deadline)
    returning id into v_el_id;

    v_first_opt_id := null;
    for v_opt in select value from jsonb_array_elements(v_opts)
    loop
      -- validate_option_value() runs via the enforce_option_value_trigger now.
      insert into public.element_options (element_id, value, source, proposed_by)
      values (v_el_id, v_opt->'value', 'user_proposed', v_uid)
      returning id into v_opt_id;
      if v_first_opt_id is null then
        v_first_opt_id := v_opt_id;
      end if;
    end loop;

    if v_state = 'locked' then
      update public.trip_elements set locked_option_id = v_first_opt_id where id = v_el_id;
    end if;
  end loop;

  return v_trip_id;
end;
$$;

-- ---- is_trip_member: shared membership check, used by the policies below --
create or replace function public.is_trip_member(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips t
    where t.id = p_trip_id and t.organizer_id = auth.uid()
  ) or exists (
    select 1
    from public.element_participants ep
    join public.trip_elements pe on pe.id = ep.element_id
    where pe.trip_id = p_trip_id
      and pe.type = 'participants'
      and ep.participant_id = auth.uid()
      and ep.opted_in = true
  );
$$;

grant execute on function public.is_trip_member(uuid) to authenticated;

-- ---- RLS: members can read trip data, and propose options on open elements
-- Additive — the existing organizer "for all" policies on each table are
-- untouched; these are extra policies that OR in alongside them.
drop policy if exists "Trip members can view the trip" on public.trips;
create policy "Trip members can view the trip"
  on public.trips for select
  to authenticated
  using (public.is_trip_member(id));

drop policy if exists "Trip members can view elements" on public.trip_elements;
create policy "Trip members can view elements"
  on public.trip_elements for select
  to authenticated
  using (public.is_trip_member(trip_id));

drop policy if exists "Trip members can view options" on public.element_options;
create policy "Trip members can view options"
  on public.element_options for select
  to authenticated
  using (exists (
    select 1 from public.trip_elements e
    where e.id = element_options.element_id and public.is_trip_member(e.trip_id)
  ));

drop policy if exists "Trip members can propose options on open elements" on public.element_options;
create policy "Trip members can propose options on open elements"
  on public.element_options for insert
  to authenticated
  with check (
    proposed_by = auth.uid()
    and exists (
      select 1 from public.trip_elements e
      where e.id = element_options.element_id
        and e.state = 'open'
        and (e.options_deadline is null or e.options_deadline > now())
        and public.is_trip_member(e.trip_id)
    )
  );

-- grants for the two tables that only ever had organizer-scoped grants before
-- (trips/trip_elements/element_options already had broad grants from earlier
-- migrations; this just confirms element_options insert/select are covered)
grant select, insert on public.element_options to authenticated;
grant select on public.trips to authenticated;
grant select on public.trip_elements to authenticated;
