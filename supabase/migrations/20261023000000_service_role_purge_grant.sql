-- The daily job (app/api/cron/notifications, service role) deletes traveler
-- details 90 days after a trip ends. 20261010000000 revoked the function from
-- public/anon/authenticated but never granted it to service_role, so on
-- production (where new functions get no default grants) it failed every
-- day with "permission denied". Staging hid this: its default privileges
-- granted service_role automatically. Founder, 2026-10-23.
grant execute on function public.purge_expired_traveler_details(int) to service_role;
