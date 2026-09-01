-- ============================================================================
-- Flow #3 follow-up — elements are editable after creation
--
-- Nothing let you fix a mistake once an element existed: wrong label, wrong
-- deadline, or — worst case — a typo'd price/date baked into an already-
-- locked value with no way to correct it. update_element() covers all of
-- that in one call, mirroring create_element()'s authority model (organizer,
-- or here also the element's own creator) rather than inventing a new one.
--
-- Explicitly out of scope: editing an open element's *candidate* options
-- (the proposer can already just submit a corrected one via the existing
-- SubmitOptionForm) and changing an element's scope/type/state — this is
-- strictly "fix what's already there," not a re-creation.
-- ============================================================================

create or replace function public.update_element(
  p_element_id uuid,
  p_label text,
  p_metadata jsonb default '{}'::jsonb,
  p_options_deadline timestamptz default null,
  p_voting_deadline timestamptz default null,
  p_locked_value jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip_id uuid;
  v_organizer_id uuid;
  v_created_by uuid;
  v_state text;
  v_locked_option_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'element needs a label';
  end if;

  select e.trip_id, e.created_by, e.state, e.locked_option_id, t.organizer_id
    into v_trip_id, v_created_by, v_state, v_locked_option_id, v_organizer_id
    from public.trip_elements e
    join public.trips t on t.id = e.trip_id
    where e.id = p_element_id;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  -- v_created_by can be null (account deleted, ON DELETE SET NULL) — the
  -- comparison then evaluates to null/false either way, so this correctly
  -- falls back to organizer-only in that edge case.
  if not (v_uid = v_organizer_id or v_uid = v_created_by) then
    raise exception 'only the organizer or the element''s creator can edit it';
  end if;

  if v_state = 'open' and p_options_deadline is not null and p_voting_deadline is not null
     and p_options_deadline > p_voting_deadline then
    raise exception 'options_deadline must be on or before voting_deadline';
  end if;

  update public.trip_elements
    set label = btrim(p_label),
        metadata = coalesce(p_metadata, '{}'::jsonb),
        options_deadline = case when v_state = 'open' then p_options_deadline else options_deadline end,
        voting_deadline = case when v_state = 'open' then p_voting_deadline else voting_deadline end
    where id = p_element_id;

  if v_state = 'locked' and p_locked_value is not null then
    if v_locked_option_id is null then
      raise exception 'locked element has no value to edit';
    end if;
    update public.element_options set value = p_locked_value where id = v_locked_option_id;
  end if;
end;
$$;

revoke all on function public.update_element(uuid, text, jsonb, timestamptz, timestamptz, jsonb) from public;
grant execute on function public.update_element(uuid, text, jsonb, timestamptz, timestamptz, jsonb) to authenticated;
