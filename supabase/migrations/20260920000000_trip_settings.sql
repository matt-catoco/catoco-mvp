-- ============================================================================
-- Trip settings: rename, icon change, delete.
--
-- §1: two authority levels. Rename/icon = is_trip_organizer() (organizer or
-- co-organizer), matching the existing edit/delete-element precedent.
-- Delete = auth.uid() = organizer_id strictly, matching the DB's actual
-- current RLS on trips ("Organizer manages own trips") -- deletion is
-- uniquely irreversible and wipes every participant's contribution
-- history, not just the organizer's own data.
--
-- §3: delete is blocked while a non-superseded, non-refunded
-- funding_request under the trip either has status ready_to_purchase/
-- booked, or has at least one funding_contributions row (someone's money
-- is on the line even if it never reached 100%). funding_requests.
-- refunded_at is a manual overlay flag (mark_funding_request_refunded(),
-- organizer/co-organizer) standing in for real payment processing until
-- that exists -- delete_trip() only ever reads refunded_at, so swapping in
-- a real refund flow later never touches this function.
-- ============================================================================

alter table public.funding_requests
  add column if not exists refunded_at timestamptz;

-- ---- update_trip: rename / icon change, organizer or co-organizer -------
-- p_set_icon exists because p_icon itself needs to be able to carry a real
-- null (IconPicker's "Remove" clears the icon entirely) -- without a
-- separate flag, "p_icon omitted, leave the icon alone" and "p_icon passed
-- as null to clear it" would both arrive as the same SQL NULL, indistin-
-- guishable inside the function. p_set_icon just says which one this is.
create or replace function public.update_trip(
  p_trip_id uuid,
  p_name text default null,
  p_icon text default null,
  p_set_icon boolean default false
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
    update public.trips set icon = p_icon where id = p_trip_id;
  end if;
end;
$$;

-- ---- mark_funding_request_refunded: manual overlay flag ------------------
create or replace function public.mark_funding_request_refunded(p_funding_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
begin
  select trip_id into v_trip_id from public.funding_requests where id = p_funding_request_id;
  if v_trip_id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_trip_organizer(v_trip_id) then
    raise exception 'only the organizer or a co-organizer can mark this refunded';
  end if;

  update public.funding_requests set refunded_at = now() where id = p_funding_request_id;
end;
$$;

-- ---- delete_trip: organizer only, blocked on unrefunded funded elements --
create or replace function public.delete_trip(p_trip_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_organizer_id uuid;
  v_blocking_labels text;
begin
  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    raise exception 'trip not found';
  end if;
  if auth.uid() <> v_organizer_id then
    raise exception 'only the organizer can delete this trip';
  end if;

  select string_agg(distinct e.label, ', ' order by e.label)
    into v_blocking_labels
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    join public.trip_elements e on e.id = fre.element_id
    where fr.trip_id = p_trip_id
      and fr.status <> 'superseded'
      and fr.refunded_at is null
      and (
        fr.status in ('ready_to_purchase', 'booked')
        or exists (
          select 1 from public.funding_contributions fc where fc.funding_request_id = fr.id
        )
      );

  if v_blocking_labels is not null then
    raise exception 'Can''t delete — these elements still have unrefunded funding: %. Mark them refunded first.', v_blocking_labels;
  end if;

  -- Every other table cascades cleanly via existing FKs (trip_elements,
  -- element_options, element_participants, votes, trip_participants,
  -- funding_requests, funding_request_elements, funding_contributions) --
  -- confirmed against every relevant migration. The icon storage object
  -- (if any) is cleaned up client-side before this call, same as an icon
  -- replacement -- storage isn't reachable from inside Postgres.
  delete from public.trips where id = p_trip_id;
end;
$$;

notify pgrst, 'reload schema';
