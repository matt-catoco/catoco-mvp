-- ============================================================================
-- Collection mode (three-prong build, Prompt 0 + launch-scope amendment,
-- founder 2026-10-22). Per funding request, the organizer chooses how the
-- group's money is handled:
--
--   peer_pledge    Members pledge in Catoco and pay the organizer directly
--                  (bank transfer, payment link, QR). No processor; Catoco
--                  never holds or moves money. Default for new requests.
--   catoco_psp     Today's Stripe flow (authorize, then capture). Every
--                  existing funding request is set to this, so it behaves
--                  exactly as before.
--   vendor_direct  Marketplace bid (Prompt 3). Shown as "coming soon" only.
--
-- Which modes may be SELECTED is a per-environment feature flag the app
-- server checks (COLLECTION_MODE_*_ENABLED). So the flag can't be bypassed,
-- set_collection_mode() is callable by the server (service role) only, after
-- it has checked the flag and that the caller organizes the trip.
--
-- Payments-tracker status mapping (every mode reports into the same four):
--   catoco_psp   committed = live mandate (active/charging/held/charge_succeeded)
--                failed    = mandate awaiting_retry / charge_failed
--                funded    = an unrefunded funding_contributions row (captured)
--                ignored   = pending / canceled / refunded mandates
--   peer_pledge  committed = an accepted pledge (incl. "I've paid", pending)
--                failed    = (none — nothing is charged, so nothing can fail)
--                funded    = the organizer confirmed the payment
--                            (a funding_contributions row with source 'peer')
--                ignored   = withdrawn pledges
--   (The peer_pledge rows arrive with the pledge tables in 20261022010000.)
-- ============================================================================

alter table public.funding_requests add column if not exists collection_mode text;
update public.funding_requests set collection_mode = 'catoco_psp' where collection_mode is null;
alter table public.funding_requests alter column collection_mode set default 'peer_pledge';
alter table public.funding_requests alter column collection_mode set not null;
alter table public.funding_requests drop constraint if exists funding_requests_collection_mode_check;
alter table public.funding_requests add constraint funding_requests_collection_mode_check
  check (collection_mode in ('peer_pledge', 'catoco_psp', 'vendor_direct'));

-- When the organizer confirmed the mode. Null = not chosen yet: members see
-- "the organizer is choosing how to collect" and nothing can be committed.
-- Existing requests (all catoco_psp) count as chosen.
alter table public.funding_requests add column if not exists collection_mode_chosen_at timestamptz;
update public.funding_requests set collection_mode_chosen_at = created_at
  where collection_mode_chosen_at is null and collection_mode = 'catoco_psp';

-- Has anyone committed money (or a pledge) on this request? Once yes, the
-- mode is locked. Redefined in 20261022010000 to include pledges.
create or replace function public.funding_request_has_commitments(p_funding_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.funding_mandates m
    where m.funding_request_id = p_funding_request_id and m.status not in ('pending', 'canceled', 'refunded')
  ) or exists (
    select 1 from public.funding_contributions c
    where c.funding_request_id = p_funding_request_id and c.refunded_at is null
  );
$$;
revoke execute on function public.funding_request_has_commitments(uuid) from public, anon;
grant execute on function public.funding_request_has_commitments(uuid) to authenticated, service_role;

-- Organizer (or co-organizer) of the request's trip — explicit actor, since
-- the service-role caller has no auth.uid().
create or replace function public.is_funding_request_organizer(p_funding_request_id uuid, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.funding_requests f join public.trips t on t.id = f.trip_id
    where f.id = p_funding_request_id
      and (t.organizer_id = p_user_id or exists (
        select 1 from public.trip_participants tp
        where tp.trip_id = t.id and tp.user_id = p_user_id and tp.role = 'co_organizer'))
  );
$$;
revoke execute on function public.is_funding_request_organizer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.is_funding_request_organizer(uuid, uuid) to service_role;

create or replace function public.set_collection_mode(p_funding_request_id uuid, p_mode text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fr record;
begin
  if p_mode not in ('peer_pledge', 'catoco_psp', 'vendor_direct') then
    raise exception 'that isn''t a way to collect';
  end if;
  select id, status, charge_status into v_fr from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_funding_request_organizer(p_funding_request_id, p_actor) then
    raise exception 'only the organizer or a co-organizer can choose how to collect';
  end if;
  if v_fr.status <> 'collecting' or v_fr.charge_status is not null then
    raise exception 'funding has already moved on — the way to collect can''t change now';
  end if;
  if public.funding_request_has_commitments(p_funding_request_id) then
    raise exception 'people have already committed — the way to collect can''t change now';
  end if;
  update public.funding_requests
    set collection_mode = p_mode, collection_mode_chosen_at = now()
    where id = p_funding_request_id;
end;
$$;
revoke execute on function public.set_collection_mode(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.set_collection_mode(uuid, text, uuid) to service_role;

-- Guards: money paths must match the request's mode, whoever calls them.
create or replace function public.guard_mandate_collection_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select collection_mode from public.funding_requests where id = new.funding_request_id), '') <> 'catoco_psp' then
    raise exception 'this funding isn''t collected through Catoco — there''s no card to authorize';
  end if;
  return new;
end;
$$;
revoke execute on function public.guard_mandate_collection_mode() from public, anon, authenticated;
drop trigger if exists funding_mandates_collection_mode on public.funding_mandates;
create trigger funding_mandates_collection_mode
  before insert on public.funding_mandates
  for each row execute function public.guard_mandate_collection_mode();

create or replace function public.guard_contribution_collection_mode()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text := (select collection_mode from public.funding_requests where id = new.funding_request_id);
begin
  if v_mode = 'catoco_psp' and coalesce(new.source, 'manual') in ('manual', 'stripe') then
    return new;
  end if;
  if v_mode = 'peer_pledge' and new.source = 'peer' then
    return new;
  end if;
  raise exception 'payments for this funding are recorded by the organizer when they receive them';
end;
$$;
revoke execute on function public.guard_contribution_collection_mode() from public, anon, authenticated;
drop trigger if exists funding_contributions_collection_mode on public.funding_contributions;
create trigger funding_contributions_collection_mode
  before insert on public.funding_contributions
  for each row execute function public.guard_contribution_collection_mode();

notify pgrst, 'reload schema';
