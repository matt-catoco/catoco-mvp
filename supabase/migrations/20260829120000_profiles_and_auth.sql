-- Minimal trips stub — real trip system lands in a later ticket.
create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Untitled trip',
  created_at timestamptz not null default now()
);

alter table public.trips enable row level security;
-- Intentionally no policies yet: no client access to trips until the
-- trip-creation ticket defines real rules.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  invited_via_trip_id uuid references public.trips(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- No insert policy: profiles are only ever created by the trigger below
-- (security definer), never directly by the client.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, invited_via_trip_id)
  values (
    new.id,
    nullif(new.raw_user_meta_data ->> 'invited_via_trip_id', '')::uuid
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
