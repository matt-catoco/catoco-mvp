-- ============================================================================
-- Fix: resolve_due_elements() never actually auto-locked anything.
--
-- Root cause, found by calling the RPC directly and reading the raw
-- Postgres error (the app's resolveAndNotify() wrapper discards `error`
-- entirely -- `const { data } = await supabase.rpc(...)` -- so this failed
-- 100% silently on every page load, with zero trace anywhere in the UI):
--
--   23514: new row for relation "trip_elements" violates check constraint
--   "trip_elements_deadlines_only_open"
--
-- That constraint (20260831120000_element_schema_updates.sql) requires
-- options_deadline/voting_deadline to be null once state != 'open'. The
-- manual lock path (lock_element()) already clears both explicitly; this
-- function's own auto-lock UPDATE never did, so the row it tried to write
-- (state='locked', voting_deadline still set to the past date that just
-- triggered the resolution) always violated the constraint and rolled
-- back -- the update never persisted, for every element, every time,
-- since this function existed. The empty/tie-notification branches were
-- unaffected (they only ever touch empty_notified/tie_notified, never
-- state), which is why those looked like they worked while locking never
-- did.
-- ============================================================================

create or replace function public.resolve_due_elements(p_trip_id uuid)
returns table(element_id uuid, element_type text, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_el record;
  v_opt_count int;
  v_top_score bigint;
  v_tie_count int;
  v_winner_option_id uuid;
begin
  for v_el in
    select id, type, tie_notified, empty_notified
    from public.trip_elements
    where trip_id = p_trip_id
      and state = 'open'
      and voting_deadline is not null
      and voting_deadline <= now()
  loop
    select count(*) into v_opt_count
      from public.element_options where element_options.element_id = v_el.id;

    if v_opt_count = 0 then
      if not v_el.empty_notified then
        update public.trip_elements set empty_notified = true where id = v_el.id;
        element_id := v_el.id;
        element_type := v_el.type;
        reason := 'empty';
        return next;
      end if;
      continue;
    end if;

    if v_opt_count = 1 then
      select eo.id into v_winner_option_id
        from public.element_options eo where eo.element_id = v_el.id;
    else
      select bs.score into v_top_score
        from public.borda_scores(v_el.id) bs order by bs.score desc limit 1;
      select count(*) into v_tie_count
        from public.borda_scores(v_el.id) bs where bs.score = v_top_score;

      if v_tie_count > 1 then
        if not v_el.tie_notified then
          update public.trip_elements set tie_notified = true where id = v_el.id;
          element_id := v_el.id;
          element_type := v_el.type;
          reason := 'tie';
          return next;
        end if;
        continue;
      end if;

      select bs.option_id into v_winner_option_id
        from public.borda_scores(v_el.id) bs order by bs.score desc limit 1;
    end if;

    update public.trip_elements
      set state = 'locked',
          locked_option_id = v_winner_option_id,
          locked_via = 'vote',
          options_deadline = null,
          voting_deadline = null
      where id = v_el.id;

    perform public.create_funding_request_for_element(v_el.id);
  end loop;
end;
$$;
