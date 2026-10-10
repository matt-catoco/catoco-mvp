-- ============================================================================
-- Booked elements, phase 1 (founder, 2026-10-10): booking record, inbound
-- confirmation email, traveler details, Issuing card log, deferred charges.
--
-- Decisions: Issuing cardholder = one individual cardholder per purchaser;
-- traveler details deleted 90 days after the trip ends; deferred funding
-- buffer 7 days; one lead guest per booking. No API order creation here.
--
--  * element_bookings: one structured record per booked element, replacing
--    trip_elements.confirmation_details / confirmation_attachment_path
--    (backfilled below, then dropped). An element can be marked Booked only
--    once its record has a vendor AND (a confirmation reference OR a
--    document), and someone allowed to book it confirmed the fields.
--  * Visibility: everyone scoped into the element, plus organizers and the
--    purchaser (who may not be travelling on it). Raw inbound emails and
--    card records: organizers + purchaser only.
--  * Traveler details: ciphertext only (app-side AES-256-GCM), no RLS
--    policies at all — read/written exclusively by server code with the
--    service role after its own checks, every non-self decrypt logged.
--  * Deferred (pay-later / pay-at-property): the organizer books first; the
--    funding deadline becomes min(supplier charge start, free-cancel
--    deadline) - 7 days, and the existing charge job collects then.
-- ============================================================================

-- ---- who may edit / view a booking record -----------------------------------
-- Edit: organizer/co-organizer; the purchaser of a live (non-superseded)
-- funding request for the element; with no funding request, its creator.
create or replace function public.can_edit_element_booking(p_element_id uuid)
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
  v_has_fr boolean := false;
  v_purchaser uuid;
begin
  if v_uid is null then
    return false;
  end if;
  select trip_id, created_by into v_trip_id, v_created_by from public.trip_elements where id = p_element_id;
  if v_trip_id is null then
    return false;
  end if;
  if public.is_trip_organizer(v_trip_id) then
    return true;
  end if;
  select true, fr.purchaser_id into v_has_fr, v_purchaser
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    where fre.element_id = p_element_id and fr.status <> 'superseded'
    order by fr.created_at desc limit 1;
  if coalesce(v_has_fr, false) then
    return v_uid = v_purchaser;
  end if;
  return v_uid = v_created_by;
end;
$$;
grant execute on function public.can_edit_element_booking(uuid) to authenticated;

create or replace function public.can_view_element_booking(p_element_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_element_scoped(p_element_id) or public.can_edit_element_booking(p_element_id);
$$;
grant execute on function public.can_view_element_booking(uuid) to authenticated;

-- ---- the booking record -------------------------------------------------------
create table if not exists public.element_bookings (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null unique references public.trip_elements(id) on delete cascade,
  vendor text,
  confirmation_ref text,
  starts_at timestamptz,
  ends_at timestamptz,
  address text,
  checkin_instructions text,
  cancellation_deadline timestamptz,
  cancellation_policy text,
  notes text,
  document_path text,
  lead_booker_id uuid references auth.users(id) on delete set null,
  amount_charged numeric check (amount_charged is null or amount_charged >= 0),
  currency text,
  source text not null default 'manual' check (source in ('api', 'email', 'upload', 'manual')),
  -- per field: 'extracted' (parsed from a document, organizer-confirmed) or 'entered'
  field_provenance jsonb not null default '{}'::jsonb,
  -- what extraction produced before the organizer confirmed/edited it (audit)
  extracted_raw jsonb,
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id) on delete set null,
  -- legal routing (data only — nothing branches on these yet)
  fulfillment_mode text check (fulfillment_mode in ('affiliate_redirect', 'api_order', 'api_order_card', 'issuing_manual', 'issuing_agent')),
  seller_of_record text check (seller_of_record in ('supplier', 'catoco')),
  -- deferred charges (pay later / pay at property)
  payment_timing text not null default 'pay_now' check (payment_timing in ('pay_now', 'pay_later', 'pay_at_property')),
  booked_at timestamptz,
  funding_due_at timestamptz,
  supplier_charge_window_start timestamptz,
  supplier_charge_window_end timestamptz,
  -- amounts the guest pays at the property (city tax, resort fee) — not on our card
  paid_at_property_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.element_bookings enable row level security;
drop policy if exists element_bookings_select on public.element_bookings;
create policy element_bookings_select on public.element_bookings
  for select to authenticated using (public.can_view_element_booking(element_id));
-- writes only through the RPCs below / the service role

-- backfill existing confirmations, then retire the old columns
insert into public.element_bookings (element_id, vendor, notes, document_path, source, confirmed_at, booked_at, amount_charged, currency, fulfillment_mode, seller_of_record)
select e.id,
       coalesce(nullif(btrim(o.value->>'title'), ''), nullif(btrim(o.value->>'name'), ''), e.label),
       e.confirmation_details,
       e.confirmation_attachment_path,
       case when e.confirmation_attachment_path is not null then 'upload' else 'manual' end,
       e.booked_at,
       e.booked_at,
       fr.actual_amount_paid,
       coalesce(fr.currency, o.value->>'currency'),
       'affiliate_redirect',
       'supplier'
from public.trip_elements e
left join public.element_options o on o.id = e.locked_option_id
left join lateral (
  select f.actual_amount_paid, f.currency from public.funding_request_elements fre
  join public.funding_requests f on f.id = fre.funding_request_id
  where fre.element_id = e.id and f.status = 'booked' order by f.created_at desc limit 1
) fr on true
where e.booked_at is not null
on conflict (element_id) do nothing;

alter table public.trip_elements drop column if exists confirmation_details;
alter table public.trip_elements drop column if exists confirmation_attachment_path;

-- ---- save (and optionally confirm + mark booked) ------------------------------
-- p_record keys (all optional): vendor, confirmation_ref, starts_at, ends_at,
-- address, checkin_instructions, cancellation_deadline, cancellation_policy,
-- notes, document_path, lead_booker_id, amount_charged, currency, source,
-- field_provenance (object), paid_at_property_note, fulfillment_mode,
-- seller_of_record. Missing keys keep their stored value.
create or replace function public.save_element_booking(
  p_element_id uuid, p_record jsonb, p_confirm boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_trip_id uuid;
  v_id uuid;
  v_path text := nullif(btrim(coalesce(p_record->>'document_path', '')), '');
  v_row public.element_bookings%rowtype;
begin
  if not public.can_edit_element_booking(p_element_id) then
    raise exception 'only the organizer, a co-organizer, or the purchaser can record this booking';
  end if;
  select trip_id into v_trip_id from public.trip_elements where id = p_element_id and state = 'locked';
  if v_trip_id is null then
    raise exception 'the element must be locked first';
  end if;
  if v_path is not null and v_path not like (v_trip_id::text || '/' || p_element_id::text || '/%') then
    raise exception 'invalid confirmation document';
  end if;
  if p_record ? 'lead_booker_id' and nullif(p_record->>'lead_booker_id', '') is not null
     and not exists (select 1 from public.get_trip_roster(v_trip_id) r where r.user_id = (p_record->>'lead_booker_id')::uuid) then
    raise exception 'the lead booker must be on the trip';
  end if;

  insert into public.element_bookings (element_id) values (p_element_id)
    on conflict (element_id) do nothing;

  update public.element_bookings b set
    vendor = case when p_record ? 'vendor' then nullif(left(btrim(p_record->>'vendor'), 200), '') else b.vendor end,
    confirmation_ref = case when p_record ? 'confirmation_ref' then nullif(left(btrim(p_record->>'confirmation_ref'), 100), '') else b.confirmation_ref end,
    starts_at = case when p_record ? 'starts_at' then nullif(p_record->>'starts_at', '')::timestamptz else b.starts_at end,
    ends_at = case when p_record ? 'ends_at' then nullif(p_record->>'ends_at', '')::timestamptz else b.ends_at end,
    address = case when p_record ? 'address' then nullif(left(btrim(p_record->>'address'), 500), '') else b.address end,
    checkin_instructions = case when p_record ? 'checkin_instructions' then nullif(left(btrim(p_record->>'checkin_instructions'), 2000), '') else b.checkin_instructions end,
    cancellation_deadline = case when p_record ? 'cancellation_deadline' then nullif(p_record->>'cancellation_deadline', '')::timestamptz else b.cancellation_deadline end,
    cancellation_policy = case when p_record ? 'cancellation_policy' then nullif(left(btrim(p_record->>'cancellation_policy'), 2000), '') else b.cancellation_policy end,
    notes = case when p_record ? 'notes' then nullif(left(btrim(p_record->>'notes'), 4000), '') else b.notes end,
    document_path = case when p_record ? 'document_path' then v_path else b.document_path end,
    lead_booker_id = case when p_record ? 'lead_booker_id' then nullif(p_record->>'lead_booker_id', '')::uuid else b.lead_booker_id end,
    amount_charged = case when p_record ? 'amount_charged' then nullif(p_record->>'amount_charged', '')::numeric else b.amount_charged end,
    currency = case when p_record ? 'currency' then nullif(upper(btrim(p_record->>'currency')), '') else b.currency end,
    source = case when p_record ? 'source' then p_record->>'source' else b.source end,
    field_provenance = case when p_record ? 'field_provenance' then b.field_provenance || (p_record->'field_provenance') else b.field_provenance end,
    paid_at_property_note = case when p_record ? 'paid_at_property_note' then nullif(left(btrim(p_record->>'paid_at_property_note'), 500), '') else b.paid_at_property_note end,
    fulfillment_mode = case when p_record ? 'fulfillment_mode' then p_record->>'fulfillment_mode' else b.fulfillment_mode end,
    seller_of_record = case when p_record ? 'seller_of_record' then p_record->>'seller_of_record' else b.seller_of_record end,
    updated_at = now()
  where b.element_id = p_element_id
  returning * into v_row;

  if p_confirm then
    if v_row.vendor is null or (v_row.confirmation_ref is null and v_row.document_path is null) then
      raise exception 'add the vendor and a confirmation reference or document before confirming';
    end if;
    update public.element_bookings
      set confirmed_at = now(), confirmed_by = v_uid
      where element_id = p_element_id;
  end if;
  return v_row.id;
end;
$$;
grant execute on function public.save_element_booking(uuid, jsonb, boolean) to authenticated;

-- ---- report_element_booked: Booked now requires a confirmed record -------------
drop function if exists public.report_element_booked(uuid, text, numeric, text, text);
create or replace function public.report_element_booked(
  p_element_id uuid,
  p_outcome text,
  p_actual_amount_paid numeric default null
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
  v_b public.element_bookings%rowtype;
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

  select * into v_b from public.element_bookings where element_id = p_element_id;
  if v_b.id is null or v_b.confirmed_at is null or v_b.vendor is null
     or (v_b.confirmation_ref is null and v_b.document_path is null) then
    raise exception 'record the booking first — at least the vendor and a confirmation reference or document';
  end if;

  update public.trip_elements set booked_at = now() where id = p_element_id;
  update public.element_bookings
    set booked_at = coalesce(booked_at, now()),
        amount_charged = coalesce(amount_charged, p_actual_amount_paid, v_required),
        updated_at = now()
    where element_id = p_element_id;

  if v_fr_id is not null then
    update public.funding_requests
      set status = 'booked',
          actual_amount_paid = coalesce(p_actual_amount_paid, v_b.amount_charged, v_required),
          booked_at = now()
      where id = v_fr_id;
  end if;
end;
$$;
grant execute on function public.report_element_booked(uuid, text, numeric) to authenticated;

-- ---- inbound confirmation email ---------------------------------------------
alter table public.trip_elements add column if not exists inbound_token text unique;

-- Unguessable per-element forwarding token, created on first ask.
create or replace function public.ensure_element_inbound_token(p_element_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  if not public.can_edit_element_booking(p_element_id) then
    raise exception 'only the organizer or purchaser can get the forwarding address';
  end if;
  select inbound_token into v_token from public.trip_elements where id = p_element_id;
  if v_token is null then
    v_token := lower(replace(gen_random_uuid()::text, '-', '')) || substr(md5(random()::text), 1, 8);
    update public.trip_elements set inbound_token = v_token where id = p_element_id and inbound_token is null;
    select inbound_token into v_token from public.trip_elements where id = p_element_id;
  end if;
  return v_token;
end;
$$;
grant execute on function public.ensure_element_inbound_token(uuid) to authenticated;

create table if not exists public.inbound_booking_emails (
  id uuid primary key default gen_random_uuid(),
  element_id uuid references public.trip_elements(id) on delete cascade,
  token text not null,
  resend_email_id text unique,
  from_address text,
  subject text,
  sender_verified boolean not null default false,
  raw_message_path text,
  attachments jsonb not null default '[]'::jsonb,
  extracted jsonb,
  status text not null default 'quarantined' check (status in ('quarantined', 'parsed', 'confirmed', 'rejected')),
  received_at timestamptz not null default now()
);
alter table public.inbound_booking_emails enable row level security;
drop policy if exists inbound_booking_emails_select on public.inbound_booking_emails;
create policy inbound_booking_emails_select on public.inbound_booking_emails
  for select to authenticated using (element_id is not null and public.can_edit_element_booking(element_id));

insert into storage.buckets (id, name, public, file_size_limit)
values ('booking-inbound', 'booking-inbound', false, 26214400)
on conflict (id) do nothing;

-- ---- traveler details (ciphertext only; service role only) --------------------
alter table public.trip_elements add column if not exists required_traveler_fields jsonb;

create table if not exists public.element_traveler_details (
  element_id uuid not null references public.trip_elements(id) on delete cascade,
  participant_id uuid not null references auth.users(id) on delete cascade,
  data_enc text not null,
  fields text[] not null default '{}',
  confirmed_match boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (element_id, participant_id)
);
alter table public.element_traveler_details enable row level security;

create table if not exists public.traveler_detail_access_log (
  id bigserial primary key,
  element_id uuid not null,
  participant_id uuid not null,
  viewed_by uuid not null,
  viewed_at timestamptz not null default now()
);
alter table public.traveler_detail_access_log enable row level security;

-- Who's set an organizer may edit the requirement for (defaults live in code).
create or replace function public.set_required_traveler_fields(p_element_id uuid, p_fields jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_edit_element_booking(p_element_id) then
    raise exception 'only the organizer or purchaser can change what details are needed';
  end if;
  update public.trip_elements set required_traveler_fields = p_fields where id = p_element_id;
end;
$$;
grant execute on function public.set_required_traveler_fields(uuid, jsonb) to authenticated;

-- Last day of the trip: the locked Dates element's end, else the latest
-- booked end / accommodation check-out we know of. null = not known yet.
create or replace function public.trip_end_date(p_trip_id uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select max(d) from (
    select case
             when nullif(o.value->>'end_date', '') is not null then (o.value->>'end_date')::date
             when nullif(o.value->>'start_date', '') is not null and nullif(o.value->>'nights', '') is not null
               then (o.value->>'start_date')::date + (o.value->>'nights')::int
           end as d
      from public.trip_elements e join public.element_options o on o.id = e.locked_option_id
      where e.trip_id = p_trip_id and e.type = 'dates' and e.state = 'locked'
    union all
    select nullif(o.value->'dates'->>'end_date', '')::date
      from public.trip_elements e join public.element_options o on o.id = e.locked_option_id
      where e.trip_id = p_trip_id and e.type = 'accommodation' and e.state = 'locked'
    union all
    select b.ends_at::date from public.element_bookings b
      join public.trip_elements e on e.id = b.element_id where e.trip_id = p_trip_id
  ) x;
$$;
revoke execute on function public.trip_end_date(uuid) from public, anon, authenticated;

-- Retention: 90 days after the trip ends (founder, 2026-10-10).
create or replace function public.purge_expired_traveler_details(p_days int default 90)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  delete from public.element_traveler_details d
    using public.trip_elements e
    where e.id = d.element_id
      and public.trip_end_date(e.trip_id) is not null
      and public.trip_end_date(e.trip_id) + p_days < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public.purge_expired_traveler_details(int) from public, anon, authenticated;

-- ---- Issuing (service-role writes; organizer/purchaser reads) ----------------
create table if not exists public.issuing_cardholders (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_cardholder_id text not null unique,
  livemode boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.issuing_cardholders enable row level security;

create table if not exists public.issuing_cards (
  id uuid primary key default gen_random_uuid(),
  element_id uuid not null references public.trip_elements(id) on delete cascade,
  cardholder_user_id uuid references auth.users(id) on delete set null,
  stripe_card_id text not null unique,
  last4 text,
  category_allowlist text[] not null default '{}',
  spend_cap numeric not null,
  currency text not null,
  valid_from timestamptz,
  valid_until timestamptz,
  purpose text not null check (purpose in ('manual_purchase', 'deferred_charge')),
  status text not null default 'inactive' check (status in ('active', 'inactive', 'canceled')),
  created_at timestamptz not null default now()
);
alter table public.issuing_cards enable row level security;
drop policy if exists issuing_cards_select on public.issuing_cards;
create policy issuing_cards_select on public.issuing_cards
  for select to authenticated using (public.can_edit_element_booking(element_id));

create table if not exists public.issuing_authorizations (
  id uuid primary key default gen_random_uuid(),
  card_id uuid references public.issuing_cards(id) on delete cascade,
  stripe_authorization_id text not null unique,
  merchant_name text,
  merchant_category_code text,
  amount numeric,
  currency text,
  approved boolean,
  matched_vendor boolean,
  flagged boolean not null default false,
  flagged_reason text,
  api_order_id text,
  created_at timestamptz not null default now()
);
alter table public.issuing_authorizations enable row level security;
drop policy if exists issuing_authorizations_select on public.issuing_authorizations;
create policy issuing_authorizations_select on public.issuing_authorizations
  for select to authenticated using (
    exists (select 1 from public.issuing_cards c where c.id = card_id and public.can_edit_element_booking(c.element_id)));

-- ---- deferred charges --------------------------------------------------------
-- Book first, collect later. Requires free cancellation AND the supplier's
-- earliest charge date to be far enough out that funding (7 days earlier,
-- founder 2026-10-10) is still in the future; the funding deadline moves to
-- that date so the existing hourly charge job collects then.
create or replace function public.record_deferred_booking(
  p_element_id uuid, p_payment_timing text, p_free_cancel_until timestamptz,
  p_charge_window_start timestamptz, p_charge_window_end timestamptz, p_buffer_days int default 7
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_b public.element_bookings%rowtype;
  v_fr_id uuid;
  v_fr_status text;
  v_charge_status text;
  v_due timestamptz;
begin
  if not public.can_edit_element_booking(p_element_id) then
    raise exception 'only the organizer or purchaser can record this booking';
  end if;
  if p_payment_timing not in ('pay_later', 'pay_at_property') then
    raise exception 'deferred bookings are pay-later or pay-at-property';
  end if;
  if p_free_cancel_until is null or p_charge_window_start is null then
    raise exception 'a deferred booking needs its free-cancellation deadline and the earliest date the supplier can charge';
  end if;
  if p_charge_window_end is not null and p_charge_window_end < p_charge_window_start then
    raise exception 'the charge window ends before it starts';
  end if;

  select * into v_b from public.element_bookings where element_id = p_element_id;
  if v_b.id is null or v_b.confirmed_at is null or v_b.vendor is null
     or (v_b.confirmation_ref is null and v_b.document_path is null) then
    raise exception 'record the booking first — at least the vendor and a confirmation reference or document';
  end if;

  select fr.id, fr.status, fr.charge_status into v_fr_id, v_fr_status, v_charge_status
    from public.funding_requests fr
    join public.funding_request_elements fre on fre.funding_request_id = fr.id
    where fre.element_id = p_element_id and fr.status <> 'superseded'
    order by fr.created_at desc limit 1;
  if v_fr_id is null or v_fr_status <> 'collecting' or v_charge_status is not null then
    raise exception 'pay-later booking is only possible while funding is still collecting';
  end if;

  v_due := least(p_charge_window_start, p_free_cancel_until) - make_interval(days => p_buffer_days);
  if v_due < now() + interval '1 day' then
    raise exception 'too close to the supplier''s charge or cancellation date — fund it now instead';
  end if;

  update public.element_bookings
    set payment_timing = p_payment_timing,
        cancellation_deadline = p_free_cancel_until,
        supplier_charge_window_start = p_charge_window_start,
        supplier_charge_window_end = p_charge_window_end,
        funding_due_at = v_due,
        booked_at = now(),
        updated_at = now()
    where element_id = p_element_id;
  update public.trip_elements set booked_at = now() where id = p_element_id;
  update public.funding_requests set funding_deadline = v_due where id = v_fr_id;
  return v_due;
end;
$$;
grant execute on function public.record_deferred_booking(uuid, text, timestamptz, timestamptz, timestamptz, int) to authenticated;

-- Once a deferred pool is fully collected it is already booked: skip the
-- "go purchase it" step.
create or replace function public.finalize_deferred_funding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ready_to_purchase' and old.status is distinct from 'ready_to_purchase'
     and not exists (
       select 1 from public.funding_request_elements fre
       left join public.element_bookings b on b.element_id = fre.element_id
       where fre.funding_request_id = new.id and (b.funding_due_at is null or b.booked_at is null))
  then
    new.status := 'booked';
    new.booked_at := now();
    new.actual_amount_paid := coalesce(new.actual_amount_paid, new.required_amount);
  end if;
  return new;
end;
$$;
drop trigger if exists finalize_deferred_funding on public.funding_requests;
create trigger finalize_deferred_funding before update on public.funding_requests
  for each row execute function public.finalize_deferred_funding();

-- A deferred element is booked but still collecting: keep it in the funding
-- phase for card alerts / Nudge (was gated on booked_at is null).
create or replace function public.element_phase(p_element_id uuid)
returns table (phase text, deadline timestamptz, funding_request_id uuid, share numeric, currency text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when e.state = 'open' and (e.options_deadline is null or e.options_deadline > now()) then 'submission'
      when e.state = 'open' then 'voting'
      when e.state = 'locked' and fr.status = 'collecting'
           and (fr.charge_status is null or fr.charge_status = 'charging') then 'funding'
      else 'done'
    end,
    case
      when e.state = 'open' and (e.options_deadline is null or e.options_deadline > now()) then e.options_deadline
      when e.state = 'open' then e.voting_deadline
      when fr.charge_status = 'charging' then fr.retry_deadline
      else fr.funding_deadline
    end,
    fr.id, fr.individual_amount, fr.currency
  from public.trip_elements e
  left join lateral (
    select f.* from public.funding_request_elements fre
    join public.funding_requests f on f.id = fre.funding_request_id
    where fre.element_id = e.id and f.status <> 'superseded'
    order by f.created_at desc limit 1
  ) fr on true
  where e.id = p_element_id;
$$;
revoke execute on function public.element_phase(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';
