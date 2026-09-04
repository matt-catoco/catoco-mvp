-- ============================================================================
-- Core-loop email notifications (Resend), 4 triggers:
--   1. Invited to trip (event-triggered, via join_trip's new return signal)
--   2. Funding ready to purchase (event-triggered, from resolveFundingOutcome)
--   3. Vote/option needed (deadline-based, daily cron)
--   4. Funding needed (deadline-based, daily cron)
-- Reuses lib/email.ts's existing Resend integration -- no second email path.
--
-- Design note, a deliberate deviation from the ticket's literal sketch:
-- notification_log/profiles.email_notifications_enabled get NO client RLS
-- policies (matching the ticket's own "server-side only" intent), but that
-- creates a real problem the ticket's sketch didn't address -- trigger #2
-- notifies the funding request's purchaser, who is very likely a DIFFERENT
-- user than whoever is acting (the organizer resolving the outcome). A plain
-- authenticated-role table write, even from "server-side" Next.js code,
-- still runs as that acting user's own session under RLS -- it can't write a
-- notification_log row or read email_notifications_enabled for someone else
-- without either a policy allowing cross-user writes (unsafe/unwanted) or a
-- security-definer function. Went with the latter: prepare_notification()
-- below does the opt-out check + idempotency claim atomically, in one
-- security-definer call, usable identically from an authenticated user's own
-- session (trigger #1: self; trigger #2: the organizer notifying the
-- purchaser) and the cron route's service-role client (triggers #3/#4).
-- ============================================================================

alter table public.profiles
  add column if not exists email_notifications_enabled boolean not null default true,
  add column if not exists unsubscribe_token uuid not null default gen_random_uuid();

create table if not exists public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('invited', 'funding_ready', 'vote_needed', 'funding_needed')),
  subject_id uuid not null,
  sent_at timestamptz not null default now(),
  unique (user_id, kind, subject_id)
);
alter table public.notification_log enable row level security;
-- No client policies -- write access only through prepare_notification()
-- below (security definer), not direct table access.

grant execute on function public.get_user_email(uuid) to service_role;

-- ---- get_user_emails: batched companion for the cron route ----------------
create or replace function public.get_user_emails(p_user_ids uuid[])
returns table(user_id uuid, email text)
language sql
stable
security definer
set search_path = public
as $$
  select id as user_id, email from auth.users where id = any(p_user_ids);
$$;

grant execute on function public.get_user_emails(uuid[]) to authenticated;
grant execute on function public.get_user_emails(uuid[]) to service_role;

-- ---- prepare_notification: atomic opt-out check + idempotency claim -------
-- Returns should_send = true only if the recipient hasn't opted out AND this
-- exact (user, kind, subject) hasn't already been logged -- and if so, claims
-- it (writes the log row) in the same call, so two concurrent callers (e.g.
-- a re-run cron) can't both decide to send. Also returns the recipient's
-- unsubscribe_token so the caller can build the footer link without a
-- second round trip.
create or replace function public.prepare_notification(
  p_user_id uuid,
  p_kind text,
  p_subject_id uuid
)
returns table(should_send boolean, unsubscribe_token uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_token uuid;
  v_claimed boolean := false;
begin
  select p.email_notifications_enabled, p.unsubscribe_token
    into v_enabled, v_token
    from public.profiles p where p.id = p_user_id;

  -- No profile row (shouldn't happen -- handle_new_user() creates one on
  -- signup -- but fail safe rather than crash the caller) -> don't send.
  if v_token is null then
    should_send := false;
    unsubscribe_token := null;
    return next;
    return;
  end if;

  if coalesce(v_enabled, true) then
    insert into public.notification_log (user_id, kind, subject_id)
    values (p_user_id, p_kind, p_subject_id)
    on conflict (user_id, kind, subject_id) do nothing;
    v_claimed := found;
  end if;

  should_send := coalesce(v_enabled, true) and v_claimed;
  unsubscribe_token := v_token;
  return next;
end;
$$;

grant execute on function public.prepare_notification(uuid, text, uuid) to authenticated;
grant execute on function public.prepare_notification(uuid, text, uuid) to service_role;

-- ---- unsubscribe_by_token: used by the public unsubscribe link ------------
-- No session at all when this is hit (that's the point of a one-click
-- unsubscribe) -- verifies the token itself is the authority, not auth.uid().
create or replace function public.unsubscribe_by_token(p_user_id uuid, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
    set email_notifications_enabled = false
    where id = p_user_id and unsubscribe_token = p_token;
  return found;
end;
$$;

grant execute on function public.unsubscribe_by_token(uuid, uuid) to anon;
grant execute on function public.unsubscribe_by_token(uuid, uuid) to authenticated;
grant execute on function public.unsubscribe_by_token(uuid, uuid) to service_role;

-- ---- join_trip: now signals whether this was a genuinely new join --------
-- Return type changes void -> boolean, so this needs a drop first (CREATE OR
-- REPLACE can't change a function's return type in place -- bit this exact
-- codebase twice before, e.g. get_trip_roster/update_option).
drop function if exists public.join_trip(uuid);

create function public.join_trip(p_trip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_organizer_id uuid;
  v_inserted int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select organizer_id into v_organizer_id from public.trips where id = p_trip_id;
  if v_organizer_id is null then
    return false; -- trip doesn't exist; nothing to do
  end if;
  if v_organizer_id = v_uid then
    return false; -- the organizer isn't a "participant" in the headcount sense
  end if;

  insert into public.trip_participants (trip_id, user_id)
  values (p_trip_id, v_uid)
  on conflict (trip_id, user_id) do nothing;
  get diagnostics v_inserted = row_count;

  insert into public.element_participants (element_id, participant_id, opted_in)
  select id, v_uid, true
  from public.trip_elements
  where trip_id = p_trip_id and scope_all = true
  on conflict (element_id, participant_id) do nothing;

  return v_inserted > 0;
end;
$$;

revoke all on function public.join_trip(uuid) from public;
grant execute on function public.join_trip(uuid) to authenticated;
