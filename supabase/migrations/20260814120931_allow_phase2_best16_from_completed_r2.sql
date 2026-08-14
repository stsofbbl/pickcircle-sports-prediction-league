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

  if cardinality(v_best16) <> 16 then
    select array_agg(m.winner_team_id order by m.match_no) into v_best16
    from public.matches m
    where m.event_id = p_event_id
      and m.round_key = 'R2'
      and m.status = 'completed'
      and m.winner_team_id is not null;
  end if;

  if cardinality(v_best16) <> 16 then
    raise exception 'exactly sixteen official best16 teams are required';
  end if;

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
