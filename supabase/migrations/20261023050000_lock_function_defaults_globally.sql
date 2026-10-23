-- 20261023020000 revoked the default EXECUTE grant on new functions per schema,
-- but a schema-level rule can only add to Postgres's global default (PUBLIC may
-- execute every new function), never take it away. So new functions were still
-- open to everyone: the three trigger functions from 20261023040000 showed up
-- with PUBLIC execute. Revoke it at the global level so a new function really
-- is locked until a migration grants it, and lock those three (trigger
-- functions can't be called directly anyway).
alter default privileges for role postgres revoke execute on functions from public;

revoke execute on function public.track_element_locked_at() from public, anon, authenticated, service_role;
revoke execute on function public.track_trip_invites_sent_at() from public, anon, authenticated, service_role;
revoke execute on function public.track_funding_funded_at() from public, anon, authenticated, service_role;
