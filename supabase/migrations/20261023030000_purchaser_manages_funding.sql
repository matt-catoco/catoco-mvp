-- The element's purchaser manages its money (founder, 2026-10-23). When the
-- organizer hands the purchaser role to someone else, that person inherits
-- what the organizer could do with the funding round: confirm and undo pledge
-- payments, mark refunds, recalculate, set pay timing and visibility, and
-- mark a manual round refunded. Organizers and co-organizers keep it too.

create or replace function public.pledge_require_organizer(p_funding_request_id uuid)
returns public.funding_requests
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.funding_requests;
begin
  select * into v from public.funding_requests f where f.id = p_funding_request_id for update;
  if v.id is null then
    raise exception 'funding request not found';
  end if;
  if not (public.is_trip_organizer(v.trip_id) or v.purchaser_id = auth.uid()) then
    raise exception 'only the organizer, a co-organizer or the purchaser can do this';
  end if;
  if v.collection_mode <> 'peer_pledge' then
    raise exception 'this funding isn''t collected by pledges';
  end if;
  if v.status <> 'collecting' then
    raise exception 'funding has already moved on';
  end if;
  return v;
end;
$$;
revoke execute on function public.pledge_require_organizer(uuid) from public, anon, authenticated;

create or replace function public.mark_funding_request_refunded(p_funding_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trip_id uuid;
  v_purchaser uuid;
begin
  select trip_id, purchaser_id into v_trip_id, v_purchaser from public.funding_requests where id = p_funding_request_id;
  if v_trip_id is null then
    raise exception 'funding request not found';
  end if;
  if not (public.is_trip_organizer(v_trip_id) or v_purchaser = auth.uid()) then
    raise exception 'only the organizer, a co-organizer or the purchaser can mark this refunded';
  end if;
  if public.funding_request_held_stripe_count(p_funding_request_id) > 0 then
    raise exception 'this has real card/bank payments on it — use Refund everyone instead';
  end if;

  update public.funding_requests set refunded_at = now() where id = p_funding_request_id;
end;
$$;
grant execute on function public.mark_funding_request_refunded(uuid) to authenticated;

-- The purchaser sees every pledge on their round (they confirm the payments).
drop policy if exists "Funding members see pledges" on public.funding_pledges;
create policy "Funding members see pledges" on public.funding_pledges
  for select using (
    participant_id = auth.uid()
    or exists (
      select 1 from public.funding_requests fr
      where fr.id = funding_request_id
        and (public.is_trip_organizer(fr.trip_id)
             or fr.purchaser_id = auth.uid()
             or (fr.show_pledge_status and public.is_funding_request_member(fr.id)))
    )
  );
