-- ============================================================================
-- Flow #3, batch 2 — ranked voting, Borda scoring, lazy auto-lock
-- ============================================================================

-- ---- trip_elements: one-shot notification flags --------------------------
alter table public.trip_elements
  add column if not exists tie_notified boolean not null default false,
  add column if not exists empty_notified boolean not null default false;

-- ---- votes: participants can read their own ballot ------------------------
-- Aggregate access (the leaderboard) goes through borda_scores() below, not
-- a general select policy — ballots aren't meant to be browsable row by row.
drop policy if exists "Users can view their own votes" on public.votes;
create policy "Users can view their own votes"
  on public.votes for select
  to authenticated
  using (participant_id = auth.uid());

grant select on public.votes to authenticated;

-- ---- cast_votes: replace a participant's top-3 ranking for one element ----
create or replace function public.cast_votes(p_element_id uuid, p_option_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_trip_id uuid;
  v_state text;
  v_voting_deadline timestamptz;
  v_count int;
  v_distinct_count int;
  v_bad_count int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select trip_id, state, voting_deadline
    into v_trip_id, v_state, v_voting_deadline
    from public.trip_elements where id = p_element_id;

  if v_trip_id is null then
    raise exception 'element not found';
  end if;
  if not public.is_trip_member(v_trip_id) then
    raise exception 'not a member of this trip';
  end if;
  if v_state <> 'open' then
    raise exception 'element is not open for voting';
  end if;
  if v_voting_deadline is not null and v_voting_deadline <= now() then
    raise exception 'voting has closed for this element';
  end if;

  v_count := coalesce(array_length(p_option_ids, 1), 0);
  if v_count > 3 then
    raise exception 'rank at most 3 options';
  end if;

  select count(distinct x) into v_distinct_count from unnest(p_option_ids) as x;
  if v_distinct_count <> v_count then
    raise exception 'duplicate option in ranking';
  end if;

  select count(*) into v_bad_count
    from unnest(p_option_ids) as opt_id
    where not exists (
      select 1 from public.element_options eo
      where eo.id = opt_id and eo.element_id = p_element_id
    );
  if v_bad_count > 0 then
    raise exception 'one or more options do not belong to this element';
  end if;

  delete from public.votes
    where participant_id = v_uid
      and option_id in (select id from public.element_options where element_id = p_element_id);

  if v_count > 0 then
    insert into public.votes (option_id, participant_id, rank)
    select p_option_ids[i], v_uid, i
    from generate_subscripts(p_option_ids, 1) as i;
  end if;
end;
$$;

grant execute on function public.cast_votes(uuid, uuid[]) to authenticated;

-- ---- borda_scores: single source of truth for standings --------------------
create or replace function public.borda_scores(p_element_id uuid)
returns table(option_id uuid, score bigint)
language sql
stable
security definer
set search_path = public
as $$
  select eo.id as option_id,
         coalesce(sum(case v.rank when 1 then 3 when 2 then 2 when 3 then 1 else 0 end), 0) as score
  from public.element_options eo
  left join public.votes v on v.option_id = eo.id
  where eo.element_id = p_element_id
  group by eo.id;
$$;

grant execute on function public.borda_scores(uuid) to authenticated;

-- ---- get_runner_up_option: next-best after the current lock ---------------
-- Votes are frozen once an element locks (cast_votes requires state='open'),
-- so borda_scores on a locked element is a stable historical result — no
-- separate snapshot table needed. Returns null for an organizer-locked
-- element (one option, no votes to fall back on) with no special-casing.
create or replace function public.get_runner_up_option(p_element_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select bs.option_id
  from public.borda_scores(p_element_id) bs
  where bs.option_id <> (select locked_option_id from public.trip_elements where id = p_element_id)
  order by bs.score desc
  limit 1;
$$;

grant execute on function public.get_runner_up_option(uuid) to authenticated;

-- ---- get_user_email: narrow read into auth.users for notifications --------
create or replace function public.get_user_email(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email from auth.users where id = p_user_id;
$$;

grant execute on function public.get_user_email(uuid) to authenticated;

-- ---- resolve_due_elements: the lazy auto-lock trigger ----------------------
create or replace function public.resolve_due_elements(p_trip_id uuid)
returns table(element_id uuid, element_type text, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_el record;
  v_opt_count int;
  v_top_score bigint;
  v_tie_count int;
  v_winner_option_id uuid;
begin
  for v_el in
    select id, type, tie_notified, empty_notified
    from public.trip_elements
    where trip_id = p_trip_id
      and state = 'open'
      and voting_deadline is not null
      and voting_deadline <= now()
  loop
    select count(*) into v_opt_count
      from public.element_options where element_options.element_id = v_el.id;

    if v_opt_count = 0 then
      if not v_el.empty_notified then
        update public.trip_elements set empty_notified = true where id = v_el.id;
        element_id := v_el.id;
        element_type := v_el.type;
        reason := 'empty';
        return next;
      end if;
      continue;
    end if;

    if v_opt_count = 1 then
      select eo.id into v_winner_option_id
        from public.element_options eo where eo.element_id = v_el.id;
    else
      select bs.score into v_top_score
        from public.borda_scores(v_el.id) bs order by bs.score desc limit 1;
      select count(*) into v_tie_count
        from public.borda_scores(v_el.id) bs where bs.score = v_top_score;

      if v_tie_count > 1 then
        if not v_el.tie_notified then
          update public.trip_elements set tie_notified = true where id = v_el.id;
          element_id := v_el.id;
          element_type := v_el.type;
          reason := 'tie';
          return next;
        end if;
        continue;
      end if;

      select bs.option_id into v_winner_option_id
        from public.borda_scores(v_el.id) bs order by bs.score desc limit 1;
    end if;

    update public.trip_elements
      set state = 'locked', status = 'settled', locked_option_id = v_winner_option_id
      where id = v_el.id;
  end loop;
end;
$$;

grant execute on function public.resolve_due_elements(uuid) to authenticated;
