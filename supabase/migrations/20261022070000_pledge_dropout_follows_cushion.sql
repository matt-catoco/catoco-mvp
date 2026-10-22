-- Dropouts follow the price cushion (founder, 2026-10-22). No separate
-- dropout rule and no "organizer covers the gap": when someone leaves
-- without paying, the organizer removes the unpaid and the shares are
-- recalculated. Everyone left whose new share is still within their price
-- cushion simply owes the difference; anyone pushed above it has their
-- pledge released and pledges again at the new share. What they've already
-- paid still counts toward it (pledge_paid reads contributions, not pledges).

-- The release now covers paid pledges too (only this recalculation can move
-- the share once someone has paid; reprice / recalculate_funding_shares
-- refuse then).
create or replace function public.pledge_release_on_share_rise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.collection_mode = 'peer_pledge' and new.individual_amount > old.individual_amount then
    update public.funding_pledges p set status = 'withdrawn', withdrawn_at = now()
      where p.funding_request_id = new.id and p.status in ('pledged', 'reported_paid', 'confirmed')
        and p.cap_amount < new.individual_amount;
  end if;
  return new;
end;
$$;
revoke execute on function public.pledge_release_on_share_rise() from public, anon, authenticated;

-- Same as 20261022010000, minus the "above what people agreed to" refusal:
-- the cushion rule above decides who stays in.
create or replace function public.remove_unpaid_and_recalculate(p_funding_request_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.funding_requests := public.pledge_require_organizer(p_funding_request_id);
  v_els uuid[];
  v_required numeric;
  v_share numeric;
begin
  if v.pay_window_opened_at is null then
    raise exception 'open the pay window first';
  end if;
  select array_agg(element_id) into v_els from public.funding_request_elements where funding_request_id = p_funding_request_id;

  update public.funding_pledges p set status = 'withdrawn', withdrawn_at = now()
    where p.funding_request_id = p_funding_request_id and p.status in ('pledged', 'reported_paid')
      and public.pledge_paid(p_funding_request_id, p.participant_id) = 0;
  -- Anyone in the element without a live pledge is out.
  update public.element_participants ep set opted_in = false
    where ep.element_id = any(v_els) and ep.opted_in
      and not exists (select 1 from public.funding_pledges p
                      where p.funding_request_id = p_funding_request_id and p.participant_id = ep.participant_id and p.status <> 'withdrawn');

  select sum(public.calculate_required_amount(e.id)) into v_required
    from public.trip_elements e where e.id = any(v_els) and e.type not in ('dates', 'destination');
  v_share := round(coalesce(v_required, v.required_amount) / greatest(public.funding_request_population_for(p_funding_request_id), 1), 2);
  update public.funding_requests
    set required_amount = coalesce(v_required, required_amount),
        previous_individual_amount = individual_amount,
        individual_amount = v_share,
        shares_recalculated_at = now()
    where id = p_funding_request_id;
  -- Still within their cushion and paid: they owe the difference.
  update public.funding_pledges p set status = 'pledged', confirmed_at = null
    where p.funding_request_id = p_funding_request_id and p.status = 'confirmed'
      and public.pledge_paid(p_funding_request_id, p.participant_id) < v_share;
  perform public.pledge_settle(p_funding_request_id);
  return v_share;
end;
$$;
revoke execute on function public.remove_unpaid_and_recalculate(uuid) from public, anon;
grant execute on function public.remove_unpaid_and_recalculate(uuid) to authenticated;
