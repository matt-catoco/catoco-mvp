-- ============================================================================
-- Flow #4 follow-up §1: booking confirmation details + attachment.
--
-- Stored on trip_elements (not funding_requests): every locked element can
-- be marked booked, including Dates/Destination and unpriced ones that
-- never get a funding_request. trip_elements' existing member-scoped SELECT
-- policy already makes the text visible to the whole trip.
--
-- Attachments: a PRIVATE bucket with NO storage.objects policies at all —
-- signed-in users can neither list, read nor write it directly. The server
-- (service role) issues a short-lived signed UPLOAD url only after
-- can_report_element_booked() passes for the caller, and short-lived signed
-- READ urls only for someone whose own RLS-scoped query could load the
-- element. Deliberately NOT the trip-icons pattern: that bucket is
-- public-read, and a confirmation screenshot can carry PII (confirmation
-- numbers, billing address, partial card digits).
--
-- Column is confirmation_attachment_PATH, not _url: for a private bucket a
-- stored URL would either be public (wrong) or a signed one that expires.
-- The object path is stored; URLs are minted on read.
--
-- report_element_booked() gains two trailing optional params. Same lesson
-- as create_element: CREATE OR REPLACE with a new argument list makes a
-- second overload (ambiguous for PostgREST named calls), so the 3-arg
-- version is dropped in the same migration. Existing callers passing only
-- the first three named params resolve to the new one unchanged.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'booking-confirmations', 'booking-confirmations', false, 10485760,
  array['image/png', 'image/jpeg', 'image/webp', 'application/pdf']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

alter table public.trip_elements
  add column if not exists confirmation_details text,
  add column if not exists confirmation_attachment_path text;

-- Same authority rule report_element_booked() applies: purchaser or
-- organizer/co-organizer when an active funding_request exists, the
-- element's creator or organizer/co-organizer otherwise.
create or replace function public.can_report_element_booked(p_element_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip_id uuid;
  v_created_by uuid;
  v_purchaser_id uuid;
  v_has_fr boolean;
begin
  if v_uid is null then
    return false;
  end if;
  select trip_id, created_by into v_trip_id, v_created_by
    from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    return false;
  end if;
  if public.is_trip_organizer(v_trip_id) then
    return true;
  end if;

  select true, fr.purchaser_id into v_has_fr, v_purchaser_id
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    where fre.element_id = p_element_id
      and fr.status in ('collecting', 'ready_to_purchase')
    limit 1;

  if coalesce(v_has_fr, false) then
    return v_uid = v_purchaser_id;
  end if;
  return v_uid = v_created_by;
end;
$$;
grant execute on function public.can_report_element_booked(uuid) to authenticated;

drop function if exists public.report_element_booked(uuid, text, numeric);

create or replace function public.report_element_booked(
  p_element_id uuid,
  p_outcome text,
  p_actual_amount_paid numeric default null,
  p_confirmation_details text default null,
  p_confirmation_attachment_path text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip_id uuid;
  v_created_by uuid;
  v_state text;
  v_fr_id uuid;
  v_purchaser_id uuid;
  v_fr_status text;
  v_required numeric;
  v_refund_requested timestamptz;
  v_details text := nullif(btrim(coalesce(p_confirmation_details, '')), '');
  v_path text := nullif(btrim(coalesce(p_confirmation_attachment_path, '')), '');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_outcome not in ('booked', 'unavailable') then
    raise exception 'bad outcome: %', p_outcome;
  end if;

  select trip_id, created_by, state into v_trip_id, v_created_by, v_state
    from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if v_state <> 'locked' then
    raise exception 'element must be locked before it can be reported';
  end if;

  if v_details is not null and length(v_details) > 4000 then
    raise exception 'confirmation details are too long (4000 characters max)';
  end if;
  -- The attachment must be one issued for THIS element (signed-upload
  -- paths are {trip_id}/{element_id}/...), never an arbitrary object.
  if v_path is not null and v_path not like (v_trip_id::text || '/' || p_element_id::text || '/%') then
    raise exception 'invalid confirmation attachment';
  end if;

  select fr.id, fr.purchaser_id, fr.status, fr.required_amount, fr.refund_all_requested_at
    into v_fr_id, v_purchaser_id, v_fr_status, v_required, v_refund_requested
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    where fre.element_id = p_element_id
      and fr.status in ('collecting', 'ready_to_purchase')
    limit 1;

  if v_fr_id is not null then
    if not (v_uid = v_purchaser_id or public.is_trip_organizer(v_trip_id)) then
      raise exception 'only the purchaser, organizer, or co-organizer can report this';
    end if;
    if p_outcome = 'booked' and v_fr_status <> 'ready_to_purchase' then
      raise exception 'funding is not ready to purchase yet';
    end if;
    if p_outcome = 'booked' and v_refund_requested is not null then
      raise exception 'this pool has been refunded — it can''t be marked booked';
    end if;
  else
    if not (v_uid = v_created_by or public.is_trip_organizer(v_trip_id)) then
      raise exception 'only the organizer, a co-organizer, or the element''s creator can report this';
    end if;
  end if;

  if p_outcome = 'unavailable' then
    perform public.cascade_element_unavailable(p_element_id);
    return;
  end if;

  update public.trip_elements
    set booked_at = now(),
        confirmation_details = v_details,
        confirmation_attachment_path = v_path
    where id = p_element_id;

  if v_fr_id is not null then
    update public.funding_requests
      set status = 'booked',
          actual_amount_paid = coalesce(p_actual_amount_paid, v_required),
          booked_at = now()
      where id = v_fr_id;
  end if;
end;
$$;
grant execute on function public.report_element_booked(uuid, text, numeric, text, text) to authenticated;

notify pgrst, 'reload schema';
