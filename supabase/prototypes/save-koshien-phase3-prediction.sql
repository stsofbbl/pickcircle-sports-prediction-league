-- PROTOTYPE ONLY, production catalog 2026-11-19. Event-first participant save.
CREATE OR REPLACE FUNCTION public.save_koshien_phase3_prediction(p_event_id text, p_score_a integer, p_score_b integer, p_tiebreak_score_a integer, p_tiebreak_score_b integer, p_expected_version bigint, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Prediction writes may return get_state -> refresh. Lock the event first
  -- (for an existing event player) to prevent child-row -> event inversion.
  -- No approval revision or results write permit: predictions are not results.
  if auth.uid() is not null then
    perform e.id from public.events e
    join public.players p on p.league_id=e.league_id and p.profile_id=auth.uid()
    where e.id=p_event_id
    for update of e;
  end if;
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
$function$;

REVOKE ALL ON FUNCTION public.save_koshien_phase3_prediction(text,integer,integer,integer,integer,bigint,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_koshien_phase3_prediction(text,integer,integer,integer,integer,bigint,uuid) TO authenticated,service_role;
