create unique index if not exists teams_event_representative_key_key
  on public.teams (event_id, ((metadata ->> 'representative_key')))
  where nullif(metadata ->> 'representative_key', '') is not null;

create unique index if not exists teams_event_district_key_key
  on public.teams (event_id, ((metadata ->> 'district_key')))
  where nullif(metadata ->> 'district_key', '') is not null;

create or replace function public.replace_koshien_representatives(
  p_event_id text,
  p_rows jsonb,
  p_source_year integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_expected_districts text[] := array[
    '北北海道','南北海道','青森','岩手','宮城','秋田','山形',
    '福島','茨城','栃木','群馬','埼玉','千葉','東東京',
    '西東京','神奈川','山梨','新潟','長野','富山','石川',
    '福井','静岡','愛知','岐阜','三重','滋賀','京都',
    '大阪','兵庫','奈良','和歌山','鳥取','島根','岡山',
    '広島','山口','香川','徳島','愛媛','高知','福岡',
    '佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'
  ];
  v_missing text[];
  v_unexpected text[];
  v_duplicate_districts text[];
  v_duplicate_schools text[];
  v_row record;
  v_team_id uuid;
  v_kept_team_ids uuid[] := array[]::uuid[];
  v_team_count integer;
  v_teams_json jsonb;
  v_team_meta_json jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if v_event.id is null or v_event.preset_type <> 'koshien' then
    raise exception 'koshien event was not found' using errcode = 'P0002';
  end if;
  if not public.is_league_admin(v_event.league_id) then
    raise exception 'league admin is required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) <> 49 then
    raise exception 'representative_count_invalid: expected 49, got %',
      case when jsonb_typeof(p_rows) = 'array' then jsonb_array_length(p_rows) else 0 end
      using errcode = '22023';
  end if;

  with parsed as (
    select
      btrim(x.district_name) as district_name,
      btrim(x.school_name) as school_name,
      lower(regexp_replace(btrim(x.district_name), '[[:space:]　]+', '', 'g')) as district_key,
      lower(regexp_replace(btrim(x.school_name), '[[:space:]　]+', '', 'g')) as school_key
    from jsonb_to_recordset(p_rows) as x(district_name text, school_name text)
  )
  select array_agg(district_name order by district_name)
  into v_duplicate_districts
  from (
    select district_name
    from parsed
    group by district_name
    having count(*) > 1
  ) duplicates;

  with parsed as (
    select btrim(x.school_name) as school_name,
      lower(regexp_replace(btrim(x.school_name), '[[:space:]　]+', '', 'g')) as school_key
    from jsonb_to_recordset(p_rows) as x(district_name text, school_name text)
  )
  select array_agg(school_name order by school_name)
  into v_duplicate_schools
  from (
    select min(school_name) as school_name
    from parsed
    group by school_key
    having count(*) > 1
  ) duplicates;

  with supplied as (
    select distinct btrim(x.district_name) as district_name
    from jsonb_to_recordset(p_rows) as x(district_name text, school_name text)
  )
  select array_agg(expected order by expected)
  into v_missing
  from unnest(v_expected_districts) expected
  where not exists (select 1 from supplied s where s.district_name = expected);

  with supplied as (
    select distinct btrim(x.district_name) as district_name
    from jsonb_to_recordset(p_rows) as x(district_name text, school_name text)
  )
  select array_agg(s.district_name order by s.district_name)
  into v_unexpected
  from supplied s
  where not (s.district_name = any(v_expected_districts));

  if coalesce(cardinality(v_duplicate_districts), 0) > 0
     or coalesce(cardinality(v_missing), 0) > 0
     or coalesce(cardinality(v_unexpected), 0) > 0 then
    raise exception 'representative_districts_invalid: missing=%, duplicates=%, unexpected=%',
      coalesce(array_to_string(v_missing, ','), ''),
      coalesce(array_to_string(v_duplicate_districts, ','), ''),
      coalesce(array_to_string(v_unexpected, ','), '')
      using errcode = '22023';
  end if;
  if coalesce(cardinality(v_duplicate_schools), 0) > 0 then
    raise exception 'representative_schools_duplicate: %',
      array_to_string(v_duplicate_schools, ',')
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(district_name text, school_name text)
    where nullif(btrim(x.district_name), '') is null
       or nullif(btrim(x.school_name), '') is null
  ) then
    raise exception 'representative_school_or_district_is_empty' using errcode = '22023';
  end if;

  for v_row in
    select
      x.ordinality::integer as seed,
      btrim(x.item ->> 'district_name') as district_name,
      btrim(x.item ->> 'school_name') as school_name,
      lower(regexp_replace(btrim(x.item ->> 'district_name'), '[[:space:]　]+', '', 'g')) as district_key,
      lower(regexp_replace(btrim(x.item ->> 'school_name'), '[[:space:]　]+', '', 'g')) as school_key
    from jsonb_array_elements(p_rows) with ordinality as x(item, ordinality)
    order by x.ordinality
  loop
    v_team_id := null;
    select t.id into v_team_id
    from public.teams t
    where t.event_id = p_event_id
      and (
        t.metadata ->> 'representative_key' = v_row.district_key || ':' || v_row.school_key
        or t.metadata ->> 'district_key' = v_row.district_key
        or t.metadata ->> 'district' = v_row.district_name
        or t.name = v_row.school_name
        or t.name = v_row.district_name || '代表'
      )
    order by case
      when t.metadata ->> 'representative_key' = v_row.district_key || ':' || v_row.school_key then 1
      when t.metadata ->> 'district_key' = v_row.district_key then 2
      when t.metadata ->> 'district' = v_row.district_name then 3
      when t.name = v_row.school_name then 4
      else 5
    end
    limit 1
    for update;

    if v_team_id is null then
      insert into public.teams (
        event_id, name, team_id, school_name, prefecture, region,
        seed, start_round, odds, metadata
      ) values (
        p_event_id, v_row.school_name,
        'jhbf-' || coalesce(p_source_year::text, 'unknown') || '-' || lpad(v_row.seed::text, 2, '0'),
        v_row.school_name, v_row.district_name, v_row.district_name,
        v_row.seed, case when v_row.seed <= 15 then 2 else 1 end, 1,
        jsonb_build_object(
          'source', 'jhbf',
          'source_year', p_source_year,
          'district', v_row.district_name,
          'district_key', v_row.district_key,
          'representative_key', v_row.district_key || ':' || v_row.school_key
        )
      )
      returning id into v_team_id;
    else
      update public.teams t
      set name = v_row.school_name,
          school_name = v_row.school_name,
          prefecture = v_row.district_name,
          region = v_row.district_name,
          seed = v_row.seed,
          metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
            'source', 'jhbf',
            'source_year', p_source_year,
            'district', v_row.district_name,
            'district_key', v_row.district_key,
            'representative_key', v_row.district_key || ':' || v_row.school_key
          ),
          updated_at = now()
      where t.id = v_team_id;
    end if;
    v_kept_team_ids := array_append(v_kept_team_ids, v_team_id);
  end loop;

  if exists (
    select 1
    from public.teams stale
    where stale.event_id = p_event_id
      and not (stale.id = any(v_kept_team_ids))
      and (
        exists (select 1 from public.phase1_picks p where p.team_id = stale.id)
        or exists (select 1 from public.phase2_draft_picks p where p.team_id = stale.id)
        or exists (select 1 from public.phase2_drafts d where stale.id = any(d.eligible_team_ids))
        or exists (select 1 from public.matches m where stale.id in (m.team1_id, m.team2_id, m.winner_team_id, m.loser_team_id))
        or exists (select 1 from public.final_score_predictions f where stale.id in (f.champion_team_id, f.runner_up_team_id))
        or exists (select 1 from public.koshien_later_rounds r where stale.id in (r.team_a_id, r.team_b_id))
        or exists (select 1 from public.koshien_revenge_eligibility e where stale.id = any(e.allowed_team_ids))
        or exists (select 1 from public.koshien_zombie_eligibility e where stale.id = any(e.allowed_team_ids))
        or exists (select 1 from public.phase3_predictions p where stale.id in (p.team_a_id, p.team_b_id))
        or exists (select 1 from public.external_team_aliases a where a.team_id = stale.id)
        or exists (select 1 from public.revenge_picks r where r.target_team_id = stale.id)
        or exists (select 1 from public.zombie_picks z where z.target_team_id = stale.id)
        or exists (select 1 from public.zombie_predictions z where z.team_id = stale.id)
      )
  ) then
    raise exception 'representative_replace_would_remove_referenced_team' using errcode = '23503';
  end if;

  delete from public.teams t
  where t.event_id = p_event_id
    and not (t.id = any(v_kept_team_ids));

  select count(*) into v_team_count
  from public.teams t
  where t.event_id = p_event_id;
  if v_team_count <> 49 then
    raise exception 'representative_persisted_count_invalid: expected 49, got %', v_team_count
      using errcode = 'P0001';
  end if;

  delete from public.event_teams et
  where et.event_id = p_event_id;

  insert into public.event_teams (event_id, name, seed, metadata)
  select
    p_event_id,
    btrim(x.item ->> 'school_name'),
    x.ordinality::integer,
    jsonb_build_object(
      'source', 'jhbf',
      'source_year', p_source_year,
      'district', btrim(x.item ->> 'district_name'),
      'district_key', lower(regexp_replace(btrim(x.item ->> 'district_name'), '[[:space:]　]+', '', 'g')),
      'representative_key',
        lower(regexp_replace(btrim(x.item ->> 'district_name'), '[[:space:]　]+', '', 'g'))
        || ':' ||
        lower(regexp_replace(btrim(x.item ->> 'school_name'), '[[:space:]　]+', '', 'g'))
    )
  from jsonb_array_elements(p_rows) with ordinality as x(item, ordinality);

  select
    jsonb_agg(t.name order by t.seed),
    jsonb_object_agg(
      t.name,
      jsonb_build_object(
        'startRound', t.start_round,
        'odds', coalesce(t.odds, 1),
        'sqrtOdds', sqrt(coalesce(t.odds, 1)),
        'district', t.metadata ->> 'district',
        'source', 'jhbf',
        'sourceYear', p_source_year
      )
    )
  into v_teams_json, v_team_meta_json
  from public.teams t
  where t.event_id = p_event_id;

  update public.events e
  set rules = coalesce(e.rules, '{}'::jsonb) || jsonb_build_object(
        'config',
        coalesce(e.rules -> 'config', '{}'::jsonb) || jsonb_build_object(
          'teams', v_teams_json,
          'teamMeta', v_team_meta_json,
          'externalResults', jsonb_build_object('competitionType', 'summer', 'year', p_source_year)
        )
      ),
      updated_at = now()
  where e.id = p_event_id;

  return jsonb_build_object(
    'ok', true,
    'eventId', p_event_id,
    'count', v_team_count,
    'teams', v_teams_json
  );
end;
$$;

create or replace function public.save_koshien_phase1_prediction(
  p_event_id text,
  p_team_ids uuid[],
  p_captain_team_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_player_id uuid;
  v_selected_count integer;
  v_second_round_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
  for update;
  if v_event.id is null or v_event.preset_type <> 'koshien' then
    raise exception 'koshien event was not found' using errcode = 'P0002';
  end if;
  if v_event.status <> 'open'
     or (v_event.prediction_deadline is not null and clock_timestamp() >= v_event.prediction_deadline) then
    raise exception 'phase1 prediction is not open' using errcode = '42501';
  end if;
  if coalesce(cardinality(p_team_ids), 0) <> 8 then
    raise exception 'exactly 8 teams are required' using errcode = '22023';
  end if;
  if (select count(distinct x.team_id) from unnest(p_team_ids) x(team_id)) <> 8 then
    raise exception 'duplicate phase1 team is not allowed' using errcode = '23505';
  end if;
  if p_captain_team_id is null or not (p_captain_team_id = any(p_team_ids)) then
    raise exception 'captain must be one of the selected teams' using errcode = '22023';
  end if;

  select count(*), count(*) filter (where t.start_round = 2)
  into v_selected_count, v_second_round_count
  from public.teams t
  where t.event_id = p_event_id
    and t.id = any(p_team_ids);
  if v_selected_count <> 8 then
    raise exception 'selected team does not belong to event' using errcode = '22023';
  end if;
  if v_second_round_count > 3 then
    raise exception 'second round teams are limited to 3' using errcode = '22023';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.league_id = v_event.league_id
    and p.profile_id = auth.uid();
  if v_player_id is null then
    raise exception 'player was not found in event league' using errcode = '42501';
  end if;

  insert into public.predictions (event_id, user_id, payload, submitted_at, updated_at)
  values (p_event_id, auth.uid(), coalesce(p_payload, '{}'::jsonb), now(), now())
  on conflict (event_id, user_id) do update
  set payload = excluded.payload,
      submitted_at = excluded.submitted_at,
      updated_at = excluded.updated_at;

  delete from public.phase1_picks p
  where p.event_id = p_event_id
    and p.player_id = v_player_id;

  insert into public.phase1_picks (
    event_id, player_id, team_id, pick_order, captain,
    odds_snapshot, sqrt_odds_snapshot
  )
  select
    p_event_id,
    v_player_id,
    selected.team_id,
    selected.pick_order::integer,
    selected.team_id = p_captain_team_id,
    t.odds,
    t.sqrt_odds
  from unnest(p_team_ids) with ordinality selected(team_id, pick_order)
  join public.teams t
    on t.id = selected.team_id
   and t.event_id = p_event_id;

  return jsonb_build_object(
    'ok', true,
    'eventId', p_event_id,
    'playerId', v_player_id,
    'pickCount', 8,
    'captainTeamId', p_captain_team_id
  );
end;
$$;

revoke all on function public.replace_koshien_representatives(text, jsonb, integer) from public, anon;
revoke all on function public.save_koshien_phase1_prediction(text, uuid[], uuid, jsonb) from public, anon;
grant execute on function public.replace_koshien_representatives(text, jsonb, integer) to authenticated;
grant execute on function public.save_koshien_phase1_prediction(text, uuid[], uuid, jsonb) to authenticated;
