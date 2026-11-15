-- PROTOTYPE ONLY. Requires koshien-approval-revision.sql.
-- Keep the save RPC SECURITY INVOKER so its existing RLS still applies.
CREATE FUNCTION yoso_approval_private.begin_result_write(p_event_id text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_league uuid; v_revision bigint;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication is required' USING ERRCODE='42501';
  END IF;
  SELECT league_id INTO v_league FROM public.events WHERE id=p_event_id;
  IF v_league IS NULL OR NOT public.is_league_admin(v_league) THEN
    RAISE EXCEPTION 'league admin permission is required' USING ERRCODE='42501';
  END IF;
  v_revision := yoso_approval_private.lock_revision(p_event_id);
  -- Recheck after waiting for another event writer.
  IF NOT public.is_league_admin(v_league) THEN
    RAISE EXCEPTION 'league admin permission is required' USING ERRCODE='42501';
  END IF;
  RETURN yoso_approval_private.advance_revision(p_event_id,v_revision);
END;
$$;
REVOKE ALL ON FUNCTION yoso_approval_private.begin_result_write(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION yoso_approval_private.lock_revision(text) FROM authenticated, anon;
REVOKE ALL ON FUNCTION yoso_approval_private.advance_revision(text,bigint) FROM authenticated, anon;
REVOKE ALL ON yoso_approval_private.revisions FROM authenticated, anon;
GRANT USAGE ON SCHEMA yoso_approval_private TO authenticated;
GRANT EXECUTE ON FUNCTION yoso_approval_private.begin_result_write(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.save_koshien_result_snapshot(p_event_id text, p_match_rows jsonb, p_score_rows jsonb, p_results_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_league_id uuid;
  v_match_count integer := 0;
  v_score_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id;

  if v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  perform yoso_approval_private.begin_result_write(p_event_id);

  if jsonb_typeof(coalesce(p_match_rows, 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_score_rows, 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_results_payload, 'null'::jsonb)) <> 'object' then
    raise exception 'match rows and score rows must be arrays and results payload must be an object';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_match_rows) as item
    where item->>'status' = 'completed'
      and (
        jsonb_typeof(item->'team1_score') <> 'number'
        or jsonb_typeof(item->'team2_score') <> 'number'
        or item->>'team1_score' !~ '^[0-9]+$'
        or item->>'team2_score' !~ '^[0-9]+$'
      )
  ) then
    raise exception 'completed match scores must be non-negative integers';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_match_rows) as x(
      event_id text, round_key text, match_no integer, team1_id uuid, team2_id uuid,
      team1_score integer, team2_score integer, winner_team_id uuid, loser_team_id uuid, status text
    )
    left join public.teams t1 on t1.id = x.team1_id and t1.event_id = p_event_id
    left join public.teams t2 on t2.id = x.team2_id and t2.event_id = p_event_id
    left join public.teams tw on tw.id = x.winner_team_id and tw.event_id = p_event_id
    left join public.teams tl on tl.id = x.loser_team_id and tl.event_id = p_event_id
    where x.event_id is distinct from p_event_id
      or x.round_key is null
      or x.match_no is null
      or x.status is null
      or x.status not in ('scheduled', 'completed')
      or t1.id is null
      or t2.id is null
      or x.team1_id = x.team2_id
      or (
        x.status = 'scheduled'
        and (x.team1_score is not null or x.team2_score is not null or x.winner_team_id is not null or x.loser_team_id is not null)
      )
      or (
        x.status = 'completed'
        and (
          x.team1_score is null
          or x.team2_score is null
          or x.team1_score < 0
          or x.team2_score < 0
          or x.team1_score = x.team2_score
          or tw.id is null
          or tl.id is null
          or x.winner_team_id = x.loser_team_id
          or x.winner_team_id not in (x.team1_id, x.team2_id)
          or x.loser_team_id not in (x.team1_id, x.team2_id)
          or (x.team1_score > x.team2_score and (x.winner_team_id <> x.team1_id or x.loser_team_id <> x.team2_id))
          or (x.team2_score > x.team1_score and (x.winner_team_id <> x.team2_id or x.loser_team_id <> x.team1_id))
        )
      )
  ) then
    raise exception 'matches payload contains an invalid event, status, or team reference';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_score_rows) as x(event_id text, player_id uuid)
    left join public.players p on p.id = x.player_id and p.league_id = v_league_id
    where x.event_id is distinct from p_event_id or p.id is null
  ) then
    raise exception 'scores payload contains an invalid event or player reference';
  end if;

  insert into public.matches (
    event_id, round_key, match_no, team1_id, team2_id, team1_score, team2_score,
    winner_team_id, loser_team_id, status, metadata, updated_at
  )
  select
    p_event_id, x.round_key, x.match_no, x.team1_id, x.team2_id, x.team1_score, x.team2_score,
    x.winner_team_id, x.loser_team_id, x.status, coalesce(x.metadata, '{}'::jsonb), now()
  from jsonb_to_recordset(p_match_rows) as x(
    event_id text, round_key text, match_no integer, team1_id uuid, team2_id uuid,
    team1_score integer, team2_score integer, winner_team_id uuid, loser_team_id uuid,
    status text, metadata jsonb
  )
  on conflict (event_id, round_key, match_no) do update set
    team1_id = excluded.team1_id,
    team2_id = excluded.team2_id,
    team1_score = excluded.team1_score,
    team2_score = excluded.team2_score,
    winner_team_id = excluded.winner_team_id,
    loser_team_id = excluded.loser_team_id,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = now();
  get diagnostics v_match_count = row_count;

  insert into public.scores (
    event_id, player_id, phase1_score, phase2_score, phase3_score,
    revenge_score, zombie_score, breakdown, updated_at
  )
  select
    p_event_id, p.id, 0, 0, 0, 0, 0, '{}'::jsonb, now()
  from public.players p
  where p.league_id = v_league_id
  on conflict (event_id, player_id) do update set
    updated_at = now();
  get diagnostics v_score_count = row_count;

  insert into public.results (event_id, payload, updated_by, updated_at)
  values (p_event_id, p_results_payload, auth.uid(), now())
  on conflict (event_id) do update set
    payload = excluded.payload,
    updated_by = excluded.updated_by,
    updated_at = now();

  return jsonb_build_object(
    'matches', v_match_count,
    'scores', v_score_count,
    'recomputed_scores', v_score_count,
    'results', 1
  );
end;
$function$
