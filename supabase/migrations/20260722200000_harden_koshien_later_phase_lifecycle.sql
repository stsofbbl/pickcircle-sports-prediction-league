begin;

create or replace function public.prepare_koshien_best16_phases(
  p_event_id text,
  p_opens_at timestamptz,
  p_deadline_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_best16 uuid[];
  v_ordered_player_ids uuid[];
  v_snapshot jsonb;
  v_result_version bigint;
  v_player record;
  v_direct uuid[];
  v_phase1_count integer;
  v_has_survivor boolean;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if p_opens_at is null or p_deadline_at is null or p_opens_at >= p_deadline_at then
    raise exception 'valid opens_at and deadline_at are required';
  end if;
  if exists (select 1 from public.phase2_drafts d where d.event_id = p_event_id) then
    raise exception 'best 16 phases are already prepared' using errcode = '55000';
  end if;

  select array_agg(team_id order by team_id) into v_best16
  from (
    select distinct team_id from (
      select m.team1_id as team_id from public.matches m where m.event_id = p_event_id and m.round_key = 'R3' and m.team1_id is not null
      union
      select m.team2_id from public.matches m where m.event_id = p_event_id and m.round_key = 'R3' and m.team2_id is not null
    ) candidates
  ) fixed;
  if cardinality(v_best16) <> 16 then raise exception 'exactly sixteen official R3 teams are required'; end if;

  select array_agg(player_id order by phase1_score asc, tie_key asc) into v_ordered_player_ids
  from (
    select p.id as player_id, coalesce(s.phase1_score, 0) as phase1_score, random() as tie_key
    from public.players p
    left join public.scores s on s.event_id = p_event_id and s.player_id = p.id
    where p.league_id = v_league_id and p.profile_id is not null
      and (select count(*) from public.phase1_picks roster where roster.event_id = p_event_id and roster.player_id = p.id) = 8
  ) ranked;
  if cardinality(v_ordered_player_ids) <> 4 then raise exception 'exactly four submitted players are required'; end if;

  select jsonb_build_object(
    'players', jsonb_agg(jsonb_build_object(
      'player_id', ordered.player_id,
      'phase1_score', coalesce(s.phase1_score, 0),
      'resolved_rank', 5 - ordered.ordinality
    ) order by ordered.ordinality),
    'tie_draws', coalesce((
      select jsonb_agg(jsonb_build_object('phase1_score', tied.phase1_score, 'ordered_player_ids', tied.player_ids))
      from (
        select coalesce(s2.phase1_score, 0) as phase1_score,
          array_agg(p2.id order by array_position(v_ordered_player_ids, p2.id)) as player_ids
        from public.players p2
        left join public.scores s2 on s2.event_id = p_event_id and s2.player_id = p2.id
        where p2.league_id = v_league_id and p2.profile_id is not null
          and (select count(*) from public.phase1_picks roster2 where roster2.event_id = p_event_id and roster2.player_id = p2.id) = 8
        group by coalesce(s2.phase1_score, 0) having count(*) > 1
      ) tied
    ), '[]'::jsonb),
    'resolved_order_player_ids', to_jsonb(v_ordered_player_ids)
  ) into v_snapshot
  from unnest(v_ordered_player_ids) with ordinality as ordered(player_id, ordinality)
  left join public.scores s on s.event_id = p_event_id and s.player_id = ordered.player_id;

  insert into public.phase2_drafts (
    event_id, status, ordered_player_ids, eligible_team_ids, ranking_snapshot,
    current_pick_no, starts_at, deadline_at
  ) values (p_event_id, 'not_ready', v_ordered_player_ids, v_best16, v_snapshot, 1, p_opens_at, p_deadline_at);
  update public.phase2_drafts set status = 'ready' where event_id = p_event_id;

  v_result_version := public.koshien_result_version(p_event_id);
  insert into public.koshien_later_rounds (
    event_id, phase_key, status, opens_at, deadline_at, source_results_version, snapshot
  ) values (
    p_event_id, 'revenge', 'ready', p_opens_at, p_deadline_at, v_result_version,
    jsonb_build_object('best16_team_ids', v_best16)
  );

  for v_player in select unnest(v_ordered_player_ids) as player_id loop
    select count(*), coalesce(bool_or(p1.team_id = any(v_best16)), false)
    into v_phase1_count, v_has_survivor
    from public.phase1_picks p1 where p1.event_id = p_event_id and p1.player_id = v_player.player_id;

    select coalesce(array_agg(distinct m.winner_team_id) filter (where m.winner_team_id is not null), '{}'::uuid[])
    into v_direct
    from public.phase1_picks p1
    join public.matches m on m.event_id = p_event_id and m.status = 'completed' and m.loser_team_id = p1.team_id
    where p1.event_id = p_event_id and p1.player_id = v_player.player_id and m.winner_team_id = any(v_best16);

    insert into public.koshien_revenge_eligibility (
      event_id, player_id, eligible, allowed_team_ids, fallback_allowed, source_results_version
    ) values (
      p_event_id, v_player.player_id, v_phase1_count = 8 and not v_has_survivor,
      case when v_phase1_count = 8 and not v_has_survivor then case when cardinality(v_direct) > 0 then v_direct else v_best16 end else '{}'::uuid[] end,
      v_phase1_count = 8 and not v_has_survivor and cardinality(v_direct) = 0,
      v_result_version
    );
  end loop;
  return public.get_koshien_later_phase_state(p_event_id);
end;
$$;

create or replace function public.prepare_koshien_zombie_phase(
  p_event_id text,
  p_opens_at timestamptz,
  p_deadline_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_best4 uuid[];
  v_result_version bigint;
  v_player record;
  v_own uuid[];
  v_allowed uuid[];
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if p_opens_at is null or p_deadline_at is null or p_opens_at >= p_deadline_at then raise exception 'valid schedule is required'; end if;
  if coalesce((select (e.rules #>> '{config,zombieEnabled}')::boolean from public.events e where e.id = p_event_id), true) is false then
    raise exception 'zombie phase is disabled for this event' using errcode = '55000';
  end if;
  if exists (select 1 from public.koshien_later_rounds r where r.event_id = p_event_id and r.phase_key = 'zombie') then
    raise exception 'zombie phase is already prepared' using errcode = '55000';
  end if;
  if not exists (select 1 from public.phase2_drafts d where d.event_id = p_event_id and d.status in ('completed','locked')) then
    raise exception 'formal phase 2 draft must be completed first';
  end if;
  select array_agg(team_id order by team_id) into v_best4 from (
    select distinct team_id from (
      select m.team1_id as team_id from public.matches m where m.event_id = p_event_id and m.round_key = 'SF' and m.team1_id is not null
      union select m.team2_id from public.matches m where m.event_id = p_event_id and m.round_key = 'SF' and m.team2_id is not null
    ) candidates
  ) fixed;
  if cardinality(v_best4) <> 4 then raise exception 'exactly four official SF teams are required'; end if;
  v_result_version := public.koshien_result_version(p_event_id);
  insert into public.koshien_later_rounds (event_id, phase_key, status, opens_at, deadline_at, source_results_version, snapshot)
  values (p_event_id, 'zombie', 'ready', p_opens_at, p_deadline_at, v_result_version, jsonb_build_object('best4_team_ids', v_best4));
  for v_player in
    select unnest(d.ordered_player_ids) as player_id from public.phase2_drafts d where d.event_id = p_event_id
  loop
    select array_agg(dp.team_id order by dp.pick_no) into v_own
    from public.phase2_draft_picks dp join public.phase2_drafts d on d.id = dp.draft_id
    where d.event_id = p_event_id and dp.player_id = v_player.player_id;
    select coalesce(array_agg(dp.team_id order by dp.pick_no) filter (where dp.team_id = any(v_best4)), '{}'::uuid[])
    into v_allowed
    from public.phase2_draft_picks dp join public.phase2_drafts d on d.id = dp.draft_id
    where d.event_id = p_event_id and dp.player_id <> v_player.player_id;
    insert into public.koshien_zombie_eligibility (event_id, player_id, eligible, allowed_team_ids, source_results_version)
    values (p_event_id, v_player.player_id,
      cardinality(v_own) = 4 and not (v_own && v_best4),
      case when cardinality(v_own) = 4 and not (v_own && v_best4) then v_allowed else '{}'::uuid[] end,
      v_result_version);
  end loop;
  return public.get_koshien_later_phase_state(p_event_id);
end;
$$;

create or replace function public.prepare_koshien_phase3(
  p_event_id text,
  p_opens_at timestamptz,
  p_deadline_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_league_id uuid; v_team_a_id uuid; v_team_b_id uuid;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if p_opens_at is null or p_deadline_at is null or p_opens_at >= p_deadline_at then raise exception 'valid schedule is required'; end if;
  if exists (select 1 from public.koshien_later_rounds r where r.event_id = p_event_id and r.phase_key = 'phase3') then
    raise exception 'phase 3 is already prepared' using errcode = '55000';
  end if;
  select m.team1_id, m.team2_id into v_team_a_id, v_team_b_id
  from public.matches m where m.event_id = p_event_id and m.round_key = 'F' order by m.match_no limit 1;
  if v_team_a_id is null or v_team_b_id is null or v_team_a_id = v_team_b_id then raise exception 'official finalists are required'; end if;
  insert into public.koshien_later_rounds (
    event_id, phase_key, status, opens_at, deadline_at, source_results_version, snapshot, team_a_id, team_b_id
  ) values (
    p_event_id, 'phase3', 'ready', p_opens_at, p_deadline_at, public.koshien_result_version(p_event_id),
    jsonb_build_object('team_a_id', v_team_a_id, 'team_b_id', v_team_b_id), v_team_a_id, v_team_b_id
  );
  return public.get_koshien_later_phase_state(p_event_id);
end;
$$;

create or replace function public.refresh_koshien_phase_schedule(p_event_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_league_id uuid;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_member(v_league_id) then
    raise exception 'league membership is required' using errcode = '42501';
  end if;
  update public.koshien_later_rounds
  set status = 'open'
  where event_id = p_event_id and status = 'ready'
    and opens_at <= clock_timestamp() and deadline_at > clock_timestamp();
  update public.koshien_later_rounds
  set status = 'locked'
  where event_id = p_event_id and status = 'open' and deadline_at <= clock_timestamp();
  update public.phase2_drafts
  set status = 'drafting'
  where event_id = p_event_id and status = 'ready'
    and starts_at <= clock_timestamp() and deadline_at > clock_timestamp();
end;
$$;

create or replace function public.set_koshien_later_phase_status(
  p_event_id text,
  p_phase_key text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_league_id uuid; v_round public.koshien_later_rounds;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if p_phase_key not in ('best16','zombie','phase3') or p_action not in ('open','lock') then
    raise exception 'unsupported later phase action';
  end if;

  if p_phase_key = 'best16' then
    select r.* into v_round from public.koshien_later_rounds r where r.event_id = p_event_id and r.phase_key = 'revenge' for update;
    if v_round.id is null then raise exception 'best 16 phases are not prepared'; end if;
    if p_action = 'open' then
      if clock_timestamp() < v_round.opens_at or clock_timestamp() >= v_round.deadline_at then raise exception 'best 16 phase is outside its schedule'; end if;
      update public.koshien_later_rounds set status = 'open' where id = v_round.id and status = 'ready';
      update public.phase2_drafts set status = 'drafting' where event_id = p_event_id and status = 'ready';
    else
      if not exists (select 1 from public.phase2_drafts d where d.event_id = p_event_id and d.status in ('completed','locked')) then
        raise exception 'formal phase 2 draft must be completed before lock' using errcode = '55000';
      end if;
      update public.koshien_later_rounds set status = 'locked' where id = v_round.id and status in ('ready','open');
      update public.phase2_drafts set status = 'locked' where event_id = p_event_id and status = 'completed';
    end if;
  else
    select r.* into v_round from public.koshien_later_rounds r where r.event_id = p_event_id and r.phase_key = p_phase_key for update;
    if v_round.id is null then raise exception 'later phase is not prepared'; end if;
    if p_action = 'open' then
      if clock_timestamp() < v_round.opens_at or clock_timestamp() >= v_round.deadline_at then raise exception 'later phase is outside its schedule'; end if;
      update public.koshien_later_rounds set status = 'open' where id = v_round.id and status = 'ready';
    else
      update public.koshien_later_rounds set status = 'locked' where id = v_round.id and status in ('ready','open');
    end if;
  end if;
  return public.get_koshien_later_phase_state(p_event_id);
end;
$$;

create or replace function public.protect_koshien_opened_later_results()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.team1_id, old.team2_id, old.winner_team_id, old.loser_team_id)
    is distinct from
    (new.team1_id, new.team2_id, new.winner_team_id, new.loser_team_id)
    and (
      exists (select 1 from public.koshien_later_rounds r where r.event_id = old.event_id and r.status in ('open','locked','completed'))
      or exists (select 1 from public.phase2_drafts d where d.event_id = old.event_id and d.status in ('drafting','completed','locked'))
    )
  then
    raise exception 'winner-changing result corrections are locked after a later phase opens' using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists matches_protect_koshien_opened_later_results on public.matches;
create trigger matches_protect_koshien_opened_later_results
before update on public.matches
for each row execute function public.protect_koshien_opened_later_results();

revoke all on function public.refresh_koshien_phase_schedule(text) from anon, public;
revoke all on function public.set_koshien_later_phase_status(text,text,text) from anon, public;
grant execute on function public.refresh_koshien_phase_schedule(text) to authenticated;
grant execute on function public.set_koshien_later_phase_status(text,text,text) to authenticated;

commit;
