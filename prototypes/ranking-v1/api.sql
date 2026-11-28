-- REVIEW PROTOTYPE ONLY; after membership-integrity.sql in disposable CI.
-- No app import, production migration or service-role credentials.
CREATE FUNCTION public.ranking_v1_api_list(p_league_id uuid,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $f$
DECLARE items jsonb; total integer;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id
  OR NOT public.is_league_member(p_league_id) THEN RAISE EXCEPTION 'ranking scope denied' USING ERRCODE='42501'; END IF;
 WITH limited AS (
  SELECT id,name,status,sport_type,prediction_deadline FROM public.events
  WHERE league_id=p_league_id AND preset_type='ranking_v1'
  ORDER BY id LIMIT 101
 )
 SELECT count(*),coalesce(jsonb_agg(to_jsonb(limited) ORDER BY id),'[]'::jsonb) INTO total,items FROM limited;
 RETURN jsonb_build_object('actorId',auth.uid(),'leagueId',p_league_id,'events',
  CASE WHEN total>100 THEN items-100 ELSE items END,'truncated',total>100);
END $f$;

-- One statement snapshot, explicitly scoped to authenticated active members.
-- Definer is needed for private historical player bindings; never return
-- other auth user IDs, raw profiles, or unfiltered prediction rows.
CREATE FUNCTION public.ranking_v1_api_snapshot(p_league_id uuid,p_event_id text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE e public.events%ROWTYPE; me uuid:=auth.uid(); own jsonb; published jsonb:='[]'; ranked jsonb:='[]'; official jsonb;
 visible boolean; n integer;
BEGIN
 IF me IS NULL OR me IS DISTINCT FROM p_actor_id OR NOT public.is_league_member(p_league_id) THEN
  RAISE EXCEPTION 'ranking scope denied' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.events WHERE id=p_event_id AND league_id=p_league_id AND preset_type='ranking_v1';
 IF NOT FOUND THEN RAISE EXCEPTION 'ranking event unavailable' USING ERRCODE='42501'; END IF;
 visible:=e.status IN('open','resultWait','finalized') AND e.prediction_deadline IS NOT NULL AND statement_timestamp()>=e.prediction_deadline;
 SELECT p.payload INTO own FROM public.predictions p WHERE p.event_id=e.id AND p.user_id=me;
 IF visible THEN
  SELECT count(*) INTO n FROM public.predictions WHERE event_id=e.id;
  IF n>200 THEN RAISE EXCEPTION 'ranking snapshot capacity exceeded' USING ERRCODE='54000'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('playerId',b.player_id,'name',pl.display_name,'prediction',p.payload) ORDER BY b.player_id),'[]'::jsonb)
  INTO published FROM public.predictions p
  JOIN ranking_v1_private.prediction_players b ON b.event_id=p.event_id AND b.user_id=p.user_id AND b.league_id=e.league_id
  JOIN public.players pl ON pl.id=b.player_id AND pl.league_id=b.league_id AND pl.profile_id=b.user_id
  WHERE p.event_id=e.id;
  IF jsonb_array_length(published)<>n THEN RAISE EXCEPTION 'ranking historical mapping incomplete' USING ERRCODE='55000'; END IF;
 END IF;
 IF e.status='finalized' THEN
  IF NOT visible THEN RAISE EXCEPTION 'ranking publication inconsistent' USING ERRCODE='55000'; END IF;
  SELECT payload INTO official FROM public.results WHERE event_id=e.id;
  SELECT coalesce(jsonb_agg(to_jsonb(row_data) ORDER BY row_data.rank,row_data."playerId"),'[]'::jsonb) INTO ranked
  FROM (
   SELECT b.player_id AS "playerId",pl.display_name AS name,s.total_score AS score,
    rank() OVER(ORDER BY s.total_score DESC) AS rank,s.breakdown
   FROM public.scores s
   JOIN ranking_v1_private.prediction_players b ON b.event_id=s.event_id AND b.player_id=s.player_id AND b.league_id=e.league_id
   JOIN public.players pl ON pl.id=b.player_id AND pl.league_id=b.league_id AND pl.profile_id=b.user_id
   WHERE s.event_id=e.id AND s.total_score IS NOT NULL
  ) row_data;
  IF official IS NULL OR jsonb_array_length(ranked)<>n
   OR (SELECT count(*) FROM public.scores WHERE event_id=e.id)<>n
   OR NOT EXISTS(SELECT 1 FROM ranking_v1_private.finalize_receipts x WHERE x.event_id=e.id AND x.score_count=n AND x.result_payload=official)
  THEN RAISE EXCEPTION 'ranking finalized snapshot inconsistent' USING ERRCODE='55000'; END IF;
 END IF;
 RETURN jsonb_build_object('actorId',me,'leagueId',p_league_id,'eventId',e.id,'name',e.name,
  'sportType',e.sport_type,'status',e.status,'deadline',e.prediction_deadline,'config',e.rules,
  'canManage',public.is_league_admin(e.league_id),
  'canSubmit',e.status='open' AND e.prediction_deadline IS NOT NULL AND statement_timestamp()<e.prediction_deadline,
  'predictionsPublic',coalesce(visible,false),'ownPrediction',own,'publishedPredictions',published,
  'result',official,'ranking',ranked);
END $f$;

-- Invoker keeps existing RLS and all scoped triggers in effect.
CREATE FUNCTION public.ranking_v1_api_save(p_league_id uuid,p_event_id text,p_actor_id uuid,p_prediction jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
DECLARE saved jsonb;
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id OR NOT public.is_league_member(p_league_id)
  OR NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND league_id=p_league_id AND preset_type='ranking_v1') THEN
  RAISE EXCEPTION 'ranking scope denied' USING ERRCODE='42501'; END IF;
 INSERT INTO public.predictions(event_id,user_id,payload) VALUES(p_event_id,auth.uid(),p_prediction)
 ON CONFLICT(event_id,user_id) DO UPDATE SET payload=EXCLUDED.payload
 RETURNING payload INTO saved;
 IF saved IS DISTINCT FROM p_prediction THEN RAISE EXCEPTION 'ranking save not confirmed' USING ERRCODE='55000'; END IF;
 RETURN jsonb_build_object('actorId',auth.uid(),'leagueId',p_league_id,'eventId',p_event_id,'prediction',saved);
END $f$;

CREATE FUNCTION public.ranking_v1_api_review(p_league_id uuid,p_event_id text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id OR NOT public.is_league_admin(p_league_id)
  OR NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND league_id=p_league_id AND preset_type='ranking_v1') THEN
  RAISE EXCEPTION 'ranking scope denied' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('actorId',auth.uid(),'leagueId',p_league_id,'eventId',p_event_id,'revision',public.ranking_v1_review_revision(p_event_id));
END $f$;

CREATE FUNCTION public.ranking_v1_api_finalize(p_league_id uuid,p_event_id text,p_actor_id uuid,p_revision text,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $f$
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id OR NOT public.is_league_admin(p_league_id)
  OR NOT EXISTS(SELECT 1 FROM public.events WHERE id=p_event_id AND league_id=p_league_id AND preset_type='ranking_v1') THEN
  RAISE EXCEPTION 'ranking scope denied' USING ERRCODE='42501'; END IF;
 RETURN public.ranking_v1_finalize(p_event_id,p_revision,p_result)||
  jsonb_build_object('actorId',auth.uid(),'leagueId',p_league_id);
END $f$;

REVOKE ALL ON FUNCTION public.ranking_v1_api_list(uuid,uuid),public.ranking_v1_api_snapshot(uuid,text,uuid),
 public.ranking_v1_api_save(uuid,text,uuid,jsonb),public.ranking_v1_api_review(uuid,text,uuid),
 public.ranking_v1_api_finalize(uuid,text,uuid,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ranking_v1_api_list(uuid,uuid),public.ranking_v1_api_snapshot(uuid,text,uuid),
 public.ranking_v1_api_save(uuid,text,uuid,jsonb),public.ranking_v1_api_review(uuid,text,uuid),
 public.ranking_v1_api_finalize(uuid,text,uuid,text,jsonb) TO authenticated;
