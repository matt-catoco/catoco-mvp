-- ============================================================================
-- Staging review B3 (founder, 2026-10-09): the lock-time reference snapshot.
--
-- Each option already carries its own `value.details` (fetched at
-- submission — vendor API or the booking page's schema.org data) so the
-- group can compare them at the vote. When an element locks, the winner's
-- details plus the element-level photo are copied here once, so funding
-- and the trip itself have one stable reference even if the option is
-- later edited or the vendor listing changes.
--
-- Shape: { details: OptionDetails | null, image: { url, source,
-- credit_name?, credit_url? } | null, enriched_at }. Written only by the
-- server (service role) — the element page fills it on first view after
-- lock; "Change photo" replaces `image` after its own permission check.
-- Readable by anyone who can already read the element.
-- ============================================================================

alter table public.trip_elements
  add column if not exists enriched_details jsonb;

notify pgrst, 'reload schema';
