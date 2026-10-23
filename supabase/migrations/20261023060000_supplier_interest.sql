-- Supplier early list (/for-suppliers, founder 2026-10-23). Providers leave
-- their details after Matt's outreach; Matt reads the rows in the Supabase
-- dashboard. Nothing here is public: RLS on with no policies, no grants to
-- anon/authenticated, and only the server action (service role) writes.
-- ip_hash / user_agent_hash are one-way hashes kept only for rate limiting
-- and abuse checks; the raw IP and user agent are never stored.

create table if not exists public.supplier_interest (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  business_name text not null check (char_length(business_name) between 1 and 200),
  contact_name text not null check (char_length(contact_name) between 1 and 200),
  email text not null check (char_length(email) between 3 and 320),
  city text not null check (char_length(city) between 1 and 120),
  offering text not null check (offering in ('hotel', 'apartment', 'restaurant', 'venue', 'transport', 'activity', 'other')),
  group_size text check (group_size is null or char_length(group_size) <= 40),
  website text check (website is null or (char_length(website) <= 500 and website ~* '^https?://')),
  note text check (note is null or char_length(note) <= 1000),
  status text not null default 'new' check (status in ('new', 'contacted', 'onboarded', 'declined')),
  source text check (source is null or char_length(source) <= 100),
  ip_hash text,
  user_agent_hash text
);

create index if not exists supplier_interest_email_created on public.supplier_interest (lower(email), created_at desc);
create index if not exists supplier_interest_ip_created on public.supplier_interest (ip_hash, created_at desc);

alter table public.supplier_interest enable row level security;
revoke all on table public.supplier_interest from public, anon, authenticated;
grant select, insert, update on table public.supplier_interest to service_role;
