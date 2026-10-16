-- ============================================================================
-- STAGING ONLY — customer-journey demo trips (founder, 2026-10-16).
--
-- Never run against production. Builds "Chelsea's 40th <version>": the same
-- trip (name, photo, group, settings, elements, options) frozen at a
-- different stage of the journey, so each stage can be walked as organizer
-- and as participant. See "Claude outputs/staging-journey-seed.md" for the
-- version table and the reusable prompt.
--
-- Goes through the app's own functions wherever possible (create_element,
-- cast_votes, lock_element, create_funding_mandate, cancel_funding_mandate)
-- by setting request.jwt.claims to the acting user. What Stripe would do
-- (an authorization succeeding, a hold, a charge) is written directly.
--
-- Usage (as postgres / service role, on staging):
--   select public.zz_seed_journey_trip('1.0', 0);  -- … through ('3.0', 10)
-- Stages: 0 kickoff · 1 submissions in · 2 voting · 3 first locks ·
-- 4 funding open · 5 committing · 6 withdrawals · 7 final stretch ·
-- 8 committing after the deadline · 9 funded · 10 booked.
-- Accounts (hello@ + hello+name@catoco.co) must exist first.
-- ============================================================================

create or replace function public.zz_seed_as(p_uid uuid)
returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$$;

create or replace function public.zz_seed_journey_trip(p_version text, p_stage int)
returns uuid
language plpgsql
set search_path = public
as $fn$
declare
  m uuid; ch uuid; sa uuid; le uuid; st uuid; gr uuid; cl uuid; se uuid;
  everyone uuid[];
  train_group uuid[];
  t uuid;
  e_dates uuid; e_dest uuid; e_stay uuid; e_train uuid; e_flight uuid; e_flamenco uuid; e_dinner uuid;
  o_dates_m uuid; o_dates_ch uuid;
  o_dest_m uuid; o_dest_le uuid; o_dest_st uuid;
  o_stay_m uuid; o_stay_ch uuid; o_stay_le uuid;
  o_train_m uuid; o_train_gr uuid;
  o_flight_se uuid; o_flight_sa uuid;
  o_fl_ch uuid; o_fl_st uuid;
  o_din_m uuid; o_din_le uuid;
  v_fr uuid;
  v_mid uuid;
  r record;
  funded_elements uuid[];
  photo text := 'https://images.unsplash.com/photo-1559386081-325882507af7?auto=format&fit=crop&w=1080&q=80';
  -- element deadlines while the plan is open (moved per stage below)
  sub_dl timestamptz;
  vote_dl timestamptz;
  fund_dl timestamptz;
begin
  if current_setting('app.settings.environment', true) = 'production' then
    raise exception 'staging only';
  end if;

  select id into m from auth.users where email = 'hello@catoco.co';
  select id into ch from auth.users where email = 'hello+chelsea@catoco.co';
  select id into sa from auth.users where email = 'hello+sam@catoco.co';
  select id into le from auth.users where email = 'hello+lena@catoco.co';
  select id into st from auth.users where email = 'hello+stella@catoco.co';
  select id into gr from auth.users where email = 'hello+greg@catoco.co';
  select id into cl from auth.users where email = 'hello+claudia@catoco.co';
  select id into se from auth.users where email = 'hello+serena@catoco.co';
  if se is null then raise exception 'create the 8 accounts first'; end if;
  everyone := array[m, ch, sa, le, st, gr, cl, se];
  train_group := array[m, ch, le, st, gr, cl];

  -- ---- trip ----------------------------------------------------------------
  insert into public.trips (name, icon, icon_attribution, organizer_id,
    allow_participant_elements, allow_participant_subgroups,
    submission_deadline_days, voting_deadline_days, funding_deadline_days,
    allow_over_max, allow_participant_invites,
    price_cushion_kind, price_cushion_value, allow_checkout_cushion, notify_price_drift,
    payment_retry_hours, view_all_participants, deadline_alert_hours, show_voters)
  values ('Chelsea''s 40th ' || p_version, photo,
    jsonb_build_object('photographerName', 'V2F', 'photographerProfileUrl', 'https://unsplash.com/@iv2fi'),
    m, true, true, 7, 7, 14, false, false,
    'percent', 15, true, true, 24, true, 24, false)
  returning id into t;

  insert into public.trip_participants (trip_id, user_id, role)
  select t, u, case when u = ch then 'co_organizer' else 'participant' end
  from unnest(array[ch, sa, le, st, gr, cl, se]) as u;

  -- ---- elements (open while ideas come in) --------------------------------
  sub_dl := now() + interval '5 days';
  vote_dl := now() + interval '10 days';
  perform public.zz_seed_as(m);

  e_dates := public.create_element(t, 'dates', 'Dates', '{}'::jsonb, null, 'open', sub_dl, vote_dl,
    jsonb_build_array(jsonb_build_object('value', jsonb_build_object('start_date', '2027-09-09', 'end_date', '2027-09-13'))));
  e_dest := public.create_element(t, 'destination', 'Destination', '{}'::jsonb, null, 'open', sub_dl, vote_dl,
    jsonb_build_array(jsonb_build_object('value', jsonb_build_object('name', 'Sevilla, Spain'))));
  e_stay := public.create_element(t, 'accommodation', 'Stay in Sevilla', '{}'::jsonb, null, 'open', sub_dl, vote_dl,
    jsonb_build_array(jsonb_build_object(
      'value', jsonb_build_object('name', 'Casa del Sol', 'subtype', 'villa',
        'accommodation_fields', jsonb_build_object('bedrooms', '5', 'beds', '8', 'bathrooms', '4', 'max_guests', '10'),
        'dates', jsonb_build_object('start_date', '2027-09-16', 'end_date', '2027-09-20'),
        'booking_link', 'https://casadelsol.example/sevilla', 'price', 450, 'currency', 'EUR', 'pricing_basis', 'per_night'),
      'unit_price', 450, 'pricing_basis', 'per_night')));
  e_train := public.create_element(t, 'travel', 'Train to Sevilla', '{}'::jsonb, train_group, 'open', sub_dl, vote_dl,
    jsonb_build_array(jsonb_build_object(
      'value', jsonb_build_object('mode', 'train', 'start_location', 'Madrid Atocha', 'destination_location', 'Sevilla Santa Justa',
        'depart_date', '2027-09-16', 'round_trip', true, 'return_date', '2027-09-20',
        'booking_link', 'https://trains.example/madrid-sevilla', 'price', 85, 'currency', 'EUR', 'pricing_basis', 'per_person'),
      'unit_price', 85, 'pricing_basis', 'per_person')));
  e_flamenco := public.create_element(t, 'experience', 'Flamenco night', '{}'::jsonb, null, 'open', sub_dl, vote_dl, '[]'::jsonb);
  e_dinner := public.create_element(t, 'dining', 'Birthday dinner', '{}'::jsonb, null, 'open', sub_dl, vote_dl,
    jsonb_build_array(jsonb_build_object(
      'value', jsonb_build_object('name', 'La Azotea Real', 'price_tier', '$$$$', 'cuisine', 'Andalusian tasting menu',
        'date', '2027-09-18', 'dining_time', '21:30', 'guests', 8, 'deposit_required', true,
        'booking_link', 'https://azotea.example/reserve', 'price', 40, 'currency', 'EUR', 'pricing_basis', 'per_person'),
      'unit_price', 40, 'pricing_basis', 'per_person')));
  -- Flamenco: 5 spots for a group of 8 (waitlist demo)
  update public.trip_elements set spots = 5 where id = e_flamenco;

  -- Serena's own sub-group element: a flight for Sam and herself
  perform public.zz_seed_as(se);
  e_flight := public.create_element(t, 'travel', 'Flight to Sevilla', '{}'::jsonb, array[se, sa], 'open', sub_dl, vote_dl,
    jsonb_build_array(jsonb_build_object(
      'value', jsonb_build_object('mode', 'flight', 'start_location', 'Amsterdam (AMS)', 'destination_location', 'Sevilla (SVQ)',
        'depart_date', '2027-09-16', 'depart_time', '07:10', 'arrival_time', '10:05', 'flight_number', 'CT 482',
        'round_trip', true, 'return_date', '2027-09-20',
        'vendor_source', 'duffel', 'vendor_offer_id', 'seed_offer_ams_svq', 'currency', 'EUR',
        'price', 210, 'pricing_basis', 'per_person',
        'travelers', jsonb_build_object('adults', 2)),
      'unit_price', 210, 'pricing_basis', 'per_person')));

  select id into o_dates_m from element_options where element_id = e_dates;
  select id into o_dest_m from element_options where element_id = e_dest;
  select id into o_stay_m from element_options where element_id = e_stay;
  select id into o_train_m from element_options where element_id = e_train;
  select id into o_din_m from element_options where element_id = e_dinner;
  select id into o_flight_se from element_options where element_id = e_flight;

  -- ---- the rest of the group's ideas (from stage 1) ------------------------
  if p_stage >= 1 then
    insert into element_options (element_id, value, source, proposed_by, unit_price, pricing_basis)
      values (e_dates, jsonb_build_object('start_date', '2027-09-16', 'end_date', '2027-09-20'), 'user_proposed', ch, null, null)
      returning id into o_dates_ch;
    insert into element_options (element_id, value, source, proposed_by) values
      (e_dest, jsonb_build_object('name', 'Lisbon, Portugal'), 'user_proposed', le) returning id into o_dest_le;
    insert into element_options (element_id, value, source, proposed_by) values
      (e_dest, jsonb_build_object('name', 'Valencia, Spain'), 'user_proposed', st) returning id into o_dest_st;
    insert into element_options (element_id, value, source, proposed_by, unit_price, pricing_basis) values
      (e_stay, jsonb_build_object('name', 'Hotel Patio Azul', 'subtype', 'hotel',
        'accommodation_fields', jsonb_build_object('rooms', '4', 'guests', '8', 'breakfast', 'yes'),
        'dates', jsonb_build_object('start_date', '2027-09-16', 'end_date', '2027-09-20'),
        'travelers', jsonb_build_object('adults', 8),
        'vendor_source', 'liteapi', 'vendor_offer_id', 'seed_hotel_patio_azul',
        'price', 480, 'currency', 'EUR', 'pricing_basis', 'per_night'), 'user_proposed', ch, 480, 'per_night')
      returning id into o_stay_ch;
    insert into element_options (element_id, value, source, proposed_by, unit_price, pricing_basis) values
      (e_stay, jsonb_build_object('name', 'Triana Lofts', 'subtype', 'aparthotel',
        'accommodation_fields', jsonb_build_object('bedrooms', '4', 'beds', '8', 'bathrooms', '4', 'max_guests', '8'),
        'dates', jsonb_build_object('start_date', '2027-09-16', 'end_date', '2027-09-20'),
        'booking_link', 'https://trianalofts.example/book', 'price', 390, 'currency', 'EUR', 'pricing_basis', 'per_night'),
        'user_proposed', le, 390, 'per_night')
      returning id into o_stay_le;
    insert into element_options (element_id, value, source, proposed_by, unit_price, pricing_basis) values
      (e_train, jsonb_build_object('mode', 'bus', 'start_location', 'Madrid Estación Sur', 'destination_location', 'Sevilla Plaza de Armas',
        'depart_date', '2027-09-16', 'round_trip', true, 'return_date', '2027-09-20',
        'booking_link', 'https://buses.example/madrid-sevilla', 'price', 39, 'currency', 'EUR', 'pricing_basis', 'per_person'),
        'user_proposed', gr, 39, 'per_person')
      returning id into o_train_gr;
    insert into element_options (element_id, value, source, proposed_by, unit_price, pricing_basis) values
      (e_flight, jsonb_build_object('mode', 'flight', 'start_location', 'Amsterdam (AMS)', 'destination_location', 'Sevilla (SVQ)',
        'depart_date', '2027-09-16', 'depart_time', '13:40', 'arrival_time', '18:55', 'flight_number', 'CT 917 + 1 stop',
        'round_trip', true, 'return_date', '2027-09-20',
        'booking_link', 'https://flights.example/ams-svq', 'price', 175, 'currency', 'EUR', 'pricing_basis', 'per_person'),
        'user_proposed', sa, 175, 'per_person')
      returning id into o_flight_sa;
    insert into element_options (element_id, value, source, proposed_by, unit_price, pricing_basis) values
      (e_flamenco, jsonb_build_object('name', 'Tablao del Arenal', 'experience_subtype', 'concert_show',
        'date', '2027-09-17', 'time', '21:00', 'location_name', 'Barrio del Arenal, Sevilla',
        'booking_link', 'https://flamenco.example/arenal', 'price', 65, 'currency', 'EUR', 'pricing_basis', 'per_person'),
        'user_proposed', ch, 65, 'per_person')
      returning id into o_fl_ch;
    insert into element_options (element_id, value, source, proposed_by, unit_price, pricing_basis) values
      (e_flamenco, jsonb_build_object('name', 'Casa de la Guitarra', 'experience_subtype', 'concert_show',
        'date', '2027-09-17', 'time', '19:30', 'location_name', 'Santa Cruz, Sevilla',
        'booking_link', 'https://flamenco.example/guitarra', 'price', 38, 'currency', 'EUR', 'pricing_basis', 'per_person'),
        'user_proposed', st, 38, 'per_person')
      returning id into o_fl_st;
    insert into element_options (element_id, value, source, proposed_by) values
      (e_dinner, jsonb_build_object('name', 'Bodega Triana', 'price_tier', '$$', 'cuisine', 'Tapas',
        'date', '2027-09-18', 'dining_time', '21:00', 'guests', 8), 'user_proposed', le)
      returning id into o_din_le;
  end if;

  -- ---- votes (stage 2+) -----------------------------------------------------
  if p_stage >= 2 then
    -- Dates & destination: everyone votes
    for r in select unnest(everyone) as u loop
      perform public.zz_seed_as(r.u);
      perform public.cast_votes(e_dates, case when r.u in (m, gr) then array[o_dates_m, o_dates_ch] else array[o_dates_ch, o_dates_m] end);
      if p_stage >= 3 or r.u <> cl then
        perform public.cast_votes(e_dest, case when r.u = le then array[o_dest_le, o_dest_m] when r.u = st then array[o_dest_st, o_dest_m] else array[o_dest_m, o_dest_st] end);
      end if;
    end loop;
    -- Stay: Patio Azul wins; Matt hasn't voted yet at stage 2
    for r in select unnest(array[ch, sa, le, st, gr] || case when p_stage >= 3 then array[m, cl, se] else array[]::uuid[] end) as u loop
      perform public.zz_seed_as(r.u);
      perform public.cast_votes(e_stay, case when r.u = le then array[o_stay_le, o_stay_ch] when r.u = m then array[o_stay_m, o_stay_ch] else array[o_stay_ch, o_stay_m, o_stay_le] end);
    end loop;
    -- Train: the train wins
    for r in select unnest(array[ch, le, gr, st] || case when p_stage >= 3 then array[m, cl] else array[]::uuid[] end) as u loop
      perform public.zz_seed_as(r.u);
      perform public.cast_votes(e_train, case when r.u = gr then array[o_train_gr, o_train_m] else array[o_train_m] end);
    end loop;
    -- Flight: Serena and Sam
    perform public.zz_seed_as(se); perform public.cast_votes(e_flight, array[o_flight_se]);
    if p_stage >= 3 then perform public.zz_seed_as(sa); perform public.cast_votes(e_flight, array[o_flight_se, o_flight_sa]); end if;
    -- Flamenco: Tablao wins
    for r in select unnest(array[ch, sa, st, se, gr, le] || case when p_stage >= 3 then array[m, cl] else array[]::uuid[] end) as u loop
      perform public.zz_seed_as(r.u);
      perform public.cast_votes(e_flamenco, case when r.u = st then array[o_fl_st, o_fl_ch] else array[o_fl_ch, o_fl_st] end);
    end loop;
    -- Dinner: a few votes (the organizer decides at stage 4)
    for r in select unnest(array[ch, se, cl] || case when p_stage >= 3 then array[le, st] else array[]::uuid[] end) as u loop
      perform public.zz_seed_as(r.u);
      perform public.cast_votes(e_dinner, case when r.u = le then array[o_din_le, o_din_m] else array[o_din_m, o_din_le] end);
    end loop;
  end if;

  -- ---- locks ------------------------------------------------------------------
  if p_stage >= 3 then
    perform public.zz_seed_as(m);
    perform public.lock_element(e_dates, o_dates_ch);
    perform public.lock_element(e_dest, o_dest_m);
    update trip_elements set locked_via = 'vote' where id in (e_dates, e_dest);
    perform public.zz_seed_as(se);
    perform public.lock_element(e_flight, o_flight_se);   -- Locked by Creator
    -- Serena books her own sub-group's flight
    update funding_requests fr set purchaser_id = se from funding_request_elements fre
      where fre.funding_request_id = fr.id and fre.element_id = e_flight;
  end if;
  if p_stage >= 4 then
    perform public.zz_seed_as(m);
    perform public.lock_element(e_stay, o_stay_ch);
    perform public.lock_element(e_train, o_train_m);
    perform public.lock_element(e_flamenco, o_fl_ch);
    update trip_elements set locked_via = 'vote' where id in (e_stay, e_train, e_flamenco);
    perform public.lock_element(e_dinner, o_din_m);        -- Locked by Organizer
  end if;

  -- ---- deadlines for the open stages -----------------------------------------
  if p_stage = 1 then
    update trip_elements set options_deadline = now() + interval '20 hours', voting_deadline = now() + interval '5 days'
      where trip_id = t and state = 'open';
  elsif p_stage = 2 then
    update trip_elements set options_deadline = now() - interval '1 day', voting_deadline = now() + interval '3 days'
      where trip_id = t and state = 'open';
  elsif p_stage = 3 then
    update trip_elements set options_deadline = now() - interval '3 days', voting_deadline = now() + interval '6 hours'
      where trip_id = t and state = 'open';
  end if;

  -- ---- funding ------------------------------------------------------------------
  fund_dl := case p_stage
    when 3 then now() + interval '14 days'
    when 4 then now() + interval '14 days'
    when 5 then now() + interval '5 days'
    when 6 then now() + interval '3 days'
    when 7 then now() + interval '18 hours'
    else now() + interval '30 minutes' end;   -- 8+: pushed into the past after commits
  update funding_requests set funding_deadline = fund_dl where trip_id = t;

  if p_stage >= 5 then
    -- Stay (group split, booking-site price → cushion offered)
    for r in select * from (values
      (ch, 'percent', 15), (sa, 'none', 0), (le, 'percent', 15), (st, 'percent', 5), (gr, 'amount', 20),
      (se, 'percent', 15), (cl, 'none', 0), (m, 'percent', 15)) as x(u, kind, val) loop
      continue when p_stage in (5, 6) and r.u in (se, cl, m);
      continue when p_stage = 7 and r.u = m;
      perform public.zz_seed_as(r.u);
      select id into v_fr from funding_requests fr join funding_request_elements fre on fre.funding_request_id = fr.id where fre.element_id = e_stay;
      perform public.create_funding_mandate(v_fr, r.kind, r.val);
    end loop;
    -- Train (per person, fixed price)
    for r in select unnest(array[ch, le, cl, st, gr, m]) as u loop
      continue when p_stage in (5, 6) and r.u in (st, gr, m);
      continue when p_stage = 7 and r.u = m;
      perform public.zz_seed_as(r.u);
      select fr.id into v_fr from funding_requests fr join funding_request_elements fre on fre.funding_request_id = fr.id where fre.element_id = e_train;
      perform public.create_funding_mandate(v_fr);
    end loop;
    -- Flight (Serena's sub-group, booking-site price)
    for r in select * from (values (se, 'percent', 15), (sa, 'none', 0)) as x(u, kind, val) loop
      continue when p_stage in (5, 6) and r.u = sa;
      perform public.zz_seed_as(r.u);
      select fr.id into v_fr from funding_requests fr join funding_request_elements fre on fre.funding_request_id = fr.id where fre.element_id = e_flight;
      perform public.create_funding_mandate(v_fr, r.kind, r.val);
    end loop;
    -- Flamenco: 5 spots — first five in; Matt, Lena, Claudia are waitlisted
    for r in select unnest(array[ch, sa, st, se, gr]) as u loop
      perform public.zz_seed_as(r.u);
      select fr.id into v_fr from funding_requests fr join funding_request_elements fre on fre.funding_request_id = fr.id where fre.element_id = e_flamenco;
      perform public.create_funding_mandate(v_fr);
      update funding_mandates set status = 'active', activated_at = now(), payment_method_type = 'card'
        where funding_request_id = v_fr and status = 'pending';
    end loop;
    -- Dinner deposit
    for r in select unnest(array[m, ch, se, cl, le, sa, st, gr]) as u loop
      continue when p_stage in (5, 6) and r.u in (le, sa, st, gr);
      continue when p_stage = 7 and r.u = m;
      perform public.zz_seed_as(r.u);
      select fr.id into v_fr from funding_requests fr join funding_request_elements fre on fre.funding_request_id = fr.id where fre.element_id = e_dinner;
      perform public.create_funding_mandate(v_fr);
    end loop;
    -- What Stripe does on a successful card authorization
    update funding_mandates fm set status = 'active', activated_at = now() - interval '1 day', payment_method_type = 'card'
      from funding_requests fr where fr.id = fm.funding_request_id and fr.trip_id = t and fm.status = 'pending';
  end if;

  -- Withdrawals (stage 6): Greg from the stay (group split → pause),
  -- Claudia from the train (per person → place released)
  if p_stage = 6 then
    perform public.zz_seed_as(gr);
    select fm.id into v_mid from funding_mandates fm join funding_request_elements fre on fre.funding_request_id = fm.funding_request_id
      where fre.element_id = e_stay and fm.participant_id = gr and fm.status = 'active';
    perform public.cancel_funding_mandate(v_mid);
    update funding_mandates set canceled_at = now() - interval '3 hours' where id = v_mid;
    perform public.zz_seed_as(cl);
    select fm.id into v_mid from funding_mandates fm join funding_request_elements fre on fre.funding_request_id = fm.funding_request_id
      where fre.element_id = e_train and fm.participant_id = cl and fm.status = 'active';
    perform public.cancel_funding_mandate(v_mid);
  end if;

  -- Stage 8: the deadline has passed. The stay is still committing (Stella's
  -- card was declined, 21h left to fix it); everything else charged.
  if p_stage >= 8 then
    update funding_requests set funding_deadline = now() - interval '3 hours' where trip_id = t;
    funded_elements := case when p_stage = 8 then array[e_train, e_flight, e_flamenco, e_dinner]
                            else array[e_stay, e_train, e_flight, e_flamenco, e_dinner] end;
    if p_stage = 8 then
      update funding_requests fr set charge_status = 'charging', charge_started_at = now() - interval '3 hours',
          fully_mandated_at = now() - interval '3 hours', retry_deadline = now() + interval '21 hours',
          hold_cap_at = now() + interval '5 days'
        from funding_request_elements fre where fre.funding_request_id = fr.id and fre.element_id = e_stay;
      update funding_mandates fm set status = case when fm.participant_id = st then 'awaiting_retry' else 'held' end,
          retry_reason = case when fm.participant_id = st then 'payment_method_failed' end,
          held_at = case when fm.participant_id = st then null else now() - interval '3 hours' end,
          hold_attempt = 1
        from funding_request_elements fre
        where fre.funding_request_id = fm.funding_request_id and fre.element_id = e_stay and fm.status = 'active';
    end if;
    -- Charged: contributions recorded, request funded
    insert into funding_contributions (funding_request_id, contributor_id, amount, platform_fee, source, mandate_id, payment_method_type, created_at)
    select fm.funding_request_id, fm.participant_id, fr.individual_amount,
           round(fr.individual_amount * fr.platform_fee_percent / 100, 2), 'stripe', fm.id, 'card', now() - interval '2 hours'
    from funding_mandates fm
    join funding_requests fr on fr.id = fm.funding_request_id
    join funding_request_elements fre on fre.funding_request_id = fr.id
    where fre.element_id = any(funded_elements) and fm.status = 'active';
    update funding_mandates fm set status = 'charge_succeeded', charged_at = now() - interval '2 hours'
      from funding_request_elements fre
      where fre.funding_request_id = fm.funding_request_id and fre.element_id = any(funded_elements) and fm.status = 'active';
    update funding_requests fr set status = 'ready_to_purchase', charge_status = 'charged',
        charge_started_at = now() - interval '3 hours', fully_mandated_at = now() - interval '3 hours'
      from funding_request_elements fre where fre.funding_request_id = fr.id and fre.element_id = any(funded_elements);
  end if;

  -- Stage 10: everything booked, with booking records
  if p_stage >= 10 then
    update funding_requests set status = 'booked', booked_at = now() - interval '1 hour', actual_amount_paid = required_amount
      where trip_id = t;
    update trip_elements set booked_at = now() - interval '1 hour' where trip_id = t and type not in ('dates', 'destination');
    insert into element_bookings (element_id, vendor, confirmation_ref, starts_at, ends_at, address, checkin_instructions,
        cancellation_deadline, cancellation_policy, lead_booker_id, amount_charged, currency, source, field_provenance,
        confirmed_at, confirmed_by, booked_at, fulfillment_mode, notes)
    values
      (e_stay, 'Hotel Patio Azul', 'PA-27-48213', '2027-09-16 15:00+02', '2027-09-20 11:00+02', 'Calle Betis 52, 41010 Sevilla',
        'Reception open 24h. Four rooms under the lead guest''s name.', '2027-09-09 23:59+02', 'Free cancellation until 7 days before arrival.',
        m, 1920, 'EUR', 'manual', '{}'::jsonb, now() - interval '1 hour', m, now() - interval '1 hour', 'affiliate_redirect', null),
      (e_train, 'Iberrail', 'IR-5Q7K2M', '2027-09-16 08:30+02', '2027-09-16 11:05+02', 'Madrid Atocha → Sevilla Santa Justa',
        'Seats coach 6, 21–26. Return 20 Sep 17:00.', null, 'Changes allowed up to 24h before departure.',
        m, 510, 'EUR', 'manual', '{}'::jsonb, now() - interval '1 hour', m, now() - interval '1 hour', 'affiliate_redirect', null),
      (e_flight, 'Cielo Air', 'CT-Q8MZ4P', '2027-09-16 07:10+02', '2027-09-16 10:05+02', 'Amsterdam (AMS) → Sevilla (SVQ)',
        'Check in online 24h before. Return 20 Sep.', null, 'Non-refundable.',
        se, 420, 'EUR', 'manual', '{}'::jsonb, now() - interval '1 hour', se, now() - interval '1 hour', 'affiliate_redirect', null),
      (e_flamenco, 'Tablao del Arenal', 'TA-0917-05', '2027-09-17 21:00+02', '2027-09-17 22:30+02', 'Calle Rodo 7, 41001 Sevilla',
        'Doors 20:30. Five seats, front row.', '2027-09-15 23:59+02', 'Free cancellation until 48h before.',
        ch, 325, 'EUR', 'manual', '{}'::jsonb, now() - interval '1 hour', ch, now() - interval '1 hour', 'affiliate_redirect', null),
      (e_dinner, 'La Azotea Real', 'AR-2109-8', '2027-09-18 21:30+02', '2027-09-18 23:59+02', 'Calle Mateos Gago 8, 41004 Sevilla',
        'Rooftop table for 8. Deposit paid; the rest is paid at the restaurant.', '2027-09-16 23:59+02', 'Deposit refundable until 48h before.',
        m, 320, 'EUR', 'manual', '{}'::jsonb, now() - interval '1 hour', m, now() - interval '1 hour', 'affiliate_redirect',
        'Remaining bill paid at the restaurant.');
  end if;

  update trips set status = case when p_stage >= 10 then 'going' when p_stage >= 4 then 'financing' else 'planning' end where id = t;
  perform set_config('request.jwt.claims', '', true);
  return t;
end;
$fn$;
revoke execute on function public.zz_seed_journey_trip(text, int) from public, anon, authenticated;
revoke execute on function public.zz_seed_as(uuid) from public, anon, authenticated;
