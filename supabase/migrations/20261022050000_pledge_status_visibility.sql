-- Pledge status visibility (founder, 2026-10-22): who has pledged and paid is
-- shown to the rest of the group only when the organizer switches it on for
-- that element's pledge. Off by default. Organizers and co-organizers always
-- see everyone; a member always sees their own pledge.

alter table public.funding_requests add column if not exists show_pledge_status boolean not null default false;

drop policy if exists "Funding members see pledges" on public.funding_pledges;
create policy "Funding members see pledges" on public.funding_pledges
  for select using (
    participant_id = auth.uid()
    or exists (
      select 1 from public.funding_requests fr
      where fr.id = funding_request_id
        and (public.is_trip_organizer(fr.trip_id)
             or (fr.show_pledge_status and public.is_funding_request_member(fr.id)))
    )
  );

create or replace function public.set_pledge_status_visibility(p_funding_request_id uuid, p_show boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.funding_requests := public.pledge_require_organizer(p_funding_request_id);
begin
  update public.funding_requests set show_pledge_status = coalesce(p_show, false) where id = v.id;
end;
$$;
revoke execute on function public.set_pledge_status_visibility(uuid, boolean) from public, anon;
grant execute on function public.set_pledge_status_visibility(uuid, boolean) to authenticated;
