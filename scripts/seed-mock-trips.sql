-- ============================================================================
-- Mock-trip seeding script for cross-role testing (STAGING ONLY).
--
-- Creates 6 deliberately-scripted trips under one organizer, covering the
-- element-type / lock-path / funding-stage matrix described in the build
-- prompt. Re-run for each of the 3 real staging profiles by calling
-- seed_mock_trip_batch() with a different organizer id + trip-name list --
-- the function body (the actual scenario logic) never needs to change.
--
-- Requires: the organizer already exists as a real Supabase Auth user on
-- staging (profiles row created by handle_new_user() the normal way -- this
-- script never touches auth.users).
--
-- Auth approach: per-call auth.uid() impersonation via the
-- request.jwt.claims GUC (the same technique already used directly against
-- production to test RLS behavior earlier in this project) -- every RPC
-- this script calls is SECURITY DEFINER and reads auth.uid() internally, so
-- the session has to look like a real signed-in request from the organizer,
-- not an anonymous/service-role caller. Plain inserts (trips, proposed
-- element_options) go through the same impersonated session for
-- consistency, even though the connection this runs under (Supabase's SQL
-- execution role) bypasses RLS regardless.
--
-- Usage:
--   select * from public.seed_mock_trip_batch('<organizer-uuid>'::uuid);
--   -- or with a custom name list (must be exactly 6, in this fixed order):
--   select * from public.seed_mock_trip_batch(
--     '<organizer-uuid>'::uuid,
--     array['Trip 1 name','Trip 2 name','Trip 3 name','Trip 4 name','Trip 5 name','Trip 6 name']
--   );
--
-- Returns one row per trip created: (trip_num, trip_id, trip_name).
-- ============================================================================

create or replace function public.seed_mock_trip_batch(
  p_organizer_id uuid,
  p_trip_names text[] default array[
    'Kyoto Sakura Meetup',
    'Iceland Ring Road',
    'Costa Rica Canopy Trip',
    'Barcelona Long Weekend',
    'Scottish Highlands Loop',
    'Baja Surf & Sun'
  ]
)
returns table(trip_num int, seeded_trip_id uuid, trip_name text)
language plpgsql
as $body$
declare
  -- generic scratch vars reused across trip blocks
  v_trip_id uuid;
  v_el_id uuid;
  v_el2_id uuid;
  v_opt_ids uuid[];
  v_fr_id uuid;
  v_fr2_id uuid;
  v_required numeric;
  v_required2 numeric;
begin
  if array_length(p_trip_names, 1) is distinct from 6 then
    raise exception 'p_trip_names must have exactly 6 entries, got %', array_length(p_trip_names, 1);
  end if;

  -- Impersonate the organizer for every call below. Session-scoped (is_local
  -- = false) so it survives across the many statements in this function,
  -- not just the current sub-transaction.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', p_organizer_id::text, 'role', 'authenticated')::text,
    false
  );

  -- ==========================================================================
  -- Trip 1 -- "Wide Open" (brand-new / early Draft)
  -- ==========================================================================
  insert into public.trips (name, organizer_id) values (p_trip_names[1], p_organizer_id)
    returning id into v_trip_id;
  perform public.join_trip(v_trip_id); -- no-op for the organizer themselves, called per §3 for parity with the real page-load path

  -- Destination: 2 candidates, still Submitting
  perform public.create_element(
    v_trip_id, 'destination', 'Destination', '{}'::jsonb, null, 'open',
    now() + interval '5 days', now() + interval '10 days',
    jsonb_build_array(
      jsonb_build_object('value', jsonb_build_object('name', 'Kyoto, Japan')),
      jsonb_build_object('value', jsonb_build_object('name', 'Osaka, Japan'))
    ),
    null::uuid
  );

  -- Flight: 2 candidates, still Submitting
  perform public.create_element(
    v_trip_id, 'travel', 'Flight', '{}'::jsonb, null, 'open',
    now() + interval '5 days', now() + interval '10 days',
    jsonb_build_array(
      jsonb_build_object('value', jsonb_build_object(
        'mode', 'flight', 'start_location', 'SFO', 'destination_location', 'KIX',
        'round_trip', true, 'price', 780, 'currency', 'USD', 'pricing_basis', 'per_person',
        'booking_link', 'https://example.com/mock/kyoto-flight-a'
      )),
      jsonb_build_object('value', jsonb_build_object(
        'mode', 'flight', 'start_location', 'SFO', 'destination_location', 'KIX',
        'round_trip', true, 'price', 690, 'currency', 'USD', 'pricing_basis', 'per_person',
        'booking_link', 'https://example.com/mock/kyoto-flight-b'
      ))
    ),
    null::uuid
  );

  -- Everyone-scoped, ZERO options -- deliberate fixture for the
  -- element-visibility bug, left untouched from here on.
  perform public.create_element(
    v_trip_id, 'experience', 'Group activity ideas?', '{}'::jsonb, null, 'open',
    now() + interval '7 days', now() + interval '12 days',
    '[]'::jsonb,
    null::uuid
  );

  -- Dates, Nights-mode submission -- then replicate app-layer
  -- submitOption()'s derived-element spawn (app/trips/[tripId]/actions.ts)
  -- at the DB layer, since that auto-spawn logic lives in the Next.js
  -- server action, not in create_element() itself.
  perform public.create_element(
    v_trip_id, 'dates', 'Dates', '{}'::jsonb, null, 'open',
    now() + interval '5 days', now() + interval '10 days', '[]'::jsonb,
    null::uuid
  );
  select id into v_el_id from public.trip_elements
    where trip_id = v_trip_id and type = 'dates' order by created_at desc limit 1;

  insert into public.element_options (element_id, value, source, proposed_by)
    values (v_el_id, jsonb_build_object('nights', 6), 'user_proposed', p_organizer_id);

  -- mirrors actions.ts: only fires when the element already has a
  -- voting_deadline, and only once per original element
  if not exists (select 1 from public.trip_elements where derived_from_element_id = v_el_id) then
    perform public.create_element(
      v_trip_id, 'dates', 'Dates', '{}'::jsonb, null, 'open',
      (now() + interval '10 days') + interval '7 days',
      (now() + interval '10 days') + interval '14 days',
      '[]'::jsonb,
      v_el_id
    );
  end if;

  if not exists (select 1 from public.trip_elements where derived_from_element_id = v_el_id) then
    raise exception 'Trip 1 regression: Nights-mode Dates option did not spawn a derived exact-dates element';
  end if;

  trip_num := 1; seeded_trip_id := v_trip_id; trip_name := p_trip_names[1];
  return next;

  -- ==========================================================================
  -- Trip 2 -- "Mid Vote"
  -- ==========================================================================
  insert into public.trips (name, organizer_id) values (p_trip_names[2], p_organizer_id)
    returning id into v_trip_id;
  perform public.join_trip(v_trip_id);

  -- Accommodations: past options_deadline (Voting open), organizer has voted
  perform public.create_element(
    v_trip_id, 'accommodation', 'Hotel', '{}'::jsonb, null, 'open',
    now() - interval '1 day', now() + interval '5 days',
    jsonb_build_array(
      jsonb_build_object('value', jsonb_build_object(
        'name', 'Reykjavik Central Hotel', 'subtype', 'hotel',
        'accommodation_fields', jsonb_build_object('rooms', '2', 'guests', '4', 'breakfast', 'Yes'),
        'price', 140, 'currency', 'USD', 'pricing_basis', 'per_night',
        'booking_link', 'https://example.com/mock/reykjavik-hotel-a'
      )),
      jsonb_build_object('value', jsonb_build_object(
        'name', 'Fjord View Guesthouse', 'subtype', 'guesthouse',
        'price', 95, 'currency', 'USD', 'pricing_basis', 'per_night',
        'booking_link', 'https://example.com/mock/reykjavik-guesthouse-b'
      )),
      jsonb_build_object('value', jsonb_build_object(
        'name', 'Ring Road Cabins', 'subtype', 'cabin_cottage',
        'accommodation_fields', jsonb_build_object('bedrooms', '2', 'beds', '3', 'bathrooms', '1', 'max_guests', '5'),
        'price', 160, 'currency', 'USD', 'pricing_basis', 'per_night',
        'booking_link', 'https://example.com/mock/reykjavik-cabins-c'
      ))
    ),
    null::uuid
  );
  select id into v_el_id from public.trip_elements
    where trip_id = v_trip_id and label = 'Hotel' order by created_at desc limit 1;
  -- created_at is frozen at the transaction's start time (now()), so every
  -- option inserted by the same create_element() call ties on it -- ctid
  -- breaks the tie deterministically in actual insertion order for this
  -- fresh, single-writer table.
  select array_agg(id order by created_at, ctid) into v_opt_ids from public.element_options where element_id = v_el_id;
  perform public.cast_votes(v_el_id, array[v_opt_ids[1], v_opt_ids[3], v_opt_ids[2]]);

  -- Experience: past options_deadline (Voting open), organizer has voted
  perform public.create_element(
    v_trip_id, 'experience', 'Blue Lagoon or Glacier Hike', '{}'::jsonb, null, 'open',
    now() - interval '1 day', now() + interval '5 days',
    jsonb_build_array(
      jsonb_build_object('value', jsonb_build_object(
        'name', 'Blue Lagoon Entry', 'experience_subtype', 'outdoor_adventure',
        'price', 90, 'currency', 'USD', 'pricing_basis', 'per_person',
        'booking_link', 'https://example.com/mock/blue-lagoon'
      )),
      jsonb_build_object('value', jsonb_build_object(
        'name', 'Glacier Hike Tour', 'experience_subtype', 'outdoor_adventure',
        'price', 130, 'currency', 'USD', 'pricing_basis', 'per_person',
        'booking_link', 'https://example.com/mock/glacier-hike'
      ))
    ),
    null::uuid
  );
  select id into v_el_id from public.trip_elements
    where trip_id = v_trip_id and label = 'Blue Lagoon or Glacier Hike' order by created_at desc limit 1;
  -- created_at is frozen at the transaction's start time (now()), so every
  -- option inserted by the same create_element() call ties on it -- ctid
  -- breaks the tie deterministically in actual insertion order for this
  -- fresh, single-writer table.
  select array_agg(id order by created_at, ctid) into v_opt_ids from public.element_options where element_id = v_el_id;
  perform public.cast_votes(v_el_id, array[v_opt_ids[2], v_opt_ids[1]]);

  -- Dining: past options_deadline (Voting open), 2 close-valued options, NO
  -- vote cast yet -- a genuine 0-0 tie, positioned for whoever casts the
  -- next ranked vote (once a second profile is cross-added) to land on
  -- either side of a real tie-notification.
  perform public.create_element(
    v_trip_id, 'dining', 'Dinner in Reykjavik', '{}'::jsonb, null, 'open',
    now() - interval '1 day', now() + interval '5 days',
    jsonb_build_array(
      jsonb_build_object('value', jsonb_build_object(
        'name', 'Sea Baron', 'cuisine', 'Seafood', 'price_tier', '$$',
        'booking_link', 'https://example.com/mock/sea-baron'
      )),
      jsonb_build_object('value', jsonb_build_object(
        'name', 'Grillmarkadurinn', 'cuisine', 'Icelandic', 'price_tier', '$$$',
        'booking_link', 'https://example.com/mock/grillmarkadurinn'
      ))
    ),
    null::uuid
  );

  trip_num := 2; seeded_trip_id := v_trip_id; trip_name := p_trip_names[2];
  return next;

  -- ==========================================================================
  -- Trip 3 -- "Locked & Collecting" (organizer-direct-lock path)
  -- ==========================================================================
  insert into public.trips (name, organizer_id) values (p_trip_names[3], p_organizer_id)
    returning id into v_trip_id;
  perform public.join_trip(v_trip_id);

  -- Dates locked first (organizer-direct) so the per_night Accommodations
  -- element below can calculate a real required_amount immediately -- the
  -- lock-order regression itself is Trip 5's job, not this one's.
  perform public.create_element(
    v_trip_id, 'dates', 'Dates', '{}'::jsonb, null, 'locked', null, null,
    jsonb_build_array(jsonb_build_object('value', jsonb_build_object(
      'start_date', '2026-11-10', 'end_date', '2026-11-15'
    ))),
    null::uuid
  );

  -- Accommodations, per_night, locked at creation
  perform public.create_element(
    v_trip_id, 'accommodation', 'Canopy Lodge', '{}'::jsonb, null, 'locked', null, null,
    jsonb_build_array(jsonb_build_object(
      'value', jsonb_build_object(
        'name', 'Canopy Lodge Monteverde', 'subtype', 'chalet',
        'accommodation_fields', jsonb_build_object('bedrooms', '3', 'beds', '4', 'bathrooms', '2', 'max_guests', '6'),
        'price', 180, 'currency', 'USD', 'pricing_basis', 'per_night',
        'booking_link', 'https://example.com/mock/canopy-lodge'
      ),
      'unit_price', 180, 'pricing_basis', 'per_night'
    )),
    null::uuid
  );
  select id into v_el_id from public.trip_elements
    where trip_id = v_trip_id and label = 'Canopy Lodge' order by created_at desc limit 1;
  select fr.id, fr.required_amount into v_fr_id, v_required
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    where fre.element_id = v_el_id and fr.status <> 'superseded' limit 1;
  if v_fr_id is null then
    raise exception 'Trip 3: expected a funding_requests row for the per_night Accommodations element once Dates is locked';
  end if;
  -- left at 0% collected on purpose

  -- Experience, flat, locked at creation -- partially funded (~50%)
  perform public.create_element(
    v_trip_id, 'experience', 'Canopy Zipline Tour', '{}'::jsonb, null, 'locked', null, null,
    jsonb_build_array(jsonb_build_object(
      'value', jsonb_build_object(
        'name', 'Canopy Zipline Tour (group rate)', 'experience_subtype', 'outdoor_adventure',
        'price', 240, 'currency', 'USD', 'pricing_basis', 'flat',
        'booking_link', 'https://example.com/mock/zipline-tour'
      ),
      'unit_price', 240, 'pricing_basis', 'flat'
    )),
    null::uuid
  );
  select id into v_el2_id from public.trip_elements
    where trip_id = v_trip_id and label = 'Canopy Zipline Tour' order by created_at desc limit 1;
  select fr.id, fr.required_amount into v_fr2_id, v_required2
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    where fre.element_id = v_el2_id and fr.status <> 'superseded' limit 1;
  perform public.add_funding_contribution(v_fr2_id, round(v_required2 * 0.5, 2));

  trip_num := 3; seeded_trip_id := v_trip_id; trip_name := p_trip_names[3];
  return next;

  -- ==========================================================================
  -- Trip 4 -- "Vote-Locked & Ready/Booked"
  -- ==========================================================================
  insert into public.trips (name, organizer_id) values (p_trip_names[4], p_organizer_id)
    returning id into v_trip_id;
  perform public.join_trip(v_trip_id);

  -- Dates: single option, past voting_deadline -- lock it via the vote path
  -- first and in its own resolve pass, so every paid element created after
  -- this point can calculate its required_amount immediately rather than
  -- relying on the backfill safety net.
  perform public.create_element(
    v_trip_id, 'dates', 'Dates', '{}'::jsonb, null, 'open',
    now() - interval '3 days', now() - interval '1 day',
    jsonb_build_array(jsonb_build_object('value', jsonb_build_object(
      'start_date', '2026-10-02', 'end_date', '2026-10-06'
    ))),
    null::uuid
  );
  perform public.resolve_due_elements(v_trip_id);

  -- Paid element #1 (Accommodations, per_night) -- vote-locked, then fully
  -- funded to confirm the 100% auto-transition to ready_to_purchase.
  perform public.create_element(
    v_trip_id, 'accommodation', 'Hotel Barcelona', '{}'::jsonb, null, 'open',
    now() - interval '3 days', now() - interval '1 day',
    jsonb_build_array(jsonb_build_object(
      'value', jsonb_build_object(
        'name', 'Hotel Casa Gracia', 'subtype', 'hotel',
        'accommodation_fields', jsonb_build_object('rooms', '2', 'guests', '4', 'breakfast', 'Yes'),
        'price', 165, 'currency', 'USD', 'pricing_basis', 'per_night',
        'booking_link', 'https://example.com/mock/casa-gracia'
      ),
      'unit_price', 165, 'pricing_basis', 'per_night'
    )),
    null::uuid
  );

  -- Paid element #2 (Experience, flat) -- vote-locked, fully funded, then
  -- reported booked for a complete end-to-end element.
  perform public.create_element(
    v_trip_id, 'experience', 'Sagrada Familia Tour', '{}'::jsonb, null, 'open',
    now() - interval '3 days', now() - interval '1 day',
    jsonb_build_array(jsonb_build_object(
      'value', jsonb_build_object(
        'name', 'Sagrada Familia Skip-the-Line Tour', 'experience_subtype', 'tour_sightseeing',
        'price', 220, 'currency', 'USD', 'pricing_basis', 'flat',
        'booking_link', 'https://example.com/mock/sagrada-tour'
      ),
      'unit_price', 220, 'pricing_basis', 'flat'
    )),
    null::uuid
  );

  perform public.resolve_due_elements(v_trip_id);

  select id into v_el_id from public.trip_elements
    where trip_id = v_trip_id and label = 'Hotel Barcelona' order by created_at desc limit 1;
  select fr.id, fr.required_amount into v_fr_id, v_required
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    where fre.element_id = v_el_id and fr.status <> 'superseded' limit 1;
  if v_fr_id is null then
    raise exception 'Trip 4: expected a funding_requests row for Hotel Barcelona after vote-lock';
  end if;
  perform public.add_funding_contribution(v_fr_id, v_required);
  if not exists (select 1 from public.funding_requests where id = v_fr_id and status = 'ready_to_purchase') then
    raise exception 'Trip 4 regression: fully funding did not auto-transition to ready_to_purchase';
  end if;

  select id into v_el2_id from public.trip_elements
    where trip_id = v_trip_id and label = 'Sagrada Familia Tour' order by created_at desc limit 1;
  select fr.id, fr.required_amount into v_fr2_id, v_required2
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    where fre.element_id = v_el2_id and fr.status <> 'superseded' limit 1;
  perform public.add_funding_contribution(v_fr2_id, v_required2);
  perform public.report_element_booked(v_el2_id, 'booked', v_required2);

  trip_num := 4; seeded_trip_id := v_trip_id; trip_name := p_trip_names[4];
  return next;

  -- ==========================================================================
  -- Trip 5 -- "Lock-order regression + co-organizer seam"
  -- ==========================================================================
  insert into public.trips (name, organizer_id) values (p_trip_names[5], p_organizer_id)
    returning id into v_trip_id;
  perform public.join_trip(v_trip_id);

  -- Lock the per_night Accommodations option BEFORE any Dates element
  -- exists on this trip at all.
  perform public.create_element(
    v_trip_id, 'accommodation', 'Highlands Inn', '{}'::jsonb, null, 'locked', null, null,
    jsonb_build_array(jsonb_build_object(
      'value', jsonb_build_object(
        'name', 'Glencoe Highland Inn', 'subtype', 'bnb',
        'accommodation_fields', jsonb_build_object('rooms', '1', 'guests', '2', 'breakfast', 'Yes'),
        'price', 120, 'currency', 'USD', 'pricing_basis', 'per_night',
        'booking_link', 'https://example.com/mock/glencoe-inn'
      ),
      'unit_price', 120, 'pricing_basis', 'per_night'
    )),
    null::uuid
  );
  select id into v_el_id from public.trip_elements
    where trip_id = v_trip_id and label = 'Highlands Inn' order by created_at desc limit 1;

  if exists (
    select 1 from public.funding_request_elements fre
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = v_el_id and fr.status <> 'superseded'
  ) then
    raise exception 'Trip 5 regression: a funding_requests row already exists before Dates is locked -- expected none yet';
  end if;

  -- Now lock Dates -- should retroactively backfill the funding_requests
  -- row for the Accommodations element above via backfill_funding_for_dates().
  perform public.create_element(
    v_trip_id, 'dates', 'Dates', '{}'::jsonb, null, 'locked', null, null,
    jsonb_build_array(jsonb_build_object('value', jsonb_build_object(
      'start_date', '2026-09-20', 'end_date', '2026-09-25'
    ))),
    null::uuid
  );

  if not exists (
    select 1 from public.funding_request_elements fre
    join public.funding_requests fr on fr.id = fre.funding_request_id
    where fre.element_id = v_el_id and fr.status <> 'superseded'
  ) then
    raise exception 'Trip 5 regression: locking Dates did not retroactively create a funding_requests row for Highlands Inn';
  end if;

  -- NOTE for the founder: once a second real profile has joined this trip,
  -- promote them to co-organizer here --
  --   select public.set_participant_role('<this trip id>', '<their user id>', 'co_organizer');
  -- can't be scripted until that join has actually happened.

  trip_num := 5; seeded_trip_id := v_trip_id; trip_name := p_trip_names[5];
  return next;

  -- ==========================================================================
  -- Trip 6 -- "Edge cases / cascade"
  -- ==========================================================================
  insert into public.trips (name, organizer_id) values (p_trip_names[6], p_organizer_id)
    returning id into v_trip_id;
  perform public.join_trip(v_trip_id);
  perform public.set_participant_capacity(v_trip_id, 4, 8);

  -- Vote-locked element with real alternatives, then reported unavailable --
  -- exercises cascade_element_unavailable()'s runner-up-promotion branch
  -- (report_element_booked('unavailable', ...) requires state = 'locked',
  -- so this has to go through vote-lock first, not organizer-direct-lock,
  -- to leave alternative options behind for the runner-up to promote from).
  -- voting_deadline starts in the future so cast_votes() will actually
  -- accept the organizer's ranking; pushed into the past afterward (a raw
  -- update, standing in for time passing) so resolve_due_elements() then
  -- locks it via the vote it already collected.
  perform public.create_element(
    v_trip_id, 'dining', 'Farewell Dinner', '{}'::jsonb, null, 'open',
    now() - interval '3 days', now() + interval '1 hour',
    jsonb_build_array(
      jsonb_build_object('value', jsonb_build_object(
        'name', 'La Costa', 'cuisine', 'Mexican', 'price_tier', '$$',
        'booking_link', 'https://example.com/mock/la-costa'
      )),
      jsonb_build_object('value', jsonb_build_object(
        'name', 'Marisco Azul', 'cuisine', 'Seafood', 'price_tier', '$$$',
        'booking_link', 'https://example.com/mock/marisco-azul'
      ))
    ),
    null::uuid
  );
  select id into v_el_id from public.trip_elements
    where trip_id = v_trip_id and label = 'Farewell Dinner' order by created_at desc limit 1;
  -- created_at is frozen at the transaction's start time (now()), so every
  -- option inserted by the same create_element() call ties on it -- ctid
  -- breaks the tie deterministically in actual insertion order for this
  -- fresh, single-writer table.
  select array_agg(id order by created_at, ctid) into v_opt_ids from public.element_options where element_id = v_el_id;
  perform public.cast_votes(v_el_id, array[v_opt_ids[1], v_opt_ids[2]]);
  update public.trip_elements set voting_deadline = now() - interval '1 day' where id = v_el_id;
  perform public.resolve_due_elements(v_trip_id);

  perform public.report_element_booked(v_el_id, 'unavailable');

  -- Zero-option element, both deadlines already past -- resolve_due_elements
  -- should hit the "empty" reason and never lock it.
  perform public.create_element(
    v_trip_id, 'experience', 'Unplanned slot', '{}'::jsonb, null, 'open',
    now() - interval '3 days', now() - interval '1 day', '[]'::jsonb,
    null::uuid
  );
  select id into v_el2_id from public.trip_elements
    where trip_id = v_trip_id and label = 'Unplanned slot' order by created_at desc limit 1;
  perform public.resolve_due_elements(v_trip_id);

  if exists (select 1 from public.trip_elements where id = v_el2_id and state <> 'open') then
    raise exception 'Trip 6 regression: the zero-option element should stay open, not lock';
  end if;
  if not exists (select 1 from public.trip_elements where id = v_el2_id and empty_notified = true) then
    raise exception 'Trip 6 regression: resolve_due_elements should have marked the zero-option element empty_notified';
  end if;

  trip_num := 6; seeded_trip_id := v_trip_id; trip_name := p_trip_names[6];
  return next;
end;
$body$;
