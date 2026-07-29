alter function public.replace_koshien_representatives(text, jsonb, integer)
  rename to replace_koshien_representatives_base;

revoke all on function public.replace_koshien_representatives_base(text, jsonb, integer)
  from public, anon, authenticated;

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
  v_result jsonb;
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
  if v_event.status not in ('draft', 'open')
     or (v_event.prediction_deadline is not null
       and clock_timestamp() >= v_event.prediction_deadline) then
    raise exception 'start rounds can no longer be changed' using errcode = '42501';
  end if;

  v_result := public.replace_koshien_representatives_base(
    p_event_id,
    p_rows,
    p_source_year
  );

  update public.event_teams et
  set metadata = coalesce(et.metadata, '{}'::jsonb)
    || jsonb_build_object('startRound', t.start_round)
  from public.teams t
  where et.event_id = p_event_id
    and t.event_id = et.event_id
    and t.name = et.name;

  update public.events e
  set rules = jsonb_set(
        coalesce(e.rules, '{}'::jsonb),
        '{config}',
        (
          coalesce(e.rules -> 'config', '{}'::jsonb)
          || jsonb_build_object('startRoundsConfirmed', false)
        ) - 'startRoundsConfirmedAt',
        true
      ),
      updated_at = now()
  where e.id = p_event_id;

  return v_result || jsonb_build_object('startRoundsConfirmed', false);
end;
$$;

revoke all on function public.replace_koshien_representatives(text, jsonb, integer)
  from public, anon;
grant execute on function public.replace_koshien_representatives(text, jsonb, integer)
  to authenticated;

create or replace function public.confirm_koshien_start_rounds(
  p_event_id text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_team_count integer;
  v_first_round_count integer;
  v_second_round_count integer;
  v_invalid_prediction_count integer;
  v_team_meta jsonb;
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
  if v_event.status not in ('draft', 'open')
     or (v_event.prediction_deadline is not null
       and clock_timestamp() >= v_event.prediction_deadline) then
    raise exception 'start rounds can no longer be changed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) <> 49 then
    raise exception 'start_round_count_invalid: expected 49, got %',
      case when jsonb_typeof(p_rows) = 'array' then jsonb_array_length(p_rows) else 0 end
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(representative_key text, start_round integer)
    where nullif(btrim(x.representative_key), '') is null
       or x.start_round not in (1, 2)
  ) then
    raise exception 'start_round_row_invalid' using errcode = '22023';
  end if;

  if (
    select count(distinct btrim(x.representative_key))
    from jsonb_to_recordset(p_rows) as x(representative_key text, start_round integer)
  ) <> 49 then
    raise exception 'start_round_representative_duplicate' using errcode = '23505';
  end if;

  select
    count(*) filter (where start_round = 1),
    count(*) filter (where start_round = 2)
  into v_first_round_count, v_second_round_count
  from jsonb_to_recordset(p_rows) as x(representative_key text, start_round integer);

  if v_first_round_count <> 34 or v_second_round_count <> 15 then
    raise exception 'start_round_distribution_invalid: round1=%, round2=%',
      v_first_round_count, v_second_round_count
      using errcode = '22023';
  end if;

  select count(*) into v_team_count
  from public.teams t
  where t.event_id = p_event_id
    and nullif(t.metadata ->> 'representative_key', '') is not null;

  if v_team_count <> 49
     or exists (
       select 1
       from jsonb_to_recordset(p_rows) as x(representative_key text, start_round integer)
       where not exists (
         select 1
         from public.teams t
         where t.event_id = p_event_id
           and t.metadata ->> 'representative_key' = btrim(x.representative_key)
       )
     )
     or exists (
       select 1
       from public.teams t
       where t.event_id = p_event_id
         and nullif(t.metadata ->> 'representative_key', '') is not null
         and not exists (
           select 1
           from jsonb_to_recordset(p_rows) as x(representative_key text, start_round integer)
           where btrim(x.representative_key) = t.metadata ->> 'representative_key'
         )
     ) then
    raise exception 'start_round_representatives_do_not_match_event' using errcode = '22023';
  end if;

  update public.teams t
  set start_round = x.start_round,
      updated_at = now()
  from jsonb_to_recordset(p_rows) as x(representative_key text, start_round integer)
  where t.event_id = p_event_id
    and t.metadata ->> 'representative_key' = btrim(x.representative_key);

  update public.event_teams et
  set metadata = coalesce(et.metadata, '{}'::jsonb)
    || jsonb_build_object('startRound', x.start_round)
  from jsonb_to_recordset(p_rows) as x(representative_key text, start_round integer)
  where et.event_id = p_event_id
    and et.metadata ->> 'representative_key' = btrim(x.representative_key);

  select count(*) into v_invalid_prediction_count
  from (
    select p.player_id
    from public.phase1_picks p
    join public.teams t
      on t.event_id = p.event_id
     and t.id = p.team_id
    where p.event_id = p_event_id
    group by p.player_id
    having count(*) filter (where t.start_round = 2) > 3
  ) invalid_predictions;

  select jsonb_object_agg(
    t.name,
    coalesce(
      v_event.rules #> array['config', 'teamMeta', t.name],
      '{}'::jsonb
    ) || jsonb_build_object(
      'startRound', t.start_round,
      'representativeKey', t.metadata ->> 'representative_key'
    )
    order by t.seed
  )
  into v_team_meta
  from public.teams t
  where t.event_id = p_event_id;

  update public.events e
  set rules = jsonb_set(
        coalesce(e.rules, '{}'::jsonb),
        '{config}',
        coalesce(e.rules -> 'config', '{}'::jsonb)
          || jsonb_build_object(
            'teamMeta', v_team_meta,
            'startRoundsConfirmed', true,
            'startRoundsConfirmedAt', clock_timestamp()
          ),
        true
      ),
      updated_at = now()
  where e.id = p_event_id;

  return jsonb_build_object(
    'ok', true,
    'eventId', p_event_id,
    'count', v_team_count,
    'firstRoundCount', v_first_round_count,
    'secondRoundCount', v_second_round_count,
    'invalidPredictionCount', v_invalid_prediction_count,
    'startRoundsConfirmed', true
  );
end;
$$;

revoke all on function public.confirm_koshien_start_rounds(text, jsonb)
  from public, anon;
grant execute on function public.confirm_koshien_start_rounds(text, jsonb)
  to authenticated;

create or replace function public.update_koshien_odds(
  p_event_id text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_team_count integer;
  v_update_count integer;
  v_team_meta jsonb;
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
  if v_event.status not in ('draft', 'open')
     or (v_event.prediction_deadline is not null
       and clock_timestamp() >= v_event.prediction_deadline) then
    raise exception 'odds can no longer be changed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) not between 1 and 49 then
    raise exception 'odds_count_invalid: expected 1-49, got %',
      case when jsonb_typeof(p_rows) = 'array' then jsonb_array_length(p_rows) else 0 end
      using errcode = '22023';
  end if;
  v_update_count := jsonb_array_length(p_rows);
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(representative_key text, odds numeric)
    where nullif(btrim(x.representative_key), '') is null
       or x.odds is null
       or x.odds <= 0
  ) then
    raise exception 'odds_row_invalid' using errcode = '22023';
  end if;
  if (
    select count(distinct btrim(x.representative_key))
    from jsonb_to_recordset(p_rows) as x(representative_key text, odds numeric)
  ) <> v_update_count then
    raise exception 'odds_representative_duplicate' using errcode = '23505';
  end if;

  select count(*) into v_team_count
  from public.teams t
  where t.event_id = p_event_id
    and nullif(t.metadata ->> 'representative_key', '') is not null;

  if v_team_count <> 49
     or exists (
       select 1
       from jsonb_to_recordset(p_rows) as x(representative_key text, odds numeric)
       where not exists (
         select 1
         from public.teams t
         where t.event_id = p_event_id
           and t.metadata ->> 'representative_key' = btrim(x.representative_key)
       )
     ) then
    raise exception 'odds_representatives_do_not_match_event' using errcode = '22023';
  end if;

  update public.teams t
  set odds = x.odds,
      updated_at = now()
  from jsonb_to_recordset(p_rows) as x(representative_key text, odds numeric)
  where t.event_id = p_event_id
    and t.metadata ->> 'representative_key' = btrim(x.representative_key);

  update public.event_teams et
  set metadata = coalesce(et.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'odds', t.odds,
      'sqrtOdds', t.sqrt_odds
    )
  from public.teams t
  where et.event_id = p_event_id
    and t.event_id = et.event_id
    and et.metadata ->> 'representative_key' = t.metadata ->> 'representative_key';

  select jsonb_object_agg(
    t.name,
    coalesce(
      v_event.rules #> array['config', 'teamMeta', t.name],
      '{}'::jsonb
    ) || jsonb_build_object(
      'startRound', t.start_round,
      'odds', t.odds,
      'sqrtOdds', t.sqrt_odds,
      'representativeKey', t.metadata ->> 'representative_key'
    )
    order by t.seed
  )
  into v_team_meta
  from public.teams t
  where t.event_id = p_event_id;

  update public.events e
  set rules = jsonb_set(
        coalesce(e.rules, '{}'::jsonb),
        '{config}',
        coalesce(e.rules -> 'config', '{}'::jsonb)
          || jsonb_build_object('teamMeta', v_team_meta),
        true
      ),
      updated_at = now()
  where e.id = p_event_id;

  return jsonb_build_object(
    'ok', true,
    'eventId', p_event_id,
    'count', v_team_count,
    'updatedCount', v_update_count
  );
end;
$$;

revoke all on function public.update_koshien_odds(text, jsonb)
  from public, anon;
grant execute on function public.update_koshien_odds(text, jsonb)
  to authenticated;

update public.event_teams et
set metadata = coalesce(et.metadata, '{}'::jsonb)
  || jsonb_build_object('startRound', t.start_round)
from public.teams t
join public.events e on e.id = t.event_id
where et.event_id = t.event_id
  and et.name = t.name
  and e.preset_type = 'koshien'
  and e.status in ('draft', 'open')
  and (e.prediction_deadline is null or clock_timestamp() < e.prediction_deadline)
  and (
    select count(*)
    from public.teams current_teams
    where current_teams.event_id = e.id
  ) = 49;

update public.events e
set rules = jsonb_set(
      coalesce(e.rules, '{}'::jsonb),
      '{config}',
      (
        coalesce(e.rules -> 'config', '{}'::jsonb)
        || jsonb_build_object('startRoundsConfirmed', false)
      ) - 'startRoundsConfirmedAt',
      true
    ),
    updated_at = now()
where e.preset_type = 'koshien'
  and e.status in ('draft', 'open')
  and (e.prediction_deadline is null or clock_timestamp() < e.prediction_deadline)
  and (
    select count(*)
    from public.teams t
    where t.event_id = e.id
  ) = 49;
