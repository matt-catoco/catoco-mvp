-- ============================================================================
-- Track how an element got locked (locked_via), to support the richer status
-- vocabulary computed in lib/trip-elements.ts's describeElementStatus():
-- "Locked by Organizer" vs "Locked by Group" for priced types (Travel/
-- Accommodation/Experience/Dining), vs "Confirmed" for Dates/Destination
-- (which skip this distinction entirely -- the type-based branch lives in
-- TS, not here; locked_via is still recorded for every type regardless of
-- whether the label surfaces it, cheap and keeps the locking RPCs simple).
--
-- Four places change trip_elements.state to/from 'locked' -- every one of
-- them needs to set or clear locked_via:
--   - create_element(): element created pre-locked -> 'organizer' (this also
--     covers the narrower case of a non-organizer locking their own
--     sole-scoped item -- not really "organizer authority", but the
--     product's two-bucket vocabulary (Organizer/Group) has no better home
--     for it right now).
--   - lock_element(): organizer/co-organizer ends an open vote early and
--     picks a specific option -> 'organizer' (deliberate: this is the
--     organizer overriding/deciding, not the group's vote concluding).
--   - resolve_due_elements(): auto-lock at voting_deadline -> 'vote' (the
--     one true "the group's vote decided" path).
--   - cascade_element_unavailable(): re-locks to the runner-up -> 'vote'
--     (still resolving the original vote, just cascading past an
--     unavailable option); reopens instead -> locked_via cleared to null
--     (the element is open again, it doesn't have a locked_via anymore).
-- ============================================================================

alter table public.trip_elements
  add column if not exists locked_via text;
alter table public.trip_elements drop constraint if exists trip_elements_locked_via_check;
alter table public.trip_elements
  add constraint trip_elements_locked_via_check
    check (locked_via is null or locked_via in ('organizer', 'vote'));

-- ---- cascade_element_unavailable: set/clear locked_via on both branches ---
create or replace function public.cascade_element_unavailable(p_element_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_alt_option_id uuid;
begin
  select trip_id into v_trip_id from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;

  update public.funding_requests fr
    set status = 'superseded'
    where status in ('collecting', 'ready_to_purchase')
      and exists (
        select 1 from public.funding_request_elements fre
        where fre.funding_request_id = fr.id and fre.element_id = p_element_id
      );

  select public.get_runner_up_option(p_element_id) into v_alt_option_id;

  if v_alt_option_id is not null then
    update public.trip_elements
      set locked_option_id = v_alt_option_id, locked_via = 'vote'
      where id = p_element_id;
    perform public.create_funding_request_for_element(p_element_id);
  else
    update public.trip_elements
      set state = 'open', locked_option_id = null, locked_via = null
      where id = p_element_id;
  end if;
end;
$$;

-- ---- create_element: set locked_via = 'organizer' when created pre-locked -
create or replace function public.create_element(
  p_trip_id uuid,
  p_type text,
  p_label text,
  p_metadata jsonb default '{}'::jsonb,
  p_scope_user_ids uuid[] default null,
  p_state text default 'open',
  p_options_deadline timestamptz default null,
  p_voting_deadline timestamptz default null,
  p_options jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
  v_scope uuid[];
  v_bad_count int;
  v_el_id uuid;
  v_state text := coalesce(p_state, 'open');
  v_options_deadline timestamptz := p_options_deadline;
  v_voting_deadline timestamptz := p_voting_deadline;
  v_opt jsonb;
  v_opt_id uuid;
  v_opt_count int := jsonb_array_length(coalesce(p_options, '[]'::jsonb));
  v_first_opt_id uuid;
  v_locked_via text;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'element needs a label';
  end if;
  if v_state not in ('locked', 'open') then
    raise exception 'bad element state: %', v_state;
  end if;

  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    raise exception 'trip not found';
  end if;
  if not public.is_trip_member(p_trip_id) then
    raise exception 'not a member of this trip';
  end if;

  if p_scope_user_ids is null or array_length(p_scope_user_ids, 1) is null then
    select coalesce(array_agg(user_id), array[]::uuid[]) into v_scope
      from public.trip_participants where trip_id = p_trip_id;
  else
    select count(*) into v_bad_count
      from unnest(p_scope_user_ids) as uid
      where uid <> v_organizer_id
        and not exists (
          select 1 from public.trip_participants tp
          where tp.trip_id = p_trip_id and tp.user_id = uid
        );
    if v_bad_count > 0 then
      raise exception 'scope includes someone not on this trip';
    end if;
    v_scope := p_scope_user_ids;
  end if;

  if v_uid <> v_organizer_id and not (v_uid = any(v_scope)) then
    v_scope := array_append(v_scope, v_uid);
  end if;

  if v_state = 'locked' then
    if not (
      public.is_trip_organizer(p_trip_id)
      or (array_length(v_scope, 1) = 1 and v_scope[1] = v_uid)
    ) then
      v_state := 'open';
    end if;
  end if;

  if v_state = 'locked' and v_opt_count <> 1 then
    raise exception 'a locked element needs exactly one value';
  end if;
  if v_state = 'open' and v_options_deadline is not null and v_voting_deadline is not null
     and v_options_deadline > v_voting_deadline then
    raise exception 'options_deadline must be on or before voting_deadline';
  end if;
  if v_state = 'locked' then
    v_options_deadline := null;
    v_voting_deadline := null;
    v_locked_via := 'organizer';
  end if;

  insert into public.trip_elements
    (trip_id, type, label, metadata, state, options_deadline, voting_deadline, created_by, locked_via)
  values
    (p_trip_id, p_type, btrim(p_label), coalesce(p_metadata, '{}'::jsonb), v_state,
     v_options_deadline, v_voting_deadline, v_uid, v_locked_via)
  returning id into v_el_id;

  v_first_opt_id := null;
  for v_opt in select value from jsonb_array_elements(coalesce(p_options, '[]'::jsonb))
  loop
    insert into public.element_options (element_id, value, source, proposed_by, unit_price, pricing_basis)
    values (
      v_el_id, v_opt->'value', 'user_proposed', v_uid,
      nullif(v_opt->>'unit_price', '')::numeric,
      nullif(v_opt->>'pricing_basis', '')
    )
    returning id into v_opt_id;
    if v_first_opt_id is null then
      v_first_opt_id := v_opt_id;
    end if;
  end loop;

  if v_state = 'locked' then
    update public.trip_elements set locked_option_id = v_first_opt_id where id = v_el_id;
    perform public.create_funding_request_for_element(v_el_id);
  end if;

  insert into public.element_participants (element_id, participant_id, opted_in)
  select v_el_id, s, true from unnest(v_scope) as s
  on conflict (element_id, participant_id) do nothing;

  return v_el_id;
end;
$$;

-- ---- lock_element: organizer-initiated -> locked_via = 'organizer' -------
create or replace function public.lock_element(p_element_id uuid, p_option_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_state text;
begin
  select trip_id, state into v_trip_id, v_state
    from public.trip_elements where id = p_element_id;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can do this';
  end if;
  if v_state <> 'open' then
    raise exception 'element is not open';
  end if;
  if not exists (
    select 1 from public.element_options where id = p_option_id and element_id = p_element_id
  ) then
    raise exception 'that option does not belong to this element';
  end if;

  update public.trip_elements
    set state = 'locked',
        locked_option_id = p_option_id,
        options_deadline = null,
        voting_deadline = null,
        locked_via = 'organizer'
    where id = p_element_id;

  perform public.create_funding_request_for_element(p_element_id);
end;
$$;

-- ---- resolve_due_elements: auto-lock at deadline -> locked_via = 'vote' --
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
      set state = 'locked', locked_option_id = v_winner_option_id, locked_via = 'vote'
      where id = v_el.id;

    perform public.create_funding_request_for_element(v_el.id);
  end loop;
end;
$$;
