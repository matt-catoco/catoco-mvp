-- Flow #2 update, batch 1:
--   1. dates value shape: start_date + optional duration_nights/end_date/flexibility_days
--   2. trip_elements.deadline -> options_deadline + voting_deadline
--   3. budget value shape: single amount OR a min/max range
--
-- Editability note (item 2): no schema change needed for "deadlines editable
-- any time up to lock" — the existing "Organizer manages own trip elements"
-- policy already grants UPDATE, and nothing here adds a constraint that would
-- freeze these columns after creation.

-- ---- deadlines: split into two columns ------------------------------------
alter table public.trip_elements drop constraint if exists trip_elements_deadline_only_open;

alter table public.trip_elements
  add column if not exists options_deadline timestamptz,
  add column if not exists voting_deadline timestamptz;

-- Old single `deadline` was presented to organizers as "voting deadline" —
-- carry existing values over as the closer semantic match.
update public.trip_elements
  set voting_deadline = deadline
  where deadline is not null and voting_deadline is null;

alter table public.trip_elements drop column if exists deadline;

alter table public.trip_elements
  add constraint trip_elements_deadlines_only_open
    check (state = 'open' or (options_deadline is null and voting_deadline is null));

-- ---- option value validation: new dates + budget shapes -------------------
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
    if jsonb_typeof(p_value->'count') <> 'number'
       or (p_value->>'count')::numeric <= 0
       or (p_value->>'count')::numeric <> floor((p_value->>'count')::numeric) then
      raise exception 'participants needs a positive whole number';
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

  -- Optional cost on cost-bearing option types (unchanged from prior batch).
  if p_type in ('travel', 'accommodation', 'experience', 'dining')
     and p_value ? 'cost'
     and jsonb_typeof(p_value->'cost') <> 'null' then
    if jsonb_typeof(p_value->'cost') <> 'number' or (p_value->>'cost')::numeric < 0 then
      raise exception '% cost must be a number of 0 or more', p_type;
    end if;
  end if;
end;
$$;

-- ---- create_trip: read options_deadline/voting_deadline instead of deadline
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
  v_opt_count int;
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

    for v_opt in select value from jsonb_array_elements(v_opts)
    loop
      perform public.validate_option_value(v_type, v_opt->'value');
      insert into public.element_options (element_id, value, source, proposed_by)
      values (v_el_id, v_opt->'value', 'user_proposed', v_uid);
    end loop;
  end loop;

  return v_trip_id;
end;
$$;
