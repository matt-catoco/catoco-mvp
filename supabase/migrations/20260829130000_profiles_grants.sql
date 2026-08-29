-- New Supabase projects don't auto-grant table privileges to the built-in
-- roles, so RLS policies on `profiles` had nothing to narrow — client reads
-- and the onboarding update failed with "permission denied for table profiles".
--
-- Grant only what the client needs; INSERT stays ungranted because profiles
-- rows are created solely by the handle_new_user() trigger (security definer).
grant select, update on public.profiles to authenticated;
