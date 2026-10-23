-- Signed-in users were blocked from five functions on production ("permission
-- denied"): later migrations replaced them (new signatures) without granting
-- them again. Production gives new functions no default grants; staging's
-- default privileges granted them automatically, which hid it. Founder,
-- 2026-10-23. Each function still checks who may do what itself.
grant execute on function public.create_element(uuid, text, text, jsonb, uuid[], text, timestamptz, timestamptz, jsonb, uuid, uuid, boolean, boolean) to authenticated;
grant execute on function public.update_trip(uuid, text, text, boolean, jsonb) to authenticated;
grant execute on function public.delete_trip(uuid) to authenticated;
grant execute on function public.mark_funding_request_refunded(uuid) to authenticated;
grant execute on function public.funding_request_population_for(uuid) to authenticated;
