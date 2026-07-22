-- Minimal, isolated event used to verify the JHBF semi-automatic import flow.
-- It is deliberately limited to one historical game and can only be managed by league admins.

create or replace function public.create_jhbf_import_test_event(p_reference_event_id text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_event_id text;
  v_existing public.events;
  v_config jsonb;
  v_results jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select e.league_id
  into v_league_id
  from public.events e
  where e.id = p_reference_event_id;

  if v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;

  v_event_id := 'jhbf-import-test-' || replace(v_league_id::text, '-', '');

  select e.*
  into v_existing
  from public.events e
  where e.id = v_event_id;

  if v_existing.id is not null then
    if v_existing.name <> '【TEST】高野連結果取込確認'
      or v_existing.rules->'testHarness'->>'kind' is distinct from 'jhbf_minimal_import' then
      raise exception 'test event id is already used by another event' using errcode = '23505';
    end if;

    update public.events
    set updated_at = clock_timestamp()
    where id = v_event_id;

    return jsonb_build_object(
      'ok', true,
      'created', false,
      'eventId', v_event_id,
      'name', v_existing.name
    );
  end if;

  v_config := jsonb_build_object(
    'teams', jsonb_build_array('聖光学院', '山梨学院'),
    'pickCount', 1,
    'phase2DraftCount', 1,
    'activePhase', 'phase1',
    'teamMeta', jsonb_build_object(
      '聖光学院', jsonb_build_object('startRound', 2, 'odds', 1, 'sqrtOdds', 1),
      '山梨学院', jsonb_build_object('startRound', 2, 'odds', 1, 'sqrtOdds', 1)
    ),
    'stagePoints', jsonb_build_object(
      'initial_loss', 0,
      'first_win_then_loss', 1,
      'best16', 1.5,
      'best8', 2,
      'best4', 2.5,
      'runner_up', 3.5,
      'champion', 5
    ),
    'phase2Points', jsonb_build_object('best16', 0, 'best8', 20, 'best4', 40, 'runner_up', 60, 'champion', 100),
    'captainMultiplier', 1.2,
    'sqrtOddsCap', 50,
    'revengeMode', 'full',
    'zombieEnabled', true,
    'externalResults', jsonb_build_object(
      'competitionType', 'summer',
      'year', 2025,
      'baseDate', '2025-08-12'
    ),
    'testHarness', jsonb_build_object(
      'kind', 'jhbf_minimal_import',
      'source', 'jhbf',
      'competitionType', 'summer',
      'year', 2025,
      'baseDate', '2025-08-12',
      'externalKey', 'jhbf:summer:2025:2025-08-12:1'
    )
  );

  v_results := jsonb_build_object(
    'finishes', '{}'::jsonb,
    'directEliminators', '{}'::jsonb,
    'matches', jsonb_build_array(jsonb_build_object(
      'match_id', 'R2-1',
      'round', 'R2',
      'match_no', 1,
      'team_a_id', '聖光学院',
      'team_b_id', '山梨学院',
      'score_a', '',
      'score_b', '',
      'winner_id', '',
      'loser_id', '',
      'status', 'scheduled'
    )),
    'matchMessage', null,
    'finalScore', jsonb_build_object(
      'champion', '',
      'runnerUp', '',
      'championScore', '',
      'runnerUpScore', ''
    )
  );

  insert into public.events (
    id, league_id, name, preset_type, status, prediction_deadline,
    rules, created_by, sport_type, season, current_phase, rules_config,
    created_at, updated_at
  ) values (
    v_event_id,
    v_league_id,
    '【TEST】高野連結果取込確認',
    'koshien',
    'resultWait',
    null,
    jsonb_build_object(
      'approvalPolicy', 'half',
      'config', v_config,
      'testHarness', v_config->'testHarness'
    ),
    auth.uid(),
    'baseball',
    '2025-test',
    'phase1',
    v_config,
    clock_timestamp(),
    clock_timestamp()
  );

  insert into public.event_teams (event_id, name, seed, metadata)
  values
    (v_event_id, '聖光学院', 1, jsonb_build_object('source', 'jhbf-test-harness')),
    (v_event_id, '山梨学院', 2, jsonb_build_object('source', 'jhbf-test-harness'));

  insert into public.teams (
    event_id, name, region, seed, start_round, odds, sqrt_odds,
    metadata, team_id, school_name, prefecture, sqrt_odds_capped
  ) values
    (
      v_event_id, '聖光学院', '福島', 1, 2, 1, 1,
      jsonb_build_object('source', 'jhbf-test-harness'),
      'jhbf-test-seiko-gakuin', '聖光学院', '福島', 1
    ),
    (
      v_event_id, '山梨学院', '山梨', 2, 2, 1, 1,
      jsonb_build_object('source', 'jhbf-test-harness'),
      'jhbf-test-yamanashi-gakuin', '山梨学院', '山梨', 1
    );

  insert into public.results (event_id, payload, updated_by, updated_at)
  values (v_event_id, v_results, auth.uid(), clock_timestamp());

  return jsonb_build_object(
    'ok', true,
    'created', true,
    'eventId', v_event_id,
    'name', '【TEST】高野連結果取込確認'
  );
end;
$$;

create or replace function public.reset_jhbf_import_test_event(p_event_id text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
  v_config jsonb;
  v_results jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select e.*
  into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null
    or v_event.name <> '【TEST】高野連結果取込確認'
    or v_event.rules->'testHarness'->>'kind' is distinct from 'jhbf_minimal_import'
    or v_event.id <> 'jhbf-import-test-' || replace(v_event.league_id::text, '-', '') then
    raise exception 'only the marked JHBF import test event can be reset' using errcode = '42501';
  end if;

  if not public.is_league_admin(v_event.league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;

  v_config := jsonb_build_object(
    'teams', jsonb_build_array('聖光学院', '山梨学院'),
    'pickCount', 1,
    'phase2DraftCount', 1,
    'activePhase', 'phase1',
    'teamMeta', jsonb_build_object(
      '聖光学院', jsonb_build_object('startRound', 2, 'odds', 1, 'sqrtOdds', 1),
      '山梨学院', jsonb_build_object('startRound', 2, 'odds', 1, 'sqrtOdds', 1)
    ),
    'stagePoints', jsonb_build_object(
      'initial_loss', 0,
      'first_win_then_loss', 1,
      'best16', 1.5,
      'best8', 2,
      'best4', 2.5,
      'runner_up', 3.5,
      'champion', 5
    ),
    'phase2Points', jsonb_build_object('best16', 0, 'best8', 20, 'best4', 40, 'runner_up', 60, 'champion', 100),
    'captainMultiplier', 1.2,
    'sqrtOddsCap', 50,
    'revengeMode', 'full',
    'zombieEnabled', true,
    'externalResults', jsonb_build_object(
      'competitionType', 'summer',
      'year', 2025,
      'baseDate', '2025-08-12'
    ),
    'testHarness', jsonb_build_object(
      'kind', 'jhbf_minimal_import',
      'source', 'jhbf',
      'competitionType', 'summer',
      'year', 2025,
      'baseDate', '2025-08-12',
      'externalKey', 'jhbf:summer:2025:2025-08-12:1'
    )
  );

  v_results := jsonb_build_object(
    'finishes', '{}'::jsonb,
    'directEliminators', '{}'::jsonb,
    'matches', jsonb_build_array(jsonb_build_object(
      'match_id', 'R2-1',
      'round', 'R2',
      'match_no', 1,
      'team_a_id', '聖光学院',
      'team_b_id', '山梨学院',
      'score_a', '',
      'score_b', '',
      'winner_id', '',
      'loser_id', '',
      'status', 'scheduled'
    )),
    'matchMessage', null,
    'finalScore', jsonb_build_object(
      'champion', '',
      'runnerUp', '',
      'championScore', '',
      'runnerUpScore', ''
    )
  );

  delete from public.events
  where id = p_event_id;

  insert into public.events (
    id, league_id, name, preset_type, status, prediction_deadline,
    rules, created_by, sport_type, season, current_phase, rules_config,
    created_at, updated_at
  ) values (
    p_event_id,
    v_event.league_id,
    '【TEST】高野連結果取込確認',
    'koshien',
    'resultWait',
    null,
    jsonb_build_object(
      'approvalPolicy', 'half',
      'config', v_config,
      'testHarness', v_config->'testHarness'
    ),
    auth.uid(),
    'baseball',
    '2025-test',
    'phase1',
    v_config,
    clock_timestamp(),
    clock_timestamp()
  );

  insert into public.event_teams (event_id, name, seed, metadata)
  values
    (p_event_id, '聖光学院', 1, jsonb_build_object('source', 'jhbf-test-harness')),
    (p_event_id, '山梨学院', 2, jsonb_build_object('source', 'jhbf-test-harness'));

  insert into public.teams (
    event_id, name, region, seed, start_round, odds, sqrt_odds,
    metadata, team_id, school_name, prefecture, sqrt_odds_capped
  ) values
    (
      p_event_id, '聖光学院', '福島', 1, 2, 1, 1,
      jsonb_build_object('source', 'jhbf-test-harness'),
      'jhbf-test-seiko-gakuin', '聖光学院', '福島', 1
    ),
    (
      p_event_id, '山梨学院', '山梨', 2, 2, 1, 1,
      jsonb_build_object('source', 'jhbf-test-harness'),
      'jhbf-test-yamanashi-gakuin', '山梨学院', '山梨', 1
    );

  insert into public.results (event_id, payload, updated_by, updated_at)
  values (p_event_id, v_results, auth.uid(), clock_timestamp());

  return jsonb_build_object(
    'ok', true,
    'reset', true,
    'eventId', p_event_id,
    'name', '【TEST】高野連結果取込確認'
  );
end;
$$;

create or replace function public.delete_jhbf_import_test_event(p_event_id text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_event public.events;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select e.*
  into v_event
  from public.events e
  where e.id = p_event_id;

  if v_event.id is null
    or v_event.name <> '【TEST】高野連結果取込確認'
    or v_event.rules->'testHarness'->>'kind' is distinct from 'jhbf_minimal_import'
    or v_event.id <> 'jhbf-import-test-' || replace(v_event.league_id::text, '-', '') then
    raise exception 'only the marked JHBF import test event can be deleted' using errcode = '42501';
  end if;

  if not public.is_league_admin(v_event.league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;

  delete from public.events
  where id = p_event_id;

  return jsonb_build_object('ok', true, 'deleted', true, 'eventId', p_event_id);
end;
$$;

revoke all on function public.create_jhbf_import_test_event(text) from public, anon;
revoke all on function public.reset_jhbf_import_test_event(text) from public, anon;
revoke all on function public.delete_jhbf_import_test_event(text) from public, anon;

grant execute on function public.create_jhbf_import_test_event(text) to authenticated;
grant execute on function public.reset_jhbf_import_test_event(text) to authenticated;
grant execute on function public.delete_jhbf_import_test_event(text) to authenticated;
