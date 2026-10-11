-- ============================================================================
-- Auto label from the locked option's subtype (founder, 2026-10-11).
--
-- A Travel element locked with a flight is labelled "Flight" (badge stays
-- "Tr"), an Accommodation locked with a hotel "Hotel", an Experience its
-- category ("Class/Workshop"), unless someone gave the element their own
-- name. "Their own name" = anything other than the type's default label or
-- one of these auto labels, so a later re-lock to a different mode still
-- updates an auto label but never a custom one. "Other" subtypes keep the
-- default label. Labels mirror lib/trip-elements.ts (TRAVEL_MODE_LABELS,
-- ACCOMMODATION_SUBTYPE_LABELS, EXPERIENCE_SUBTYPE_LABELS).
-- ============================================================================

create or replace function public.element_subtype_label(p_type text, p_value jsonb)
returns text
language sql
immutable
as $$
  select case p_type
    when 'travel' then case p_value->>'mode'
      when 'flight' then 'Flight'
      when 'train' then 'Train'
      when 'bus' then 'Bus'
      when 'rental_car' then 'Rental car'
      when 'ferry' then 'Ferry'
    end
    when 'accommodation' then case p_value->>'subtype'
      when 'hotel' then 'Hotel'
      when 'bnb' then 'B&B'
      when 'home_apartment' then 'Home/apartment'
      when 'villa' then 'Villa'
      when 'chalet' then 'Chalet'
      when 'cabin_cottage' then 'Cabin/Cottage'
      when 'guesthouse' then 'Guesthouse'
      when 'hostel' then 'Hostel'
      when 'glamping' then 'Glamping'
      when 'hut' then 'Hut'
      when 'camper_van' then 'Camper van/RV'
      when 'boat_houseboat' then 'Boat/houseboat'
      when 'campsite' then 'Campsite'
      when 'farm_stay' then 'Farm stay'
      when 'aparthotel' then 'Aparthotel'
      when 'resort' then 'Resort'
    end
    when 'experience' then case p_value->>'experience_subtype'
      when 'tour_sightseeing' then 'Tour/Sightseeing'
      when 'sporting_event' then 'Sporting event'
      when 'concert_show' then 'Concert/Show'
      when 'museum_attraction' then 'Museum/Attraction'
      when 'outdoor_adventure' then 'Outdoor/Adventure'
      when 'class_workshop' then 'Class/Workshop'
      when 'nightlife' then 'Nightlife'
    end
  end;
$$;

-- Is this label still automatic (the type default or one of its auto labels)?
create or replace function public.element_label_is_auto(p_type text, p_label text)
returns boolean
language sql
immutable
as $$
  select coalesce(trim(p_label), '') = ''
    or trim(p_label) = case p_type
      when 'travel' then 'Travel'
      when 'accommodation' then 'Accommodations'
      when 'experience' then 'Experiences'
      when 'dining' then 'Dining'
      else null
    end
    or trim(p_label) in (
      'Flight', 'Train', 'Bus', 'Rental car', 'Ferry',
      'Hotel', 'B&B', 'Home/apartment', 'Villa', 'Chalet', 'Cabin/Cottage', 'Guesthouse', 'Hostel',
      'Glamping', 'Hut', 'Camper van/RV', 'Boat/houseboat', 'Campsite', 'Farm stay', 'Aparthotel', 'Resort',
      'Tour/Sightseeing', 'Sporting event', 'Concert/Show', 'Museum/Attraction', 'Outdoor/Adventure',
      'Class/Workshop', 'Nightlife'
    );
$$;

-- On lock / re-lock: relabel an automatic label from the locked option.
create or replace function public.trip_elements_auto_label()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_value jsonb;
  v_label text;
begin
  if new.locked_option_id is null or not public.element_label_is_auto(new.type, new.label) then
    return new;
  end if;
  select o.value into v_value from public.element_options o where o.id = new.locked_option_id;
  v_label := public.element_subtype_label(new.type, v_value);
  if v_label is not null then
    new.label := v_label;
  end if;
  return new;
end;
$$;

drop trigger if exists trip_elements_auto_label on public.trip_elements;
create trigger trip_elements_auto_label
  before insert or update of locked_option_id on public.trip_elements
  for each row execute function public.trip_elements_auto_label();

-- Editing the locked option itself (e.g. its mode) relabels too.
create or replace function public.element_options_auto_label()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.value is not distinct from old.value then
    return new;
  end if;
  update public.trip_elements e
     set label = public.element_subtype_label(e.type, new.value)
   where e.locked_option_id = new.id
     and public.element_subtype_label(e.type, new.value) is not null
     and public.element_label_is_auto(e.type, e.label)
     and e.label is distinct from public.element_subtype_label(e.type, new.value);
  return new;
end;
$$;

drop trigger if exists element_options_auto_label on public.element_options;
create trigger element_options_auto_label
  after update of value on public.element_options
  for each row execute function public.element_options_auto_label();

-- Backfill: already-locked elements still on an automatic label.
update public.trip_elements e
   set label = public.element_subtype_label(e.type, o.value)
  from public.element_options o
 where o.id = e.locked_option_id
   and public.element_subtype_label(e.type, o.value) is not null
   and public.element_label_is_auto(e.type, e.label)
   and e.label is distinct from public.element_subtype_label(e.type, o.value);
