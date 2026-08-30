-- ============================================================================
-- Flow #2 — New Trip Creation (periodic-table element model)
--
-- Promotes the `trips` stub to the real schema and adds the element / option /
-- participant / vote tables. Voting, financing, and external-API integration are
-- out of scope: `votes` and `element_participants` get schema only (RLS on, no
-- policies), and `element_options.external_ref` is reserved but unused.
-- ============================================================================

-- ---- trips: promote the flow-1 stub ----------------------------------------
alter table public.trips
  add column if not exists icon text,
  add column if not exists organizer_id uuid references auth.users(id) on delete cascade,
  add column if not exists status text not null default 'planning';

-- Coarse, provisional trip status. Intentionally NOT a rollup of element
-- lifecycles — transitions come from later flows.
alter table public.trips drop constraint if exists trips_status_check;
alter table public.trips
  add constraint trips_status_check check (status in ('planning', 'financing', 'going'));

alter table public.trips alter column name drop default;

-- The only pre-existing rows are flow-1 test stubs with no organizer. Clear them
-- so organizer_id can be NOT NULL. (profiles.invited_via_trip_id FK is
-- ON DELETE SET NULL, so this just nulls that test reference.)
delete from public.trips where organizer_id is null;
alter table public.trips alter column organizer_id set not null;

create index if not exists trips_organizer_id_idx on public.trips (organizer_id);

drop policy if exists "Organizer manages own trips" on public.trips;
create policy "Organizer manages own trips"
  on public.trips for all
  to authenticated
  using (organizer_id = auth.uid())
  with check (organizer_id = auth.uid());

grant select, insert, update, delete on public.trips to authenticated;

-- ---- trip_elements -------------------------------------------------------------
create table if not exists public.trip_elements (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  category text not null check (category in ('macro', 'micro')),
  type text not null check (type in (
    'dates', 'destination', 'budget', 'participants',
    'travel', 'accommodation', 'experience', 'dining'
  )),
  state text not null check (state in ('locked', 'open')),
  -- Element lifecycle. NULL = open element with nothing proposed yet.
  -- Only 'add' / 'settled' / NULL are reachable from trip creation; the rest are
  -- for later voting / financing / booking tickets.
  status text check (status in (
    'add', 'vote', 'settled', 'collecting', 'funded', 'refunded', 'booked'
  )),
  -- Deadline is meaningful only for open (votable) elements.
  deadline timestamptz,
  created_at timestamptz not null default now(),
  unique (trip_id, type),
  constraint trip_elements_deadline_only_open check (state = 'open' or deadline is null)
);

alter table public.trip_elements enable row level security;
create index if not exists trip_elements_trip_id_idx on public.trip_elements (trip_id);

drop policy if exists "Organizer manages own trip elements" on public.trip_elements;
create policy "Organizer manages own trip elements"
  on public.trip_elements for all
  to authenticated
  using (exists (
    select 1 from public.trips t
    where t.id = trip_elements.trip_id and t.organizer_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.trips t
    where t.id = trip_elements.trip_id and t.organizer_id = auth.uid()
  ));

grant select, insert, update, delete on public.trip_elements to authenticated;

-- ---- element_options --------------------------------------------------------
create table if not exists public.element_options (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references public.trip_elements(id) on delete cascade,
  -- Shape varies by element type; validated by validate_option_value().
  value jsonb not null,
  source text not null default 'user_proposed'
    check (source in ('user_proposed', 'api_sourced')),
  -- Reserved for future travel/lodging/dining API integration. Unused for now.
  external_ref jsonb,
  proposed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.element_options enable row level security;
create index if not exists element_options_element_id_idx on public.element_options (element_id);

drop policy if exists "Organizer manages own element options" on public.element_options;
create policy "Organizer manages own element options"
  on public.element_options for all
  to authenticated
  using (exists (
    select 1 from public.trip_elements e
    join public.trips t on t.id = e.trip_id
    where e.id = element_options.element_id and t.organizer_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.trip_elements e
    join public.trips t on t.id = e.trip_id
    where e.id = element_options.element_id and t.organizer_id = auth.uid()
  ));

grant select, insert, update, delete on public.element_options to authenticated;

-- ---- element_participants (schema only — inert until the voting ticket) -----
create table if not exists public.element_participants (
  element_id uuid not null references public.trip_elements(id) on delete cascade,
  participant_id uuid not null references auth.users(id) on delete cascade,
  opted_in boolean not null default true,
  primary key (element_id, participant_id)
);
alter table public.element_participants enable row level security;
-- No policies, no grants: nothing populates or reads this yet.

-- ---- votes (schema only — voting mechanic undecided) ----------------------
create table if not exists public.votes (
  id uuid primary key default gen_random_uuid(),
  option_id uuid not null references public.element_options(id) on delete cascade,
  participant_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (option_id, participant_id)
);
alter table public.votes enable row level security;
-- No policies, no grants: voting logic is a separate future ticket.

-- ---- option value validation ---------------------------------------------
-- Mirrors lib/trip-elements.ts::validateOptionValue on the server side.
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
    if coalesce(p_value->>'start', '') = '' or coalesce(p_value->>'end', '') = '' then
      raise exception 'dates needs a start and end';
    end if;
    if (p_value->>'end')::date < (p_value->>'start')::date then
      raise exception 'dates end is before start';
    end if;

  elsif p_type = 'destination' then
    if coalesce(btrim(p_value->>'name'), '') = '' then
      raise exception 'destination needs a name';
    end if;

  elsif p_type = 'budget' then
    if jsonb_typeof(p_value->'amount') <> 'number' or (p_value->>'amount')::numeric <= 0 then
      raise exception 'budget needs a positive amount';
    end if;
    if coalesce(btrim(p_value->>'currency'), '') = '' then
      raise exception 'budget needs a currency';
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
end;
$$;

-- ---- atomic trip creation -----------------------------------------------------
-- One transaction: trip + all elements + all seeded options, or nothing.
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
  v_deadline timestamptz;
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
      v_deadline := nullif(v_el->>'deadline', '')::timestamptz;
      v_status := case when v_opt_count >= 1 then 'add' else null end;
    else
      v_deadline := null;
      v_status := 'settled';
    end if;

    insert into public.trip_elements (trip_id, category, type, state, status, deadline)
    values (v_trip_id, v_category, v_type, v_state, v_status, v_deadline)
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

revoke all on function public.create_trip(jsonb) from public;
grant execute on function public.create_trip(jsonb) to authenticated;

-- ---- storage: trip-icons bucket policies --------------------------------------
-- Create the bucket itself in the dashboard (Storage -> New bucket):
--   name "trip-icons", public, 2 MB limit,
--   mime types image/png, image/jpeg, image/webp, image/svg+xml.
-- If these policy statements error with "must be owner of table objects", add the
-- equivalent policies from Storage -> Policies instead (see SETUP.md).
drop policy if exists "trip-icons public read" on storage.objects;
create policy "trip-icons public read"
  on storage.objects for select
  to public
  using (bucket_id = 'trip-icons');

drop policy if exists "trip-icons owner insert" on storage.objects;
create policy "trip-icons owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'trip-icons'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "trip-icons owner update" on storage.objects;
create policy "trip-icons owner update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'trip-icons'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "trip-icons owner delete" on storage.objects;
create policy "trip-icons owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'trip-icons'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
