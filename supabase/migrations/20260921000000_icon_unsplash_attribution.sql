-- ============================================================================
-- "Add an image" — Unsplash search alongside upload for trip icons.
--
-- trips.icon gets a third representation (on top of preset:<id> [retired]
-- and a bare trip-icons storage path): a full https:// URL, an Unsplash
-- photo's own photo.urls.regular value used exactly as returned, per their
-- hotlinking requirement -- no download-and-reupload into the storage
-- bucket. trips.icon_attribution carries the photographer credit that has
-- to render wherever the icon is shown, populated only when the icon came
-- from Unsplash.
--
-- update_trip() (from the just-shipped trip-settings migration) gets a new
-- trailing p_icon_attribution param, set together with icon whenever
-- p_set_icon is true -- switching to an upload or clearing the icon nulls
-- attribution out in the same statement, never left stale. Same overload
-- lesson as create_element/create_trip_batch earlier this session: drop
-- the old 4-arg version explicitly so exactly one ever exists.
-- ============================================================================

alter table public.trips
  add column if not exists icon_attribution jsonb;

create or replace function public.update_trip(
  p_trip_id uuid,
  p_name text default null,
  p_icon text default null,
  p_set_icon boolean default false,
  p_icon_attribution jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can update this trip';
  end if;

  if p_name is not null then
    if btrim(p_name) = '' then
      raise exception 'give the trip a name';
    end if;
    update public.trips set name = btrim(p_name) where id = p_trip_id;
  end if;

  if p_set_icon then
    update public.trips
      set icon = p_icon, icon_attribution = p_icon_attribution
      where id = p_trip_id;
  end if;
end;
$$;

drop function if exists public.update_trip(uuid, text, text, boolean);

notify pgrst, 'reload schema';
