begin;

create table if not exists public.koshien_later_rounds (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  phase_key text not null check (phase_key in ('revenge', 'zombie', 'phase3')),
  status text not null default 'not_ready' check (status in ('not_ready', 'ready', 'open', 'locked', 'completed')),
  opens_at timestamptz,
  deadline_at timestamptz,
  locked_at timestamptz,
  source_results_version bigint not null default 0,
  version bigint not null default 1,
  snapshot jsonb not null default '{}'::jsonb,
  team_a_id uuid references public.teams(id) on delete set null,
  team_b_id uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, phase_key),
  check (status in ('not_ready', 'ready') or (opens_at is not null and deadline_at is not null and opens_at < deadline_at)),
  check (phase_key <> 'phase3' or status in ('not_ready', 'ready') or (team_a_id is not null and team_b_id is not null and team_a_id <> team_b_id))
);

create table if not exists public.koshien_revenge_eligibility (
  event_id text not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  eligible boolean not null,
  allowed_team_ids uuid[] not null default '{}'::uuid[],
  fallback_allowed boolean not null default false,
  source_results_version bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (event_id, player_id)
);

create table if not exists public.koshien_zombie_eligibility (
  event_id text not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  eligible boolean not null,
  allowed_team_ids uuid[] not null default '{}'::uuid[],
  source_results_version bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (event_id, player_id)
);

alter table public.revenge_picks add column if not exists request_id uuid;
alter table public.zombie_predictions add column if not exists request_id uuid;
alter table public.final_score_predictions add column if not exists predicted_score_a integer;
alter table public.final_score_predictions add column if not exists predicted_score_b integer;
alter table public.final_score_predictions add column if not exists request_id uuid;

create unique index if not exists revenge_picks_event_player_key on public.revenge_picks (event_id, player_id);
create unique index if not exists zombie_predictions_event_player_key on public.zombie_predictions (event_id, player_id);
create unique index if not exists final_score_predictions_event_player_key on public.final_score_predictions (event_id, player_id);

create or replace function public.koshien_result_version(p_event_id text)
returns bigint
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(sum(extract(epoch from m.updated_at)::bigint), 0)
  from public.matches m
  where m.event_id = p_event_id and m.status = 'completed';
$$;

create or replace function public.koshien_team_finish(p_event_id text, p_team_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select case
    when exists (
      select 1 from public.matches m
      where m.event_id = p_event_id and m.status = 'completed' and m.round_key = 'F' and m.winner_team_id = p_team_id
    ) then 'champion'
    else coalesce((
      select case m.round_key
        when 'R1' then 'initial_loss'
        when 'R2' then case when t.start_round = 2 then 'initial_loss' else 'first_win_then_loss' end
        when 'R3' then 'best16'
        when 'QF' then 'best8'
        when 'SF' then 'best4'
        when 'F' then 'runner_up'
        else ''
      end
      from public.matches m
      join public.teams t on t.id = p_team_id and t.event_id = p_event_id
      where m.event_id = p_event_id and m.status = 'completed' and m.loser_team_id = p_team_id
      order by m.updated_at desc limit 1
    ), '')
  end;
$$;

create or replace function public.koshien_arrival_points(p_finish text)
returns numeric
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_finish
    when 'first_win_then_loss' then 1
    when 'best16' then 1.5
    when 'best8' then 2
    when 'best4' then 2.5
    when 'runner_up' then 3.5
    when 'champion' then 5
    else 0
  end;
$$;

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
  if exists (select 1 from public.phase2_drafts d where d.event_id = p_event_id and d.status <> 'not_ready') then
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
    select p.id as player_id, coalesce(s.phase1_score, 0) as phase1_score,
      random() as tie_key
    from public.players p
    left join public.scores s on s.event_id = p_event_id and s.player_id = p.id
    where p.league_id = v_league_id and p.profile_id is not null
  ) ranked;
  if cardinality(v_ordered_player_ids) <> 4 then raise exception 'exactly four authenticated players are required'; end if;

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
        from public.players p2 left join public.scores s2 on s2.event_id = p_event_id and s2.player_id = p2.id
        where p2.league_id = v_league_id and p2.profile_id is not null
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
  ) values (p_event_id, 'not_ready', v_ordered_player_ids, v_best16, v_snapshot, 1, p_opens_at, p_deadline_at)
  on conflict (event_id) do update set
    ordered_player_ids = excluded.ordered_player_ids,
    eligible_team_ids = excluded.eligible_team_ids,
    ranking_snapshot = excluded.ranking_snapshot,
    starts_at = excluded.starts_at,
    deadline_at = excluded.deadline_at
  where public.phase2_drafts.status = 'not_ready';
  update public.phase2_drafts set status = 'ready' where event_id = p_event_id and status = 'not_ready';

  v_result_version := public.koshien_result_version(p_event_id);
  insert into public.koshien_later_rounds (
    event_id, phase_key, status, opens_at, deadline_at, source_results_version, snapshot
  ) values (
    p_event_id, 'revenge', 'ready',
    p_opens_at, p_deadline_at, v_result_version, jsonb_build_object('best16_team_ids', v_best16)
  ) on conflict (event_id, phase_key) do nothing;

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
    ) on conflict (event_id, player_id) do update set
      eligible = excluded.eligible, allowed_team_ids = excluded.allowed_team_ids,
      fallback_allowed = excluded.fallback_allowed, source_results_version = excluded.source_results_version;
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
  values (p_event_id, 'zombie', 'ready',
    p_opens_at, p_deadline_at, v_result_version, jsonb_build_object('best4_team_ids', v_best4))
  on conflict (event_id, phase_key) do nothing;
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
      v_result_version)
    on conflict (event_id, player_id) do update set eligible = excluded.eligible,
      allowed_team_ids = excluded.allowed_team_ids, source_results_version = excluded.source_results_version;
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
declare
  v_league_id uuid;
  v_team_a_id uuid;
  v_team_b_id uuid;
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
    p_event_id, 'phase3', 'ready',
    p_opens_at, p_deadline_at, public.koshien_result_version(p_event_id),
    jsonb_build_object('team_a_id', v_team_a_id, 'team_b_id', v_team_b_id), v_team_a_id, v_team_b_id
  ) on conflict (event_id, phase_key) do nothing;
  return public.get_koshien_later_phase_state(p_event_id);
end;
$$;

create or replace function public.get_koshien_later_phase_state(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_player_id uuid;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_member(v_league_id) then
    raise exception 'league membership is required' using errcode = '42501';
  end if;
  select p.id into v_player_id from public.players p where p.league_id = v_league_id and p.profile_id = auth.uid();
  return jsonb_build_object(
    'event_id', p_event_id,
    'viewer_player_id', v_player_id,
    'is_admin', public.is_league_admin(v_league_id),
    'rounds', coalesce((select jsonb_object_agg(r.phase_key, to_jsonb(r)) from public.koshien_later_rounds r where r.event_id = p_event_id), '{}'::jsonb),
    'revenge', jsonb_build_object(
      'eligibility', (select to_jsonb(x) from public.koshien_revenge_eligibility x where x.event_id = p_event_id and x.player_id = v_player_id),
      'pick', (select to_jsonb(x) from public.revenge_picks x where x.event_id = p_event_id and x.player_id = v_player_id)
    ),
    'zombie', jsonb_build_object(
      'eligibility', (select to_jsonb(x) from public.koshien_zombie_eligibility x where x.event_id = p_event_id and x.player_id = v_player_id),
      'prediction', (select to_jsonb(x) from public.zombie_predictions x where x.event_id = p_event_id and x.player_id = v_player_id)
    ),
    'phase3', jsonb_build_object(
      'prediction', (select to_jsonb(x) from public.final_score_predictions x where x.event_id = p_event_id and x.player_id = v_player_id)
    ),
    'official_scores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', s.player_id,
        'profile_id', p.profile_id,
        'display_name', p.display_name,
        'phase1_score', s.phase1_score,
        'revenge_score', s.revenge_score,
        'phase2_score', s.phase2_score,
        'zombie_score', s.zombie_score,
        'phase3_score', s.phase3_score,
        'total_score', s.total_score,
        'breakdown', s.breakdown
      ) order by s.total_score desc, p.id)
      from public.scores s join public.players p on p.id=s.player_id
      where s.event_id=p_event_id
    ), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'sqrt_odds', least(t.sqrt_odds, 50))) from public.teams t where t.event_id = p_event_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_koshien_revenge_pick(p_event_id text, p_target_team_id uuid, p_expected_version bigint, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_round public.koshien_later_rounds; v_player_id uuid; v_allowed uuid[]; v_existing public.revenge_picks;
begin
  select r.* into v_round from public.koshien_later_rounds r where r.event_id=p_event_id and r.phase_key='revenge' for update;
  if auth.uid() is null or v_round.id is null then raise exception 'revenge round is unavailable' using errcode='42501'; end if;
  if v_round.status <> 'open' or clock_timestamp() < v_round.opens_at or clock_timestamp() >= v_round.deadline_at then raise exception 'revenge round is closed' using errcode='55000'; end if;
  if v_round.version <> p_expected_version then raise exception 'revenge version conflict' using errcode='40001'; end if;
  select p.id into v_player_id from public.players p join public.events e on e.league_id=p.league_id where e.id=p_event_id and p.profile_id=auth.uid();
  select x.allowed_team_ids into v_allowed from public.koshien_revenge_eligibility x where x.event_id=p_event_id and x.player_id=v_player_id and x.eligible;
  if v_allowed is null or not (p_target_team_id=any(v_allowed)) then raise exception 'revenge team is not allowed' using errcode='42501'; end if;
  select x.* into v_existing from public.revenge_picks x where x.event_id=p_event_id and x.player_id=v_player_id;
  if v_existing.request_id=p_request_id and v_existing.target_team_id is distinct from p_target_team_id then raise exception 'request_id payload conflict' using errcode='23505'; end if;
  insert into public.revenge_picks(event_id,player_id,target_team_id,request_id,payload)
  values(p_event_id,v_player_id,p_target_team_id,p_request_id,jsonb_build_object('round_version',v_round.version))
  on conflict(event_id,player_id) do update set target_team_id=excluded.target_team_id,request_id=excluded.request_id,payload=excluded.payload,updated_at=now();
  return public.get_koshien_later_phase_state(p_event_id);
end $$;

create or replace function public.save_koshien_zombie_prediction(p_event_id text, p_target_team_id uuid, p_expected_version bigint, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_round public.koshien_later_rounds; v_player_id uuid; v_allowed uuid[]; v_existing public.zombie_predictions;
begin
  select r.* into v_round from public.koshien_later_rounds r where r.event_id=p_event_id and r.phase_key='zombie' for update;
  if auth.uid() is null or v_round.id is null then raise exception 'zombie round is unavailable' using errcode='42501'; end if;
  if v_round.status <> 'open' or clock_timestamp() < v_round.opens_at or clock_timestamp() >= v_round.deadline_at then raise exception 'zombie round is closed' using errcode='55000'; end if;
  if v_round.version <> p_expected_version then raise exception 'zombie version conflict' using errcode='40001'; end if;
  select p.id into v_player_id from public.players p join public.events e on e.league_id=p.league_id where e.id=p_event_id and p.profile_id=auth.uid();
  select x.allowed_team_ids into v_allowed from public.koshien_zombie_eligibility x where x.event_id=p_event_id and x.player_id=v_player_id and x.eligible;
  if v_allowed is null or not (p_target_team_id=any(v_allowed)) then raise exception 'zombie team is not allowed' using errcode='42501'; end if;
  select x.* into v_existing from public.zombie_predictions x where x.event_id=p_event_id and x.player_id=v_player_id;
  if v_existing.request_id=p_request_id and v_existing.team_id is distinct from p_target_team_id then raise exception 'request_id payload conflict' using errcode='23505'; end if;
  insert into public.zombie_predictions(event_id,player_id,team_id,request_id,payload)
  values(p_event_id,v_player_id,p_target_team_id,p_request_id,jsonb_build_object('round_version',v_round.version))
  on conflict(event_id,player_id) do update set team_id=excluded.team_id,request_id=excluded.request_id,payload=excluded.payload,updated_at=now();
  return public.get_koshien_later_phase_state(p_event_id);
end $$;

create or replace function public.save_koshien_phase3_prediction(p_event_id text, p_score_a integer, p_score_b integer, p_expected_version bigint, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_round public.koshien_later_rounds; v_player_id uuid; v_existing public.final_score_predictions;
begin
  select r.* into v_round from public.koshien_later_rounds r where r.event_id=p_event_id and r.phase_key='phase3' for update;
  if auth.uid() is null or v_round.id is null then raise exception 'phase 3 round is unavailable' using errcode='42501'; end if;
  if v_round.status <> 'open' or clock_timestamp() < v_round.opens_at or clock_timestamp() >= v_round.deadline_at then raise exception 'phase 3 round is closed' using errcode='55000'; end if;
  if v_round.version <> p_expected_version then raise exception 'phase 3 version conflict' using errcode='40001'; end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 or p_score_a=p_score_b then raise exception 'valid non-tied scores are required'; end if;
  select p.id into v_player_id from public.players p join public.events e on e.league_id=p.league_id where e.id=p_event_id and p.profile_id=auth.uid();
  if v_player_id is null then raise exception 'event player is required' using errcode='42501'; end if;
  select x.* into v_existing from public.final_score_predictions x where x.event_id=p_event_id and x.player_id=v_player_id;
  if v_existing.request_id=p_request_id and (v_existing.predicted_score_a is distinct from p_score_a or v_existing.predicted_score_b is distinct from p_score_b) then raise exception 'request_id payload conflict' using errcode='23505'; end if;
  insert into public.final_score_predictions(event_id,player_id,champion_team_id,runner_up_team_id,predicted_score_a,predicted_score_b,request_id)
  values(p_event_id,v_player_id,v_round.team_a_id,v_round.team_b_id,p_score_a,p_score_b,p_request_id)
  on conflict(event_id,player_id) do update set champion_team_id=excluded.champion_team_id,runner_up_team_id=excluded.runner_up_team_id,
    predicted_score_a=excluded.predicted_score_a,predicted_score_b=excluded.predicted_score_b,request_id=excluded.request_id,updated_at=now();
  return public.get_koshien_later_phase_state(p_event_id);
end $$;

create or replace function public.koshien_phase3_points(p_event_id text, p_player_id uuid)
returns numeric language plpgsql stable security invoker set search_path = '' as $$
declare v_score_a integer; v_score_b integer; v_player_metric integer[]; v_best_metric integer[];
begin
  select m.team1_score,m.team2_score into v_score_a,v_score_b from public.matches m
  where m.event_id=p_event_id and m.round_key='F' and m.status='completed' order by m.match_no limit 1;
  if v_score_a is null or v_score_b is null then return 0; end if;
  if exists(select 1 from public.final_score_predictions fsp where fsp.event_id=p_event_id and fsp.predicted_score_a=v_score_a and fsp.predicted_score_b=v_score_b) then
    return case when exists(select 1 from public.final_score_predictions fsp where fsp.event_id=p_event_id and fsp.player_id=p_player_id and fsp.predicted_score_a=v_score_a and fsp.predicted_score_b=v_score_b) then 50 else 0 end;
  end if;
  select array[
    abs(fsp.predicted_score_a - v_score_a) + abs(fsp.predicted_score_b - v_score_b),
    case when sign(fsp.predicted_score_a-fsp.predicted_score_b)=sign(v_score_a-v_score_b) then 0 else 1 end,
    abs((fsp.predicted_score_a-fsp.predicted_score_b)-(v_score_a-v_score_b)),
    abs((fsp.predicted_score_a+fsp.predicted_score_b)-(v_score_a+v_score_b))
  ] into v_player_metric from public.final_score_predictions fsp where fsp.event_id=p_event_id and fsp.player_id=p_player_id;
  select array[
    abs(fsp.predicted_score_a - v_score_a) + abs(fsp.predicted_score_b - v_score_b),
    case when sign(fsp.predicted_score_a-fsp.predicted_score_b)=sign(v_score_a-v_score_b) then 0 else 1 end,
    abs((fsp.predicted_score_a-fsp.predicted_score_b)-(v_score_a-v_score_b)),
    abs((fsp.predicted_score_a+fsp.predicted_score_b)-(v_score_a+v_score_b))
  ] into v_best_metric from public.final_score_predictions fsp where fsp.event_id=p_event_id
  order by 1 limit 1;
  return case when v_player_metric=v_best_metric then 30 else 0 end;
end $$;

create or replace function public.recompute_koshien_later_score()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare v_finish text; v_revenge numeric:=0; v_zombie numeric:=0; v_phase3 numeric:=0; v_previous_total numeric:=0;
begin
  select public.koshien_team_finish(new.event_id,rp.target_team_id),
    greatest(0, public.koshien_arrival_points(public.koshien_team_finish(new.event_id,rp.target_team_id)) - 1.5) * least(t.sqrt_odds,50)
  into v_finish,v_revenge from public.revenge_picks rp join public.teams t on t.id=rp.target_team_id
  where rp.event_id=new.event_id and rp.player_id=new.player_id;
  select coalesce(sum(hit.adjustment),0) into v_zombie from (
    select case when count(*) >= 2 then -40 when count(*) = 1 then -20 else 0 end as adjustment
    from public.phase2_draft_picks dp
    join public.phase2_drafts d on d.id=dp.draft_id
    join public.zombie_predictions zp on zp.event_id=d.event_id and zp.team_id=dp.team_id
    where d.event_id=new.event_id and dp.player_id=new.player_id and public.koshien_team_finish(new.event_id,dp.team_id)='best4'
    group by dp.team_id
  ) hit;
  v_phase3:=public.koshien_phase3_points(new.event_id,new.player_id);
  v_previous_total:=coalesce(new.phase1_score,0)+coalesce(new.phase2_score,0)+coalesce(new.revenge_score,0)+coalesce(new.zombie_score,0)+coalesce(new.phase3_score,0);
  new.revenge_score:=coalesce(v_revenge,0); new.zombie_score:=coalesce(v_zombie,0); new.phase3_score:=coalesce(v_phase3,0);
  new.breakdown:=jsonb_set(coalesce(new.breakdown,'{}'::jsonb),'{revenge}',to_jsonb(new.revenge_score),true);
  new.breakdown:=jsonb_set(new.breakdown,'{zombie}',to_jsonb(new.zombie_score),true);
  new.breakdown:=jsonb_set(new.breakdown,'{phase3}',to_jsonb(new.phase3_score),true);
  new.breakdown:=jsonb_set(new.breakdown,'{total}',to_jsonb(
    coalesce(new.phase1_score,0)+coalesce(new.phase2_score,0)+new.revenge_score+new.zombie_score+new.phase3_score
  ),true);
  return new;
end $$;

drop trigger if exists scores_recompute_koshien_later on public.scores;
create trigger scores_recompute_koshien_later before insert or update on public.scores
for each row execute function public.recompute_koshien_later_score();

alter table public.koshien_later_rounds enable row level security;
alter table public.koshien_revenge_eligibility enable row level security;
alter table public.koshien_zombie_eligibility enable row level security;
create policy koshien_later_rounds_select_members on public.koshien_later_rounds for select to authenticated
using (exists(select 1 from public.events e where e.id=event_id and public.is_league_member(e.league_id)));
create policy koshien_revenge_eligibility_select_self_admin on public.koshien_revenge_eligibility for select to authenticated
using (exists(select 1 from public.players p join public.events e on e.league_id=p.league_id where p.id=player_id and e.id=event_id and (p.profile_id=auth.uid() or public.is_league_admin(e.league_id))));
create policy koshien_zombie_eligibility_select_self_admin on public.koshien_zombie_eligibility for select to authenticated
using (exists(select 1 from public.players p join public.events e on e.league_id=p.league_id where p.id=player_id and e.id=event_id and (p.profile_id=auth.uid() or public.is_league_admin(e.league_id))));

revoke all on public.koshien_later_rounds,public.koshien_revenge_eligibility,public.koshien_zombie_eligibility from anon,public;
grant select on public.koshien_later_rounds,public.koshien_revenge_eligibility,public.koshien_zombie_eligibility to authenticated;
revoke insert,update,delete on public.revenge_picks,public.zombie_predictions,public.final_score_predictions from authenticated;

revoke execute on function public.prepare_koshien_best16_phases(text,timestamptz,timestamptz) from anon,public;
revoke execute on function public.prepare_koshien_zombie_phase(text,timestamptz,timestamptz) from anon,public;
revoke execute on function public.prepare_koshien_phase3(text,timestamptz,timestamptz) from anon,public;
revoke execute on function public.get_koshien_later_phase_state(text) from anon,public;
revoke execute on function public.save_koshien_revenge_pick(text,uuid,bigint,uuid) from anon, public;
revoke execute on function public.save_koshien_zombie_prediction(text,uuid,bigint,uuid) from anon, public;
revoke execute on function public.save_koshien_phase3_prediction(text,integer,integer,bigint,uuid) from anon, public;
grant execute on function public.prepare_koshien_best16_phases(text,timestamptz,timestamptz) to authenticated;
grant execute on function public.prepare_koshien_zombie_phase(text,timestamptz,timestamptz) to authenticated;
grant execute on function public.prepare_koshien_phase3(text,timestamptz,timestamptz) to authenticated;
grant execute on function public.get_koshien_later_phase_state(text) to authenticated;
grant execute on function public.save_koshien_revenge_pick(text,uuid,bigint,uuid) to authenticated;
grant execute on function public.save_koshien_zombie_prediction(text,uuid,bigint,uuid) to authenticated;
grant execute on function public.save_koshien_phase3_prediction(text,integer,integer,bigint,uuid) to authenticated;
revoke execute on function public.recompute_koshien_later_score() from anon,public;

notify pgrst, 'reload schema';
commit;
