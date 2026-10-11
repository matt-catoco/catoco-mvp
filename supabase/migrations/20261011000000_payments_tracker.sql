-- ============================================================================
-- Payments tracker (founder spec + decisions, 2026-10-11).
--
-- Status mapping (authorize-then-capture schema):
--   committed  a live mandate: active (card authorized), charging, held
--              (card hold placed, nothing charged yet)
--   failed     awaiting_retry (hold failed, inside the retry window) or
--              charge_failed (settlement failure after money moved)
--   funded     an unrefunded funding_contributions row — money captured
--              (happens when the group is fully funded, before booking)
--   ignored    pending (started, not finished), canceled, refunded
--
-- Amounts a participant sees include the Catoco fee (share + fee) but the
-- fee itself is never shown separately here. Bundles: one share per
-- funding request, split across its elements in proportion to each
-- element's own cost (calculate_required_amount); rounding cents land on
-- the last row so the rows always add up to the share.
-- ============================================================================

-- The caller's OWN figures only — never anyone else's.
create or replace function public.get_my_trip_payments(p_trip_id uuid)
returns table (
  funding_request_id uuid, element_id uuid, element_type text, element_label text,
  currency text, amount numeric, status text, failure_reason text, retry_deadline timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or not public.is_trip_member(p_trip_id) then
    raise exception 'not a member of this trip';
  end if;
  return query
  with fr as (
    select f.id, coalesce(f.currency, 'USD') as currency, f.individual_amount, f.platform_fee_percent, f.retry_deadline
    from public.funding_requests f
    where f.trip_id = p_trip_id and f.status in ('collecting', 'ready_to_purchase', 'booked')
  ),
  mine as (
    select fr.id as fr_id, fr.currency, fr.retry_deadline,
      c.funded_total,
      m.status as mandate_status, m.retry_reason,
      case
        when c.funded_total is not null then 'funded'
        when m.status in ('awaiting_retry', 'charge_failed') then 'failed'
        when m.status in ('active', 'charging', 'held', 'charge_succeeded') then 'committed'
      end as my_status,
      coalesce(c.funded_total, fr.individual_amount + round(fr.individual_amount * fr.platform_fee_percent / 100, 2)) as total
    from fr
    left join lateral (
      select sum(x.amount + x.platform_fee) as funded_total
      from public.funding_contributions x
      where x.funding_request_id = fr.id and x.contributor_id = v_uid and x.refunded_at is null
      having count(*) > 0
    ) c on true
    left join lateral (
      select mm.status, mm.retry_reason from public.funding_mandates mm
      where mm.funding_request_id = fr.id and mm.participant_id = v_uid
        and mm.status not in ('pending', 'canceled', 'refunded')
      order by mm.created_at desc limit 1
    ) m on true
  ),
  els as (
    select mine.*, e.id as el_id, e.type as el_type, e.label as el_label,
      greatest(coalesce(public.calculate_required_amount(e.id), 0), 0) as w,
      row_number() over (partition by mine.fr_id order by e.created_at, e.id) as rn,
      count(*) over (partition by mine.fr_id) as n
    from mine
    join public.funding_request_elements fre on fre.funding_request_id = mine.fr_id
    join public.trip_elements e on e.id = fre.element_id
    where mine.my_status is not null
  ),
  split as (
    select els.*,
      case when sum(w) over (partition by fr_id) > 0
           then round(total * w / sum(w) over (partition by fr_id), 2)
           else round(total / n, 2) end as raw
    from els
  )
  select s.fr_id, s.el_id, s.el_type, s.el_label, s.currency,
    case when s.rn = s.n then s.total - (sum(s.raw) over (partition by s.fr_id) - s.raw) else s.raw end,
    s.my_status,
    case when s.my_status = 'failed' then coalesce(s.retry_reason, case when s.mandate_status = 'charge_failed' then 'settlement_failed' end) end,
    case when s.my_status = 'failed' then s.retry_deadline end
  from split s
  order by s.currency, s.fr_id, s.rn;
end;
$$;
grant execute on function public.get_my_trip_payments(uuid) to authenticated;

-- Organizer view: trip-wide figures per element. Amounts here are vendor-side
-- (shares WITHOUT the Catoco fee) so required/committed/captured compare
-- like for like. Organizers and co-organizers only.
create or replace function public.get_trip_payment_summary(p_trip_id uuid)
returns table (
  element_id uuid, element_type text, element_label text, currency text,
  required numeric, committed numeric, captured numeric, paid_to_vendor numeric,
  n_committed int, n_funded int
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_trip_organizer(p_trip_id) then
    raise exception 'only the organizer or a co-organizer can see trip payments';
  end if;
  return query
  with fr as (
    select f.id, coalesce(f.currency, 'USD') as currency, f.required_amount, f.individual_amount, f.actual_amount_paid, f.status
    from public.funding_requests f
    where f.trip_id = p_trip_id and f.status in ('collecting', 'ready_to_purchase', 'booked')
  ),
  per_person as (
    select fr.id as fr_id, p.uid,
      exists (select 1 from public.funding_contributions x where x.funding_request_id = fr.id and x.contributor_id = p.uid and x.refunded_at is null) as funded,
      exists (select 1 from public.funding_mandates m where m.funding_request_id = fr.id and m.participant_id = p.uid
              and m.status in ('active', 'charging', 'held', 'awaiting_retry', 'charge_succeeded')) as has_mandate
    from fr
    cross join lateral (
      select distinct m.participant_id as uid from public.funding_mandates m where m.funding_request_id = fr.id
      union
      select distinct x.contributor_id from public.funding_contributions x where x.funding_request_id = fr.id
    ) p
  ),
  fr_tot as (
    select fr.*,
      (select count(*) from per_person pp where pp.fr_id = fr.id and (pp.funded or pp.has_mandate))::int as n_committed,
      (select count(*) from per_person pp where pp.fr_id = fr.id and pp.funded)::int as n_funded,
      coalesce((select sum(x.amount) from public.funding_contributions x where x.funding_request_id = fr.id and x.refunded_at is null), 0) as captured
    from fr
  ),
  els as (
    select t.*, e.id as el_id, e.type as el_type, e.label as el_label,
      greatest(coalesce(public.calculate_required_amount(e.id), 0), 0) as w,
      count(*) over (partition by t.id) as n,
      b.amount_charged
    from fr_tot t
    join public.funding_request_elements fre on fre.funding_request_id = t.id
    join public.trip_elements e on e.id = fre.element_id
    left join public.element_bookings b on b.element_id = e.id
  ),
  ratio as (
    select els.*, case when sum(w) over (partition by id) > 0 then w / sum(w) over (partition by id) else 1.0 / n end as r
    from els
  )
  select r.el_id, r.el_type, r.el_label, r.currency,
    round(r.required_amount * r.r, 2),
    round(r.individual_amount * r.n_committed * r.r, 2),
    round(r.captured * r.r, 2),
    coalesce(r.amount_charged, case when r.status = 'booked' then round(coalesce(r.actual_amount_paid, r.required_amount) * r.r, 2) end),
    r.n_committed, r.n_funded
  from ratio r
  order by r.currency, r.el_label;
end;
$$;
grant execute on function public.get_trip_payment_summary(uuid) to authenticated;

notify pgrst, 'reload schema';
