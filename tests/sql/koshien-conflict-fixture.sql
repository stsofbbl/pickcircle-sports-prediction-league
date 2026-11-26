-- Captured production RPC bodies (read-only catalog 2026-11-26).
-- Minimal synthetic relations; only the real conflict branches are exercised.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$f$;
CREATE TABLE public.events(id text PRIMARY KEY,league_id uuid,preset_type text,status text,rules jsonb);
CREATE TABLE public.matches(event_id text,round_key text,match_no integer);
CREATE TABLE public.players(id uuid PRIMARY KEY,league_id uuid,profile_id uuid);
CREATE TABLE public.phase2_drafts(id uuid PRIMARY KEY,event_id text,ordered_player_ids uuid[],status text,starts_at timestamptz,deadline_at timestamptz,current_pick_no integer);
CREATE TABLE public.phase2_draft_picks(id uuid,draft_id uuid,player_id uuid,request_id uuid,team_id uuid,pick_no integer);
CREATE TABLE public.koshien_later_rounds(id uuid PRIMARY KEY,event_id text,phase_key text,status text,opens_at timestamptz,end_mode text,deadline_at timestamptz,version bigint);
CREATE TABLE public.koshien_later_prediction_requests(event_id text,player_id uuid,phase_key text,request_id uuid,payload jsonb);
CREATE TABLE public.final_score_predictions(event_id text,player_id uuid,request_id uuid,predicted_score_a integer,predicted_score_b integer,predicted_tiebreak_score_a integer,predicted_tiebreak_score_b integer);
CREATE TABLE public.revenge_picks(event_id text,player_id uuid,request_id uuid,target_team_id uuid);
CREATE TABLE public.zombie_predictions(event_id text,player_id uuid,request_id uuid,team_id uuid);
CREATE FUNCTION public.is_league_admin(uuid) RETURNS boolean LANGUAGE sql STABLE AS $f$ SELECT auth.uid()='00000000-0000-0000-0000-000000000001'::uuid $f$;
CREATE FUNCTION public.koshien_admin_result_revision(text) RETURNS text LANGUAGE sql STABLE AS $f$ SELECT repeat('a',32) $f$;
INSERT INTO public.events VALUES('conflict-event','00000000-0000-0000-0000-000000000010','koshien','resultWait','{"approvalPolicy":"admin"}');
INSERT INTO public.players VALUES('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');
INSERT INTO public.phase2_drafts VALUES('00000000-0000-0000-0000-000000000021','conflict-event',ARRAY['00000000-0000-0000-0000-000000000011'::uuid],'drafting',now()-interval '1 day',now()+interval '1 day',2);
INSERT INTO public.koshien_later_rounds SELECT ('00000000-0000-0000-0000-00000000003'||n)::uuid,'conflict-event',phase,'open',now()-interval '1 day','automatic',now()+interval '1 day',2 FROM (VALUES(1,'phase3'),(2,'revenge'),(3,'zombie')) v(n,phase);
-- Full source is retained verbatim. SQL branches beyond the conflict
-- rely on relations omitted by design; this fixture is not a schema clone.
SET LOCAL check_function_bodies=off;
CREATE OR REPLACE FUNCTION public.finalize_koshien_admin_results(p_event_id text, p_expected_revision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_event public.events;
  v_revision text;
  v_total integer;
  v_valid integer;
  v_rounds jsonb;
  v_now text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.id IS NULL OR NOT public.is_league_admin(v_event.league_id) THEN
    RAISE EXCEPTION 'club admin permission required' USING ERRCODE = '42501';
  END IF;
  IF v_event.preset_type <> 'koshien' OR v_event.status <> 'resultWait'
    OR v_event.rules->>'approvalPolicy' IS DISTINCT FROM 'admin'
    OR coalesce(v_event.rules->'resultFlow'->>'status', 'none') NOT IN ('none','submitted') THEN
    RAISE EXCEPTION 'event is not awaiting admin-only result approval'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'expected result revision required' USING ERRCODE = '22023';
  END IF;

  -- Read-lock the 48 source rows while checking the version and stored scores.
  PERFORM 1 FROM public.matches m WHERE m.event_id = p_event_id
    ORDER BY m.round_key, m.match_no FOR SHARE;
  v_revision := public.koshien_admin_result_revision(p_event_id);
  IF v_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'reviewed scoreboard changed; refresh before finalizing'
      USING ERRCODE = '40001';
  END IF;
  IF (SELECT count(*) FROM public.teams WHERE event_id = p_event_id) <> 49 THEN
    RAISE EXCEPTION '49 representatives required' USING ERRCODE = '22023';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE status = 'completed'
    AND team1_id IS NOT NULL AND team2_id IS NOT NULL
    AND team1_id <> team2_id AND winner_team_id IS NOT NULL
    AND loser_team_id IS NOT NULL AND winner_team_id <> loser_team_id
    AND team1_score IS NOT NULL AND team2_score IS NOT NULL
    AND team1_score >= 0 AND team2_score >= 0 AND team1_score <> team2_score
    AND ((team1_score > team2_score AND winner_team_id = team1_id AND loser_team_id = team2_id)
      OR (team2_score > team1_score AND winner_team_id = team2_id AND loser_team_id = team1_id)))
  INTO v_total,v_valid FROM public.matches WHERE event_id = p_event_id;
  IF v_total <> 48 OR v_valid <> 48 THEN
    RAISE EXCEPTION 'all 48 valid matches must be completed' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_object_agg(round_key, n), '{}'::jsonb) INTO v_rounds
  FROM (SELECT round_key,count(*) n FROM public.matches
    WHERE event_id = p_event_id GROUP BY round_key) r;
  IF v_rounds <> '{"R1":17,"R2":16,"R3":8,"QF":4,"SF":2,"F":1}'::jsonb THEN
    RAISE EXCEPTION 'Koshien round counts are inconsistent' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.results r WHERE r.event_id = p_event_id
    AND jsonb_typeof(r.payload) = 'object') THEN
    RAISE EXCEPTION 'stored result snapshot required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.players p JOIN public.league_members lm
      ON lm.league_id = p.league_id AND lm.user_id = p.profile_id
    WHERE p.league_id = v_event.league_id AND lm.membership_status = 'active'
      AND NOT EXISTS (SELECT 1 FROM public.scores s
        WHERE s.event_id = p_event_id AND s.player_id = p.id)
  ) THEN
    RAISE EXCEPTION 'scores missing for an active participant' USING ERRCODE = '22023';
  END IF;

  INSERT INTO yoso_admin_finalize_private.permits(event_id,txid,actor)
  VALUES(p_event_id,txid_current(),auth.uid());
  UPDATE public.events SET status = 'finalized',
    rules = jsonb_set(coalesce(rules,'{}'::jsonb), '{resultFlow}',
      jsonb_build_object('status','finalized','submittedBy',auth.uid()::text,
        'submittedAt',v_now,'approvals',jsonb_build_object(auth.uid()::text,v_now),
        'finalizedAt',v_now),true)
  WHERE id = p_event_id;
  DELETE FROM yoso_admin_finalize_private.permits WHERE event_id = p_event_id;
  RETURN jsonb_build_object('event_status','finalized','reviewed_revision',v_revision);
END
$function$;

CREATE OR REPLACE FUNCTION public.save_koshien_phase2_draft_pick(p_draft_id uuid, p_team_id uuid, p_expected_pick_no integer, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_draft public.phase2_drafts;
  v_existing public.phase2_draft_picks;
  v_league_id uuid;
  v_player_id uuid;
  v_expected_player_id uuid;
  v_round integer;
  v_slot integer;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request_id is required';
  end if;

  select d.* into v_draft
  from public.phase2_drafts d
  where d.id = p_draft_id
  for update;

  if v_draft.id is null then
    raise exception 'phase 2 draft is not found' using errcode = 'P0002';
  end if;

  select e.league_id into v_league_id
  from public.events e
  where e.id = v_draft.event_id;

  select p.id into v_player_id
  from public.players p
  where p.league_id = v_league_id
    and p.profile_id = auth.uid();

  if v_player_id is null or not (v_player_id = any (v_draft.ordered_player_ids)) then
    raise exception 'draft participant permission is required' using errcode = '42501';
  end if;

  select dp.* into v_existing
  from public.phase2_draft_picks dp
  where dp.draft_id = p_draft_id
    and dp.player_id = v_player_id
    and dp.request_id = p_request_id;

  if v_existing.id is not null then
    if v_existing.team_id <> p_team_id or v_existing.pick_no <> p_expected_pick_no then
      raise exception 'request_id was already used for a different pick' using errcode = '23505';
    end if;
    return public.get_koshien_phase2_draft_state(v_draft.event_id);
  end if;

  if v_draft.status <> 'drafting' then
    raise exception 'phase 2 draft is not active' using errcode = '55000';
  end if;
  if clock_timestamp() < v_draft.starts_at then
    raise exception 'phase 2 draft has not started' using errcode = '55000';
  end if;
  if clock_timestamp() >= v_draft.deadline_at then
    raise exception 'phase 2 draft deadline has passed' using errcode = '55000';
  end if;
  if p_expected_pick_no <> v_draft.current_pick_no then
    raise exception 'draft turn changed' using errcode = '40001';
  end if;
  if v_draft.current_pick_no not between 1 and 16 then
    raise exception 'current pick number is invalid';
  end if;

  v_round := ((v_draft.current_pick_no - 1) / 4) + 1;
  v_slot := ((v_draft.current_pick_no - 1) % 4) + 1;
  if (v_round % 2) = 1 then
    v_expected_player_id := v_draft.ordered_player_ids[v_slot];
  else
    v_expected_player_id := v_draft.ordered_player_ids[5 - v_slot];
  end if;

  if v_player_id <> v_expected_player_id then
    raise exception 'it is not the authenticated player turn' using errcode = '42501';
  end if;
  if not (p_team_id = any (v_draft.eligible_team_ids)) then
    raise exception 'team is not in the fixed best 16';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.event_id = v_draft.event_id
  ) then
    raise exception 'team does not belong to the draft event';
  end if;
  if exists (
    select 1 from public.phase2_draft_picks dp
    where dp.draft_id = v_draft.id and dp.team_id = p_team_id
  ) then
    raise exception 'team was already drafted' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.phase2_draft_picks dp
    where dp.draft_id = v_draft.id
      and dp.player_id = v_player_id
      and dp.draft_round = v_round
  ) then
    raise exception 'player already drafted in this round' using errcode = '23505';
  end if;
  if (select count(*) from public.phase2_draft_picks dp where dp.draft_id = v_draft.id and dp.player_id = v_player_id) >= 4 then
    raise exception 'player already owns four teams' using errcode = '23505';
  end if;

  insert into public.phase2_draft_picks (
    draft_id, event_id, player_id, team_id, pick_no, draft_round, request_id
  ) values (
    v_draft.id, v_draft.event_id, v_player_id, p_team_id,
    v_draft.current_pick_no, v_round, p_request_id
  );

  update public.phase2_drafts
  set current_pick_no = case when v_draft.current_pick_no = 16 then 16 else v_draft.current_pick_no + 1 end,
      status = case when v_draft.current_pick_no = 16 then 'completed' else v_draft.status end,
      version = v_draft.version + 1,
      updated_at = now()
  where id = v_draft.id;

  return public.get_koshien_phase2_draft_state(v_draft.event_id);
end;
$function$;

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

CREATE OR REPLACE FUNCTION public.save_koshien_zombie_prediction(p_event_id text, p_target_team_id uuid, p_expected_version bigint, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_round public.koshien_later_rounds;
  v_player_id uuid;
  v_allowed uuid[];
  v_existing public.zombie_predictions;
  v_request_payload jsonb := jsonb_build_object('target_team_id', p_target_team_id);
  v_previous_payload jsonb;
begin
  select r.* into v_round from public.koshien_later_rounds r where r.event_id=p_event_id and r.phase_key='zombie' for update;
  if auth.uid() is null or v_round.id is null then raise exception 'zombie round is unavailable' using errcode='42501'; end if;
  select p.id into v_player_id from public.players p join public.events e on e.league_id=p.league_id where e.id=p_event_id and p.profile_id=auth.uid();
  if v_player_id is null then raise exception 'event player is required' using errcode='42501'; end if;
  select h.payload into v_previous_payload from public.koshien_later_prediction_requests h
  where h.event_id=p_event_id and h.player_id=v_player_id and h.phase_key='zombie' and h.request_id=p_request_id;
  if v_previous_payload is not null then
    if v_previous_payload is distinct from v_request_payload then raise exception 'request_id payload conflict' using errcode='23505'; end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;
  select x.* into v_existing from public.zombie_predictions x where x.event_id=p_event_id and x.player_id=v_player_id;
  if v_existing.request_id=p_request_id then
    if v_existing.team_id is distinct from p_target_team_id then raise exception 'request_id payload conflict' using errcode='23505'; end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;
  if v_round.status <> 'open' or clock_timestamp() < v_round.opens_at
    or (v_round.end_mode = 'automatic' and clock_timestamp() >= v_round.deadline_at)
    then raise exception 'zombie round is closed' using errcode='55000'; end if;
  if v_round.version <> p_expected_version then raise exception 'zombie version conflict' using errcode='40001'; end if;
  select x.allowed_team_ids into v_allowed from public.koshien_zombie_eligibility x where x.event_id=p_event_id and x.player_id=v_player_id and x.eligible;
  if v_allowed is null or not (p_target_team_id=any(v_allowed)) then raise exception 'zombie team is not allowed' using errcode='42501'; end if;
  insert into public.koshien_later_prediction_requests(event_id,player_id,phase_key,request_id,payload)
  values(p_event_id,v_player_id,'zombie',p_request_id,v_request_payload);
  insert into public.zombie_predictions(event_id,player_id,team_id,request_id,payload)
  values(p_event_id,v_player_id,p_target_team_id,p_request_id,jsonb_build_object('round_version',v_round.version))
  on conflict(event_id,player_id) do update set team_id=excluded.team_id,request_id=excluded.request_id,payload=excluded.payload,updated_at=now();
  return public.get_koshien_later_phase_state(p_event_id);
end $function$;
REVOKE ALL ON FUNCTION public.finalize_koshien_admin_results(text,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.finalize_koshien_admin_results(text,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.save_koshien_phase2_draft_pick(uuid,uuid,integer,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_koshien_phase2_draft_pick(uuid,uuid,integer,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.save_koshien_phase3_prediction(text,integer,integer,integer,integer,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_koshien_phase3_prediction(text,integer,integer,integer,integer,bigint,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.save_koshien_revenge_pick(text,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_koshien_revenge_pick(text,uuid,bigint,uuid) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.save_koshien_zombie_prediction(text,uuid,bigint,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.save_koshien_zombie_prediction(text,uuid,bigint,uuid) TO authenticated,service_role;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TEMP TABLE baseline_functions AS SELECT p.oid,to_jsonb(p) AS meta FROM pg_proc p WHERE p.oid IN('public.finalize_koshien_admin_results(text,text)'::regprocedure,'public.save_koshien_phase2_draft_pick(uuid,uuid,integer,uuid)'::regprocedure,'public.save_koshien_phase3_prediction(text,integer,integer,integer,integer,bigint,uuid)'::regprocedure,'public.save_koshien_revenge_pick(text,uuid,bigint,uuid)'::regprocedure,'public.save_koshien_zombie_prediction(text,uuid,bigint,uuid)'::regprocedure);
CREATE TEMP TABLE baseline_data AS SELECT jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.events x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.phase2_drafts x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.koshien_later_rounds x),(SELECT count(*) FROM public.phase2_draft_picks),(SELECT count(*) FROM public.final_score_predictions),(SELECT count(*) FROM public.revenge_picks),(SELECT count(*) FROM public.zombie_predictions),(SELECT count(*) FROM public.koshien_later_prediction_requests)) state;
-- Same exact stale payloads before patch, after patch, and after rollback.
CREATE FUNCTION public.test_conflicts(expected text) RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $f$
DECLARE call text; wanted text; actual text; msg text;
BEGIN
 FOR call,wanted IN SELECT * FROM (VALUES
 ('SELECT public.finalize_koshien_admin_results(''conflict-event'',repeat(''b'',32))','reviewed scoreboard changed; refresh before finalizing'),
 ('SELECT public.save_koshien_phase2_draft_pick(''00000000-0000-0000-0000-000000000021'',''00000000-0000-0000-0000-000000000041'',1,''00000000-0000-0000-0000-000000000051'')','draft turn changed'),
 ('SELECT public.save_koshien_phase3_prediction(''conflict-event'',1,0,NULL,NULL,1,''00000000-0000-0000-0000-000000000052'')','phase 3 version conflict'),
 ('SELECT public.save_koshien_revenge_pick(''conflict-event'',''00000000-0000-0000-0000-000000000041'',1,''00000000-0000-0000-0000-000000000053'')','revenge version conflict'),
 ('SELECT public.save_koshien_zombie_prediction(''conflict-event'',''00000000-0000-0000-0000-000000000041'',1,''00000000-0000-0000-0000-000000000054'')','zombie version conflict')
 ) v(call_text,wanted_message) LOOP
  BEGIN
   EXECUTE call;
   RAISE EXCEPTION 'unexpected successful mutation';
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE,msg=MESSAGE_TEXT;
   IF actual IS DISTINCT FROM expected OR msg IS DISTINCT FROM wanted THEN
    RAISE EXCEPTION 'unexpected conflict: % % expected % %',actual,msg,expected,wanted;
   END IF;
  END;
 END LOOP;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.test_conflicts('40001');
RESET ROLE;
SELECT 'PASS: captured RPC conflict branches return 40001 before patch';
