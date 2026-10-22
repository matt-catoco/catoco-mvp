-- Outbound booking-link clicks (three-prong Prompt 1 §6, 2026-10-22): one row
-- per click through /out/<element>, so affiliate commission can be matched
-- back to the funding request and element via the sub-ID
-- "<funding_request_id>.<element_id>". Written by the server (service role)
-- only; no client access.
create table if not exists public.outbound_clicks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  trip_id uuid references public.trips (id) on delete cascade,
  element_id uuid references public.trip_elements (id) on delete cascade,
  funding_request_id uuid references public.funding_requests (id) on delete set null,
  provider text not null,
  route text not null check (route in ('affiliate_link', 'proposed_link')),
  sub_id text not null,
  created_at timestamptz not null default now()
);
create index if not exists outbound_clicks_element on public.outbound_clicks (element_id, created_at desc);
alter table public.outbound_clicks enable row level security;
revoke all on public.outbound_clicks from anon, authenticated;
grant select, insert on public.outbound_clicks to service_role;
