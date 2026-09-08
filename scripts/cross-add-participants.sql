-- ============================================================================
-- Cross-role participant seeding (STAGING ONLY) -- follow-up to
-- seed-mock-trips.sql.
--
-- Once all 3 profiles' 6-trip batches exist (seed_mock_trip_batch run once
-- per profile), this joins the other two profiles onto every trip an
-- organizer created -- so every trip has all 3 real profiles involved,
-- reachable in every organizer / co-organizer / participant combination.
-- Also deliberately varies trips.min_participants/max_participants so some
-- trips are oversubscribed (fewer spots than people who actually joined)
-- and some are undersubscribed (more spots than joined), and promotes one
-- of the two joiners to co_organizer on each organizer's 5th trip (the
-- "Lock-order regression + co-organizer seam" trip -- see its comment in
-- seed-mock-trips.sql).
--
-- Usage (all 3 real profile ids, any order -- the function figures out who
-- organizes which trip from trips.organizer_id):
--   select * from public.cross_add_and_vary_capacity(
--     '<profile-A-uuid>'::uuid, '<profile-B-uuid>'::uuid, '<profile-C-uuid>'::uuid
--   );
--
-- Capacity pattern (by each organizer's trip creation order, 1-6):
--   1 min=1 max=6  (undersubscribed)      4 min=1 max=1  (oversubscribed)
--   2 min=1 max=1  (oversubscribed)       5 min=2 max=5  (undersubscribed)
--   3 min=4 max=8  (undersubscribed)      6 min=1 max=1  (oversubscribed)
-- Every non-organizer joiner ends up on 2 of the 6 trips as a joined
-- participant regardless of this pattern -- only the capacity numbers vary,
-- deliberately, to produce both directions of the mismatch.
-- ============================================================================

create or replace function public.cross_add_and_vary_capacity(
  p_profile_a uuid,
  p_profile_b uuid,
  p_profile_c uuid
)
returns table(trip_name text, organizer_email text, min_participants int, max_participants int, co_organizer_promoted boolean)
language plpgsql
as $body$
declare
  v_trip record;
  v_other1 uuid;
  v_other2 uuid;
  v_co_organizer uuid;
  v_min int;
  v_max int;
  v_promoted boolean;
begin
  for v_trip in
    select t.id as trip_id, t.name as t_name, t.organizer_id,
           row_number() over (partition by t.organizer_id order by t.created_at) as trip_num
    from public.trips t
    where t.organizer_id in (p_profile_a, p_profile_b, p_profile_c)
    order by t.organizer_id, t.created_at
  loop
    if v_trip.organizer_id = p_profile_a then
      v_other1 := p_profile_b; v_other2 := p_profile_c; v_co_organizer := p_profile_b;
    elsif v_trip.organizer_id = p_profile_b then
      v_other1 := p_profile_a; v_other2 := p_profile_c; v_co_organizer := p_profile_c;
    else
      v_other1 := p_profile_a; v_other2 := p_profile_b; v_co_organizer := p_profile_a;
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_other1::text, 'role', 'authenticated')::text, false);
    perform public.join_trip(v_trip.trip_id);

    perform set_config('request.jwt.claims', json_build_object('sub', v_other2::text, 'role', 'authenticated')::text, false);
    perform public.join_trip(v_trip.trip_id);

    case v_trip.trip_num
      when 1 then v_min := 1; v_max := 6;
      when 2 then v_min := 1; v_max := 1;
      when 3 then v_min := 4; v_max := 8;
      when 4 then v_min := 1; v_max := 1;
      when 5 then v_min := 2; v_max := 5;
      when 6 then v_min := 1; v_max := 1;
      else v_min := 1; v_max := 6;
    end case;

    perform set_config('request.jwt.claims', json_build_object('sub', v_trip.organizer_id::text, 'role', 'authenticated')::text, false);
    perform public.set_participant_capacity(v_trip.trip_id, v_min, v_max);

    v_promoted := false;
    if v_trip.trip_num = 5 then
      perform public.set_participant_role(v_trip.trip_id, v_co_organizer, 'co_organizer');
      v_promoted := true;
    end if;

    trip_name := v_trip.t_name;
    select email into organizer_email from auth.users where id = v_trip.organizer_id;
    min_participants := v_min;
    max_participants := v_max;
    co_organizer_promoted := v_promoted;
    return next;
  end loop;
end;
$body$;
