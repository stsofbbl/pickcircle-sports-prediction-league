begin;

alter table public.final_score_predictions
  add column if not exists predicted_tiebreak_score_a integer,
  add column if not exists predicted_tiebreak_score_b integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'final_score_predictions_tiebreak_score_a_check'
  ) then
    alter table public.final_score_predictions
      add constraint final_score_predictions_tiebreak_score_a_check
      check (predicted_tiebreak_score_a is null or predicted_tiebreak_score_a >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'final_score_predictions_tiebreak_score_b_check'
  ) then
    alter table public.final_score_predictions
      add constraint final_score_predictions_tiebreak_score_b_check
      check (predicted_tiebreak_score_b is null or predicted_tiebreak_score_b >= 0);
  end if;
end $$;

drop function if exists public.save_koshien_phase3_prediction(text, integer, integer, bigint, uuid);

create or replace function public.save_koshien_phase3_prediction(
  p_event_id text,
  p_score_a integer,
  p_score_b integer,
  p_tiebreak_score_a integer,
  p_tiebreak_score_b integer,
  p_expected_version bigint,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.koshien_later_rounds;
  v_player_id uuid;
  v_existing public.final_score_predictions;
  v_request_payload jsonb := jsonb_build_object(
    'score_a', p_score_a,
    'score_b', p_score_b,
    'tiebreak_score_a', p_tiebreak_score_a,
    'tiebreak_score_b', p_tiebreak_score_b
  );
  v_previous_payload jsonb;
begin
  select r.* into v_round
  from public.koshien_later_rounds r
  where r.event_id = p_event_id and r.phase_key = 'phase3'
  for update;

  if auth.uid() is null or v_round.id is null then
    raise exception 'phase 3 round is unavailable' using errcode = '42501';
  end if;

  select p.id into v_player_id
  from public.players p
  join public.events e on e.league_id = p.league_id
  where e.id = p_event_id and p.profile_id = auth.uid();

  if v_player_id is null then
    raise exception 'event player is required' using errcode = '42501';
  end if;

  select h.payload into v_previous_payload
  from public.koshien_later_prediction_requests h
  where h.event_id = p_event_id
    and h.player_id = v_player_id
    and h.phase_key = 'phase3'
    and h.request_id = p_request_id;

  if v_previous_payload is not null then
    if v_previous_payload is distinct from v_request_payload then
      raise exception 'request_id payload conflict' using errcode = '23505';
    end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;

  select x.* into v_existing
  from public.final_score_predictions x
  where x.event_id = p_event_id and x.player_id = v_player_id;

  if v_existing.request_id = p_request_id then
    if v_existing.predicted_score_a is distinct from p_score_a
      or v_existing.predicted_score_b is distinct from p_score_b
      or v_existing.predicted_tiebreak_score_a is distinct from p_tiebreak_score_a
      or v_existing.predicted_tiebreak_score_b is distinct from p_tiebreak_score_b then
      raise exception 'request_id payload conflict' using errcode = '23505';
    end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;

  if v_round.status <> 'open'
    or clock_timestamp() < v_round.opens_at
    or (v_round.end_mode = 'automatic' and clock_timestamp() >= v_round.deadline_at) then
    raise exception 'phase 3 round is closed' using errcode = '55000';
  end if;
  if v_round.version <> p_expected_version then
    raise exception 'phase 3 version conflict' using errcode = '40001';
  end if;
  if p_score_a is null or p_score_b is null
    or p_tiebreak_score_a is null or p_tiebreak_score_b is null
    or p_score_a < 0 or p_score_b < 0
    or p_tiebreak_score_a < 0 or p_tiebreak_score_b < 0
    or p_score_a = p_score_b
    or p_tiebreak_score_a = p_tiebreak_score_b then
    raise exception 'valid non-tied normal and tiebreak scores are required';
  end if;

  insert into public.koshien_later_prediction_requests(
    event_id, player_id, phase_key, request_id, payload
  ) values (
    p_event_id, v_player_id, 'phase3', p_request_id, v_request_payload
  );

  insert into public.final_score_predictions(
    event_id, player_id, champion_team_id, runner_up_team_id,
    predicted_score_a, predicted_score_b,
    predicted_tiebreak_score_a, predicted_tiebreak_score_b,
    request_id
  ) values (
    p_event_id, v_player_id, v_round.team_a_id, v_round.team_b_id,
    p_score_a, p_score_b, p_tiebreak_score_a, p_tiebreak_score_b, p_request_id
  )
  on conflict(event_id, player_id) do update set
    champion_team_id = excluded.champion_team_id,
    runner_up_team_id = excluded.runner_up_team_id,
    predicted_score_a = excluded.predicted_score_a,
    predicted_score_b = excluded.predicted_score_b,
    predicted_tiebreak_score_a = excluded.predicted_tiebreak_score_a,
    predicted_tiebreak_score_b = excluded.predicted_tiebreak_score_b,
    request_id = excluded.request_id,
    updated_at = now();

  return public.get_koshien_later_phase_state(p_event_id);
end;
$$;

create or replace function public.koshien_phase3_points(p_event_id text, p_player_id uuid)
returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_score_a integer;
  v_score_b integer;
  v_used_tiebreak boolean := false;
  v_player_metric integer[];
  v_best_metric integer[];
begin
  select
    m.team1_score,
    m.team2_score,
    coalesce(
      case when jsonb_typeof(m.metadata->'used_tiebreak') = 'boolean'
        then (m.metadata->>'used_tiebreak')::boolean end,
      false
    )
  into v_score_a, v_score_b, v_used_tiebreak
  from public.matches m
  where m.event_id = p_event_id and m.round_key = 'F' and m.status = 'completed'
  order by m.match_no
  limit 1;

  if v_score_a is null or v_score_b is null then return 0; end if;

  if exists (
    select 1
    from public.final_score_predictions fsp
    where fsp.event_id = p_event_id
      and case when v_used_tiebreak then fsp.predicted_tiebreak_score_a else fsp.predicted_score_a end = v_score_a
      and case when v_used_tiebreak then fsp.predicted_tiebreak_score_b else fsp.predicted_score_b end = v_score_b
  ) then
    return case when exists (
      select 1
      from public.final_score_predictions fsp
      where fsp.event_id = p_event_id
        and fsp.player_id = p_player_id
        and case when v_used_tiebreak then fsp.predicted_tiebreak_score_a else fsp.predicted_score_a end = v_score_a
        and case when v_used_tiebreak then fsp.predicted_tiebreak_score_b else fsp.predicted_score_b end = v_score_b
    ) then 50 else 0 end;
  end if;

  select array[
    abs(x.score_a - v_score_a) + abs(x.score_b - v_score_b),
    case when sign(x.score_a - x.score_b) = sign(v_score_a - v_score_b) then 0 else 1 end,
    abs((x.score_a - x.score_b) - (v_score_a - v_score_b)),
    abs((x.score_a + x.score_b) - (v_score_a + v_score_b))
  ] into v_player_metric
  from (
    select
      fsp.player_id,
      case when v_used_tiebreak then fsp.predicted_tiebreak_score_a else fsp.predicted_score_a end as score_a,
      case when v_used_tiebreak then fsp.predicted_tiebreak_score_b else fsp.predicted_score_b end as score_b
    from public.final_score_predictions fsp
    where fsp.event_id = p_event_id and fsp.player_id = p_player_id
  ) x
  where x.score_a is not null and x.score_b is not null;

  select array[
    abs(x.score_a - v_score_a) + abs(x.score_b - v_score_b),
    case when sign(x.score_a - x.score_b) = sign(v_score_a - v_score_b) then 0 else 1 end,
    abs((x.score_a - x.score_b) - (v_score_a - v_score_b)),
    abs((x.score_a + x.score_b) - (v_score_a + v_score_b))
  ] into v_best_metric
  from (
    select
      case when v_used_tiebreak then fsp.predicted_tiebreak_score_a else fsp.predicted_score_a end as score_a,
      case when v_used_tiebreak then fsp.predicted_tiebreak_score_b else fsp.predicted_score_b end as score_b
    from public.final_score_predictions fsp
    where fsp.event_id = p_event_id
  ) x
  where x.score_a is not null and x.score_b is not null
  order by 1
  limit 1;

  return case when v_player_metric = v_best_metric then 30 else 0 end;
end;
$$;

create or replace function public.get_koshien_later_phase_state(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_league_id uuid;
  v_player_id uuid;
begin
  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id;

  if auth.uid() is null or v_league_id is null or not public.is_league_member(v_league_id) then
    raise exception 'league membership is required' using errcode = '42501';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.league_id = v_league_id and p.profile_id = auth.uid();

  return jsonb_build_object(
    'event_id', p_event_id,
    'viewer_player_id', v_player_id,
    'is_admin', public.is_league_admin(v_league_id),
    'rounds', coalesce((
      select jsonb_object_agg(r.phase_key, to_jsonb(r))
      from public.koshien_later_rounds r
      where r.event_id = p_event_id
    ), '{}'::jsonb),
    'revenge', jsonb_build_object(
      'eligibility', (
        select to_jsonb(x) from public.koshien_revenge_eligibility x
        where x.event_id = p_event_id and x.player_id = v_player_id
      ),
      'pick', (
        select to_jsonb(x) from public.revenge_picks x
        where x.event_id = p_event_id and x.player_id = v_player_id
      )
    ),
    'zombie', jsonb_build_object(
      'eligibility', (
        select to_jsonb(x) from public.koshien_zombie_eligibility x
        where x.event_id = p_event_id and x.player_id = v_player_id
      ),
      'prediction', (
        select to_jsonb(x) from public.zombie_predictions x
        where x.event_id = p_event_id and x.player_id = v_player_id
      ),
      'public_predictions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_id', zp.player_id,
          'profile_id', p.profile_id,
          'display_name', p.display_name,
          'team_id', zp.team_id,
          'team_name', t.name,
          'created_at', zp.created_at,
          'updated_at', zp.updated_at
        ) order by zp.created_at, p.id)
        from public.zombie_predictions zp
        join public.players p on p.id = zp.player_id
        join public.teams t on t.id = zp.team_id and t.event_id = zp.event_id
        where zp.event_id = p_event_id
      ), '[]'::jsonb)
    ),
    'phase3', jsonb_build_object(
      'prediction', (
        select to_jsonb(x) from public.final_score_predictions x
        where x.event_id = p_event_id and x.player_id = v_player_id
      ),
      'predictions', case when exists (
        select 1 from public.koshien_later_rounds r
        where r.event_id = p_event_id
          and r.phase_key = 'phase3'
          and r.status in ('locked', 'completed')
      ) then coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_id', fsp.player_id,
          'profile_id', p.profile_id,
          'display_name', p.display_name,
          'predicted_score_a', fsp.predicted_score_a,
          'predicted_score_b', fsp.predicted_score_b,
          'predicted_tiebreak_score_a', fsp.predicted_tiebreak_score_a,
          'predicted_tiebreak_score_b', fsp.predicted_tiebreak_score_b
        ) order by p.id)
        from public.final_score_predictions fsp
        join public.players p on p.id = fsp.player_id
        where fsp.event_id = p_event_id
      ), '[]'::jsonb) else '[]'::jsonb end
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
      from public.scores s
      join public.players p on p.id = s.player_id
      where s.event_id = p_event_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'team_id', t.id,
        'name', t.name,
        'sqrt_odds', least(t.sqrt_odds, 50)
      ))
      from public.teams t
      where t.event_id = p_event_id
    ), '[]'::jsonb)
  );
end;
$function$;

revoke all on function public.save_koshien_phase3_prediction(text,integer,integer,integer,integer,bigint,uuid) from anon, public;
grant execute on function public.save_koshien_phase3_prediction(text,integer,integer,integer,integer,bigint,uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
