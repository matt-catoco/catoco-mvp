-- ============================================================================
-- Invite by email + DB-backed beta allowlist (founder, 2026-10-11).
-- Replaces lib/allowlist.ts's hardcoded ALLOWED_EMAILS Set; sending an
-- invite from Participants (organizer/co-organizer only) auto-grants the
-- invitee beta access.
-- ============================================================================

-- beta_allowlist: replaces the hardcoded ALLOWED_EMAILS Set in lib/allowlist.ts.
create table if not exists public.beta_allowlist (
  email text primary key,
  invited_by uuid references auth.users(id) on delete set null,
  trip_id uuid references public.trips(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.beta_allowlist enable row level security;
-- No policies — every read/write goes through the RPCs below.

-- Seed: lib/allowlist.ts's ALLOWED_EMAILS verbatim (as of 2026-10-11),
-- lowercased, so nobody loses access on cutover.
insert into public.beta_allowlist (email) values
  ('mksavit@gmail.com'), ('matt@catoco.co'), ('hello@catoco.co'),
  ('matt+t1@catoco.co'), ('matt+t2@catoco.co'), ('matt+t3@catoco.co'),
  ('matt+t4@catoco.co'), ('matt+t5@catoco.co'), ('matt+t6@catoco.co'),
  ('matt+t7@catoco.co'),
  ('moriah.jacobs1@gmail.com'), ('dmorando1@icloud.com'), ('reidhm@gmail.com'),
  ('ajacobs726@gmail.com'), ('perks.hilary@gmail.com'), ('yono38@gmail.com'),
  ('gpolinger@gmail.com'), ('julietrmullins@gmail.com'),
  ('kimberlyrosecallison@gmail.com'), ('toddneale13@gmail.com'),
  ('cpapish@gmail.com'), ('staleyblake@gmail.com'), ('bowman390@yahoo.com')
on conflict (email) do nothing;

-- trip_email_invites: per-trip invite tracking, for resend + "who did I invite".
create table if not exists public.trip_email_invites (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  email text not null,
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  last_sent_at timestamptz not null default now(),
  send_count int not null default 1,
  unique (trip_id, email)
);
alter table public.trip_email_invites enable row level security;

drop policy if exists "organizers read trip invites" on public.trip_email_invites;
create policy "organizers read trip invites" on public.trip_email_invites
  for select to authenticated using (public.is_trip_organizer(trip_id));

-- Pre-auth check (sign-in flow runs before the user is authenticated).
create or replace function public.is_email_allowlisted(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.beta_allowlist where email = lower(trim(p_email))
  );
$$;
grant execute on function public.is_email_allowlisted(text) to anon, authenticated;

-- Organizer/co-organizer sends (or resends) an invite. First grant wins on
-- beta_allowlist (on conflict do nothing); trip_email_invites always gets
-- its own upserted row per trip.
create or replace function public.send_trip_invite(p_trip_id uuid, p_email text)
returns table (already_invited boolean, send_count int)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_email text := lower(trim(p_email));
  v_existing boolean;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can send invites';
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'that doesn''t look like a valid email address';
  end if;

  select exists (
    select 1 from public.trip_email_invites i
    where i.trip_id = p_trip_id and i.email = v_email
  ) into v_existing;

  insert into public.beta_allowlist (email, invited_by, trip_id)
  values (v_email, auth.uid(), p_trip_id)
  on conflict (email) do nothing;

  insert into public.trip_email_invites as i (trip_id, email, invited_by)
  values (p_trip_id, v_email, auth.uid())
  on conflict (trip_id, email) do update
    set last_sent_at = now(), send_count = i.send_count + 1
  returning i.send_count into v_count;

  already_invited := v_existing;
  send_count := v_count;
  return next;
end;
$$;
revoke execute on function public.send_trip_invite(uuid, text) from public, anon;
grant execute on function public.send_trip_invite(uuid, text) to authenticated;

notify pgrst, 'reload schema';
