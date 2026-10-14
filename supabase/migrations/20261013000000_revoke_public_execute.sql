-- ============================================================================
-- Security audit remediation (2026-10-13).
--
-- 1. Close anon-callable functions. Postgres grants EXECUTE to PUBLIC on
--    every new function, and Supabase's default privileges add explicit
--    anon/authenticated/service_role grants on top — so every function in
--    public was callable without signing in. Revoking from PUBLIC and anon
--    closes that. authenticated and service_role keep their own explicit
--    grants, so nothing a signed-in user (or the server) can do today
--    changes — verified with a before/after privilege snapshot on staging.
--    Deliberately NOT re-running old `grant ... to authenticated` lines from
--    earlier migrations: several functions were later locked down to
--    service_role only, and replaying the old grants would reopen them.
-- 2. Future functions: stop the default anon grant at the source.
-- 3. The only intentional pre-auth exception: is_email_allowlisted (sign-in
--    runs before there's a session). trip_join_status is only called after
--    sign-in (app/trips/[tripId]/page.tsx), so it doesn't need anon.
-- 4. get_user_email / get_user_emails: scoped to callers who share a trip
--    with the target (as organizer or participant), plus the server's
--    service_role (cron, inbound email, server-side notifications run with
--    no user session).
-- 5. search_path pinned on the four functions the linter flagged.
-- ============================================================================

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    execute format('revoke execute on function %s from public, anon;', r.sig);
  end loop;
end $$;

alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

grant execute on function public.is_email_allowlisted(text) to anon;

-- Do two users share a trip (each as organizer or participant)?
create or replace function public.users_share_trip(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips t
    where (t.organizer_id = p_a
           or exists (select 1 from public.trip_participants tp where tp.trip_id = t.id and tp.user_id = p_a))
      and (t.organizer_id = p_b
           or exists (select 1 from public.trip_participants tp where tp.trip_id = t.id and tp.user_id = p_b))
  );
$$;
revoke execute on function public.users_share_trip(uuid, uuid) from public, anon, authenticated;

create or replace function public.get_user_email(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select u.email::text from auth.users u
  where u.id = p_user_id
    and (
      coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
      or p_user_id = auth.uid()
      or (auth.uid() is not null and public.users_share_trip(auth.uid(), p_user_id))
    );
$$;

create or replace function public.get_user_emails(p_user_ids uuid[])
returns table(user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select u.id as user_id, u.email::text from auth.users u
  where u.id = any(p_user_ids)
    and (
      coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
      or u.id = auth.uid()
      or (auth.uid() is not null and public.users_share_trip(auth.uid(), u.id))
    );
$$;
revoke execute on function public.get_user_email(uuid) from public, anon;
revoke execute on function public.get_user_emails(uuid[]) from public, anon;
grant execute on function public.get_user_email(uuid) to authenticated, service_role;
grant execute on function public.get_user_emails(uuid[]) to authenticated, service_role;

alter function public.element_subtype_label(text, jsonb) set search_path = public;
alter function public.element_label_is_auto(text, text) set search_path = public;
-- Ad-hoc staging seed helpers: not defined in any migration, so only pin
-- them where they exist.
do $$
begin
  if to_regprocedure('public.seed_mock_trip_batch(uuid, text[])') is not null then
    execute 'alter function public.seed_mock_trip_batch(uuid, text[]) set search_path = public';
  end if;
  if to_regprocedure('public.cross_add_and_vary_capacity(uuid, uuid, uuid)') is not null then
    execute 'alter function public.cross_add_and_vary_capacity(uuid, uuid, uuid) set search_path = public';
  end if;
end $$;

notify pgrst, 'reload schema';
