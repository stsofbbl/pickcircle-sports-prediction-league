-- PROTOTYPE ONLY, production catalog 2026-11-19. Event-first participant save.
CREATE OR REPLACE FUNCTION public.save_koshien_revenge_pick(p_event_id text, p_target_team_id uuid, p_expected_version bigint, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_round public.koshien_later_rounds;
  v_player_id uuid;
  v_allowed uuid[];
  v_existing public.revenge_picks;
  v_request_payload jsonb := jsonb_build_object('target_team_id', p_target_team_id);
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
  select r.* into v_round from public.koshien_later_rounds r where r.event_id=p_event_id and r.phase_key='revenge' for update;
  if auth.uid() is null or v_round.id is null then raise exception 'revenge round is unavailable' using errcode='42501'; end if;
  select p.id into v_player_id from public.players p join public.events e on e.league_id=p.league_id where e.id=p_event_id and p.profile_id=auth.uid();
  if v_player_id is null then raise exception 'event player is required' using errcode='42501'; end if;
  select h.payload into v_previous_payload from public.koshien_later_prediction_requests h
  where h.event_id=p_event_id and h.player_id=v_player_id and h.phase_key='revenge' and h.request_id=p_request_id;
  if v_previous_payload is not null then
    if v_previous_payload is distinct from v_request_payload then raise exception 'request_id payload conflict' using errcode='23505'; end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;
  select x.* into v_existing from public.revenge_picks x where x.event_id=p_event_id and x.player_id=v_player_id;
  if v_existing.request_id=p_request_id then
    if v_existing.target_team_id is distinct from p_target_team_id then raise exception 'request_id payload conflict' using errcode='23505'; end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;
  if v_round.status <> 'open' or clock_timestamp() < v_round.opens_at
    or (v_round.end_mode = 'automatic' and clock_timestamp() >= v_round.deadline_at)
    then raise exception 'revenge round is closed' using errcode='55000'; end if;
  if v_round.version <> p_expected_version then raise exception 'revenge version conflict' using errcode='40001'; end if;
  select x.allowed_team_ids into v_allowed from public.koshien_revenge_eligibility x where x.event_id=p_event_id and x.player_id=v_player_id and x.eligible;
  if v_allowed is null or not (p_target_team_id=any(v_allowed)) then raise exception 'revenge team is not allowed' using errcode='42501'; end if;
  insert into public.koshien_later_prediction_requests(event_id,player_id,phase_key,request_id,payload)
  values(p_event_id,v_player_id,'revenge',p_request_id,v_request_payload);
  insert into public.revenge_picks(event_id,player_id,target_team_id,request_id,payload)
  values(p_event_id,v_player_id,p_target_team_id,p_request_id,jsonb_build_object('round_version',v_round.version))
  on conflict(event_id,player_id) do update set target_team_id=excluded.target_team_id,request_id=excluded.request_id,payload=excluded.payload,updated_at=now();
  return public.get_koshien_later_phase_state(p_event_id);
end $function$;

REVOKE ALL ON FUNCTION public.save_koshien_revenge_pick(text,uuid,bigint,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_koshien_revenge_pick(text,uuid,bigint,uuid) TO authenticated,service_role;
