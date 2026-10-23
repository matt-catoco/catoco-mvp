-- New functions are locked until a migration grants them (founder, 2026-10-23).
-- Production already worked this way; staging's default privileges granted
-- every new function to authenticated and service_role automatically, which
-- hid missing grants until they reached production. Every migration that adds
-- or replaces a function must grant it to the roles that call it.
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role;
