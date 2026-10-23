-- Push notifications, server side (three-prong Prompt 4, founder go-ahead
-- 2026-10-23). Push is a second channel for the same events as email, not a
-- reason to send more. Nothing is delivered until a push provider is
-- configured (APNs/FCM keys, after the app shell exists); until then this
-- only stores devices and preferences.
--
--   push_devices              one row per device token; written by the
--                             /api/push/devices route (service role, after
--                             checking the session), never by clients.
--   notification_preferences  per user and kind: push, email, both, off.
--                             No row = the default (lib/push/channels.ts).
--   notification_log.channels which channels an event went out on.
--   claim_notification()      the dedupe claim without prepare_notification's
--                             email opt-out check, so a person who
--                             unsubscribed from email can still get a push.
--
-- New kinds pledge_payment_requested, pledge_payment_confirmed and
-- pay_window_closing are allowed in the log but the app does not send them
-- until Matt approves (PENDING_APPROVAL_KINDS in lib/notifications.ts).

-- ---- devices ---------------------------------------------------------------
create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  token text not null unique check (char_length(token) between 16 and 4096),
  app_version text check (char_length(app_version) <= 40),
  locale text not null default 'en' check (locale in ('en', 'nl')),
  time_zone text check (char_length(time_zone) <= 64),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_reason text check (revoked_reason in ('signed_out', 'invalid_token'))
);
create index if not exists push_devices_user_active_idx on public.push_devices (user_id) where revoked_at is null;

alter table public.push_devices enable row level security;
-- No client policies: tokens are only read and written server side.
revoke all on table public.push_devices from public, anon, authenticated;
grant select, insert, update, delete on table public.push_devices to service_role;

-- ---- kinds -----------------------------------------------------------------
alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('invited', 'funding_ready', 'vote_needed', 'funding_needed', 'funding_deadline_set',
                  'payment_retry_needed', 'nudge', 'funding_failed', 'shares_recalculated', 'price_drift',
                  'deadline_missed', 'recommit_requested', 'refund_requested',
                  'pledge_payment_requested', 'pledge_payment_confirmed', 'pay_window_closing'));

alter table public.notification_log add column if not exists channels text[];

-- ---- preferences -----------------------------------------------------------
create table if not exists public.notification_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('invited', 'funding_ready', 'vote_needed', 'funding_needed', 'funding_deadline_set',
                  'payment_retry_needed', 'nudge', 'funding_failed', 'shares_recalculated', 'price_drift',
                  'deadline_missed', 'recommit_requested', 'refund_requested',
                  'pledge_payment_requested', 'pledge_payment_confirmed', 'pay_window_closing')),
  channel text not null check (channel in ('push', 'email', 'both', 'off')),
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

alter table public.notification_preferences enable row level security;
drop policy if exists "Own notification preferences" on public.notification_preferences;
create policy "Own notification preferences" on public.notification_preferences
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
revoke all on table public.notification_preferences from public, anon;
grant select, insert, update, delete on table public.notification_preferences to authenticated, service_role;

-- ---- claim -----------------------------------------------------------------
-- True when this caller claimed (user, kind, subject) and should send; false
-- when it was already claimed (a re-run cron, a second caller).
create or replace function public.claim_notification(
  p_user_id uuid,
  p_kind text,
  p_subject_id uuid,
  p_channels text[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notification_log (user_id, kind, subject_id, channels)
  values (p_user_id, p_kind, p_subject_id, p_channels)
  on conflict (user_id, kind, subject_id) do nothing;
  return found;
end;
$$;
revoke execute on function public.claim_notification(uuid, text, uuid, text[]) from public, anon, authenticated;
grant execute on function public.claim_notification(uuid, text, uuid, text[]) to service_role;
