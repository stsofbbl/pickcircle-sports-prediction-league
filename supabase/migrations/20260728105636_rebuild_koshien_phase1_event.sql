do $$
declare
  v_old_event_id constant text := '27dbc2eb-3a6f-4b1a-9d2c-caf05a0b3b2d';
  v_event_id constant text := '2930e8b6-0fe7-45c4-bcf6-edeb8b1407f0';
  v_event public.events%rowtype;
  v_team_count integer;
  v_teams_json jsonb;
  v_team_meta_json jsonb;
  v_config jsonb;
  v_rules jsonb;
begin
  select e.*
  into v_event
  from public.events e
  where e.id = v_event_id
  for update;

  if v_event.id is null then
    if exists (select 1 from public.events where id = v_old_event_id) then
      raise exception 'koshien rebuild source event is missing';
    end if;
    return;
  end if;

  if exists (
    select 1
    from public.events old_event
    where old_event.id = v_old_event_id
      and old_event.league_id <> v_event.league_id
  ) then
    raise exception 'koshien rebuild events belong to different leagues';
  end if;

  if not exists (select 1 from public.events where id = v_old_event_id)
     and v_event.status = 'open'
     and (select count(*) from public.event_teams where event_id = v_event_id) = 49
     and (
       select count(*)
       from public.event_teams
       where event_id = v_event_id
         and nullif(metadata ->> 'representative_key', '') is not null
     ) = 49
     and jsonb_array_length(coalesce(v_event.rules -> 'config' -> 'teams', '[]'::jsonb)) = 49 then
    return;
  end if;

  create temporary table koshien_phase1_rebuild_teams
  on commit drop
  as
  select
    et.name,
    row_number() over (order by et.seed, et.id)::integer as seed,
    et.metadata,
    coalesce(t.start_round, case when row_number() over (order by et.seed, et.id) <= 15 then 2 else 1 end)::integer as start_round,
    coalesce(t.odds, 1)::numeric(8, 2) as odds
  from public.event_teams et
  left join public.teams t
    on t.event_id = et.event_id
   and t.name = et.name
  where et.event_id = v_event_id
    and nullif(et.metadata ->> 'representative_key', '') is not null;

  select count(*)
  into v_team_count
  from koshien_phase1_rebuild_teams;

  if v_team_count <> 49
     or (select count(distinct metadata ->> 'representative_key') from koshien_phase1_rebuild_teams) <> 49
     or (select count(distinct metadata ->> 'district_key') from koshien_phase1_rebuild_teams) <> 49
     or (select count(distinct name) from koshien_phase1_rebuild_teams) <> 49 then
    raise exception 'koshien rebuild requires exactly 49 unique official representatives';
  end if;

  select
    jsonb_agg(name order by seed),
    jsonb_object_agg(
      name,
      jsonb_build_object(
        'startRound', start_round,
        'odds', odds,
        'sqrtOdds', round(sqrt(odds), 3),
        'district', metadata ->> 'district',
        'source', coalesce(metadata ->> 'source', 'jhbf'),
        'sourceYear', coalesce((metadata ->> 'source_year')::integer, 2026)
      )
    )
  into v_teams_json, v_team_meta_json
  from koshien_phase1_rebuild_teams;

  v_config := coalesce(v_event.rules -> 'config', '{}'::jsonb)
    || jsonb_build_object(
      'teams', v_teams_json,
      'teamMeta', v_team_meta_json,
      'activePhase', 'phase1'
    );
  v_rules := coalesce(v_event.rules, '{}'::jsonb)
    || jsonb_build_object(
      'config', v_config,
      'resultFlow', jsonb_build_object(
        'status', 'none',
        'submittedBy', '',
        'submittedAt', '',
        'approvals', '{}'::jsonb,
        'finalizedAt', ''
      )
    );

  delete from public.events
  where id in (v_old_event_id, v_event_id);

  insert into public.events (
    id,
    league_id,
    name,
    preset_type,
    status,
    prediction_deadline,
    rules,
    created_by,
    created_at,
    updated_at,
    sport_type,
    season,
    current_phase,
    rules_config,
    archived_at
  ) values (
    v_event.id,
    v_event.league_id,
    v_event.name,
    'koshien',
    'open',
    v_event.prediction_deadline,
    v_rules,
    v_event.created_by,
    v_event.created_at,
    now(),
    coalesce(v_event.sport_type, 'baseball'),
    coalesce(v_event.season, '2026'),
    'setup',
    v_config,
    null
  );

  insert into public.event_teams (event_id, name, seed, metadata)
  select v_event_id, name, seed, metadata
  from koshien_phase1_rebuild_teams
  order by seed;

  insert into public.teams (
    event_id,
    name,
    team_id,
    school_name,
    region,
    prefecture,
    seed,
    start_round,
    odds,
    metadata
  )
  select
    v_event_id,
    name,
    'koshien-2026-' || seed,
    name,
    metadata ->> 'district',
    metadata ->> 'district',
    seed,
    start_round,
    odds,
    metadata || jsonb_build_object('sqrt_odds_snapshot', round(sqrt(odds), 4))
  from koshien_phase1_rebuild_teams
  order by seed;

  if (select count(*) from public.event_teams where event_id = v_event_id) <> 49
     or (select count(*) from public.teams where event_id = v_event_id) <> 49
     or exists (
       select 1
       from public.event_teams
       where event_id = v_event_id
         and nullif(metadata ->> 'representative_key', '') is null
     ) then
    raise exception 'koshien rebuild verification failed';
  end if;
end
$$;
