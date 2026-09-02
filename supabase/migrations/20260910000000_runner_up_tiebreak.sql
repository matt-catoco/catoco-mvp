-- ============================================================================
-- Flow #4 follow-up — deterministic tiebreak on get_runner_up_option()
--
-- Not a missing-function fix (it's been defined since flow #3 batch 2,
-- 20260902000000_flow3_batch2.sql, and nothing ever dropped it) — this is a
-- small, real improvement on its own merits: with no explicit tiebreak, two
-- options tied for the top Borda score resolved to whichever row Postgres
-- happened to return first, which isn't guaranteed deterministic. Same
-- signature as before (same params, same return type), so a plain CREATE OR
-- REPLACE is safe here — no drop needed, unlike a param-count change.
-- ============================================================================

create or replace function public.get_runner_up_option(p_element_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select bs.option_id
  from public.borda_scores(p_element_id) bs
  where bs.option_id is distinct from (
    select locked_option_id from public.trip_elements where id = p_element_id
  )
  order by bs.score desc, bs.option_id asc
  limit 1;
$$;
