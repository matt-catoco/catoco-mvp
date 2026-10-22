-- Pledge price cushion (founder, 2026-10-22): framed exactly like the card
-- commitment's cushion. Each member pledges their share plus a cushion they
-- pick (none / % / amount, the trip's or element's recommendation
-- pre-selected), in case the price changes. A price within the cushion keeps
-- the pledge; a rise beyond it releases the pledge
-- (pledge_release_on_share_rise, 20261022030000) and they pledge again at
-- the new price. "Drop unpaid and split again" works within everyone's cushion.

alter table public.funding_pledges add column if not exists cushion_kind text
  check (cushion_kind is null or cushion_kind in ('percent', 'amount'));
alter table public.funding_pledges add column if not exists cushion_value numeric not null default 0;

drop function if exists public.accept_pledge(uuid, text, text);
create or replace function public.accept_pledge(
  p_funding_request_id uuid,
  p_terms_version text,
  p_locale text,
  p_cushion_kind text default 'none',
  p_cushion_value numeric default 0
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_fr record;
  v_ref text;
  v_pledged int;
  v_kind text := nullif(coalesce(p_cushion_kind, 'none'), 'none');
  v_value numeric := coalesce(p_cushion_value, 0);
  v_cap numeric;
  v_limit numeric;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  select id, status, charge_status, collection_mode, collection_mode_chosen_at, individual_amount,
         trip_id, funding_deadline, pay_window_opened_at
    into v_fr from public.funding_requests where id = p_funding_request_id for update;
  if v_fr.id is null then
    raise exception 'funding request not found';
  end if;
  if not public.is_funding_request_member(p_funding_request_id) then
    raise exception 'not a member of this funding request';
  end if;
  if v_fr.collection_mode <> 'peer_pledge' or v_fr.collection_mode_chosen_at is null then
    raise exception 'the organizer hasn''t set up pledges for this yet';
  end if;
  if v_fr.status <> 'collecting' then
    raise exception 'this isn''t collecting anymore';
  end if;
  if v_fr.funding_deadline is not null and v_fr.funding_deadline <= now() then
    raise exception 'the deadline to pledge has passed';
  end if;
  if not exists (
    select 1 from public.funding_request_elements fre
    join public.element_participants ep on ep.element_id = fre.element_id
    where fre.funding_request_id = p_funding_request_id and ep.participant_id = v_uid and ep.opted_in = true
  ) then
    raise exception 'only people in this element can pledge a share';
  end if;
  if exists (select 1 from public.funding_pledges where funding_request_id = p_funding_request_id and participant_id = v_uid and status <> 'withdrawn') then
    raise exception 'you''ve already pledged';
  end if;
  if public.funding_request_spots_full(p_funding_request_id, v_uid) then
    raise exception 'every spot is taken — you''re on the waitlist';
  end if;
  if coalesce(p_terms_version, '') = '' then
    raise exception 'accept the pledge terms first';
  end if;

  -- The member's own price cushion, same choices and limits as a card
  -- commitment (funding_mandate_cushion_max), allowed whenever the trip
  -- allows a cushion: the organizer re-prices pledge bookings by hand.
  v_cap := v_fr.individual_amount;
  if v_kind is not null and v_value > 0 then
    if not coalesce((select allow_checkout_cushion from public.trips where id = v_fr.trip_id), false) then
      raise exception 'a price cushion isn''t offered for this trip';
    end if;
    if v_kind = 'percent' then
      v_cap := round(v_fr.individual_amount * (1 + v_value / 100.0), 2);
      v_limit := round(v_fr.individual_amount * 1.5, 2);
    elsif v_kind = 'amount' then
      v_cap := round(v_fr.individual_amount + v_value, 2);
      v_limit := round(v_fr.individual_amount * 2, 2);
    else
      raise exception 'unknown cushion choice';
    end if;
    v_limit := greatest(v_limit, coalesce(public.funding_request_cushion_cap(p_funding_request_id, v_fr.individual_amount), v_fr.individual_amount));
    if v_cap > v_limit then
      raise exception 'that cushion is more than this booking allows';
    end if;
  else
    v_kind := null;
    v_value := 0;
  end if;

  loop
    v_ref := 'CTC-' || upper(substr(md5(gen_random_uuid()::text), 1, 6));
    exit when not exists (select 1 from public.funding_pledges where reference_code = v_ref);
  end loop;

  insert into public.funding_pledges (funding_request_id, participant_id, amount, cap_amount, cushion_kind, cushion_value,
                                      terms_version, terms_locale, reference_code)
  values (p_funding_request_id, v_uid, v_fr.individual_amount, v_cap, v_kind, v_value,
          p_terms_version, case when p_locale in ('en', 'nl') then p_locale else 'en' end, v_ref);

  -- Everyone in has pledged → the pay window opens.
  select count(*) into v_pledged from public.funding_pledges
    where funding_request_id = p_funding_request_id and status <> 'withdrawn';
  if v_fr.pay_window_opened_at is null and v_pledged >= public.funding_request_population_for(p_funding_request_id) then
    update public.funding_requests set pay_window_opened_at = now() where id = p_funding_request_id;
  end if;
  return v_ref;
end;
$$;
revoke execute on function public.accept_pledge(uuid, text, text, text, numeric) from public, anon;
grant execute on function public.accept_pledge(uuid, text, text, text, numeric) to authenticated;
