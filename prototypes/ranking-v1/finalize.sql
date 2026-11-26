-- REVIEW PROTOTYPE ONLY; apply after save-visibility.sql to disposable CI DB.
-- New result finalization path, not a production migration.
CREATE TABLE ranking_v1_private.finalize_permits (
 event_id text NOT NULL, actor uuid NOT NULL, txid bigint NOT NULL,
 PRIMARY KEY(event_id,actor,txid));
CREATE TABLE ranking_v1_private.finalize_receipts (
 event_id text PRIMARY KEY REFERENCES public.events(id) ON DELETE RESTRICT,
 revision text NOT NULL, result_payload jsonb NOT NULL, actor uuid NOT NULL,
 score_count integer NOT NULL, finalized_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE ranking_v1_private.finalize_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE ranking_v1_private.finalize_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA ranking_v1_private FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION ranking_v1_private.guard_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.preset_type='ranking_v1' THEN RAISE EXCEPTION 'prototype deletion disabled' USING ERRCODE='42501'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.preset_type IS DISTINCT FROM NEW.preset_type
  AND 'ranking_v1' IN(OLD.preset_type,NEW.preset_type) THEN
  RAISE EXCEPTION 'ranking preset identity immutable' USING ERRCODE='42501';
 END IF;
 IF NEW.preset_type<>'ranking_v1' THEN RETURN NEW; END IF;
 IF auth.uid() IS NULL OR NOT public.is_league_admin(NEW.league_id) THEN RAISE EXCEPTION 'ranking admin required' USING ERRCODE='42501'; END IF;
 IF NEW.prediction_deadline IS NULL OR NOT ranking_v1_private.valid_config(NEW.rules) THEN
  RAISE EXCEPTION 'ranking config or deadline invalid' USING ERRCODE='22023';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.created_by IS DISTINCT FROM auth.uid() OR NEW.prediction_deadline<=clock_timestamp() THEN
   RAISE EXCEPTION 'ranking must start as draft with future deadline' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.league_id IS DISTINCT FROM OLD.league_id
  OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'ranking event identity immutable' USING ERRCODE='42501'; END IF;
 IF OLD.status='draft' THEN
  IF NEW.status NOT IN('draft','open') OR NEW.prediction_deadline<=clock_timestamp() THEN
   RAISE EXCEPTION 'ranking invalid draft transition' USING ERRCODE='42501';
  END IF;
  IF NEW.status='open' AND (NEW.rules IS DISTINCT FROM OLD.rules OR NEW.prediction_deadline IS DISTINCT FROM OLD.prediction_deadline) THEN
   RAISE EXCEPTION 'review draft config before opening' USING ERRCODE='42501';
  END IF;
 ELSE
  IF NEW.rules IS DISTINCT FROM OLD.rules OR NEW.prediction_deadline IS DISTINCT FROM OLD.prediction_deadline
   OR NEW.sport_type IS DISTINCT FROM OLD.sport_type THEN RAISE EXCEPTION 'ranking opened rules immutable' USING ERRCODE='42501'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
   (OLD.status='open' AND NEW.status='resultWait' AND clock_timestamp()>=OLD.prediction_deadline)
   OR (OLD.status='resultWait' AND NEW.status='finalized' AND EXISTS(
     SELECT 1 FROM ranking_v1_private.finalize_permits p
     WHERE p.event_id=OLD.id AND p.actor=auth.uid() AND p.txid=txid_current()))
  ) THEN
   RAISE EXCEPTION 'ranking transition denied' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $f$;

DROP POLICY ranking_v1_prediction_visibility ON public.predictions;
CREATE POLICY ranking_v1_prediction_visibility ON public.predictions AS RESTRICTIVE FOR SELECT TO authenticated
 USING (NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=predictions.event_id AND e.preset_type='ranking_v1')
 OR (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=predictions.event_id AND e.preset_type='ranking_v1' AND public.is_league_member(e.league_id)))
 OR EXISTS(SELECT 1 FROM public.events e WHERE e.id=predictions.event_id AND e.preset_type='ranking_v1'
   AND public.is_league_member(e.league_id) AND e.status IN('open','resultWait','finalized')
   AND e.prediction_deadline IS NOT NULL AND clock_timestamp()>=e.prediction_deadline));

CREATE OR REPLACE FUNCTION ranking_v1_private.block_unimplemented_result() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE target text;
BEGIN
 FOR target IN SELECT DISTINCT id FROM unnest(ARRAY[
  CASE WHEN TG_OP<>'INSERT' THEN OLD.event_id ELSE NULL END,
  CASE WHEN TG_OP<>'DELETE' THEN NEW.event_id ELSE NULL END]) ids(id)
  WHERE id IS NOT NULL ORDER BY id
 LOOP
  IF EXISTS(SELECT 1 FROM public.events e WHERE e.id=target AND e.preset_type='ranking_v1') THEN
   IF TG_OP<>'INSERT' OR NOT EXISTS(
     SELECT 1 FROM ranking_v1_private.finalize_permits p
     JOIN public.events e ON e.id=p.event_id
     WHERE p.event_id=target AND p.actor=auth.uid() AND p.txid=txid_current()
       AND e.status='resultWait') THEN
    RAISE EXCEPTION 'ranking result write requires atomic finalization' USING ERRCODE='42501';
   END IF;
  END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $f$;

CREATE FUNCTION ranking_v1_private.score_order(c jsonb,p jsonb,r jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $f$
DECLARE parts jsonb; total integer;
BEGIN
 IF NOT ranking_v1_private.valid_order(p,c) OR NOT ranking_v1_private.valid_order(r,c) THEN
  RAISE EXCEPTION 'ranking score input invalid' USING ERRCODE='22023';
 END IF;
 WITH picks AS (
  SELECT value AS id, ordinality::integer AS rank FROM jsonb_array_elements_text(p->'candidateIds') WITH ORDINALITY
 ), actual AS (
  SELECT value AS id, ordinality::integer AS rank FROM jsonb_array_elements_text(r->'candidateIds') WITH ORDINALITY
 ), points AS (
  SELECT picks.id,picks.rank predicted,actual.rank actual,
   CASE WHEN actual.rank IS NULL THEN 0 WHEN actual.rank=picks.rank THEN (ARRAY[10,7,5,3])[picks.rank] ELSE 2 END AS base,
   (candidate->>'multiplierTenths')::integer AS multiplier
  FROM picks LEFT JOIN actual USING(id)
  JOIN LATERAL jsonb_array_elements(c->'candidates') candidate ON candidate->>'id'=picks.id
 )
 SELECT jsonb_agg(jsonb_build_object('candidateId',id,'predictedRank',predicted,'actualRank',actual,
  'basePoints',base,'multiplierTenths',multiplier,'scoreTenths',base*multiplier) ORDER BY predicted),
  sum(base*multiplier)::integer INTO parts,total FROM points;
 RETURN jsonb_build_object('version',1,'scoreTenths',total,'breakdown',parts);
END $f$;

-- Only callable internally after admin, event and deadline checks. Revision
-- covers exact saved inputs and historical player mapping, not client scores.
CREATE FUNCTION ranking_v1_private.revision(e public.events) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $f$
 SELECT md5(jsonb_build_object('id',e.id,'league',e.league_id,'rules',e.rules,
  'deadline',e.prediction_deadline,'status',e.status,'predictions',coalesce((
   SELECT jsonb_agg(jsonb_build_array(p.user_id,p.payload,pl.id) ORDER BY p.user_id)
   FROM public.predictions p LEFT JOIN public.players pl ON pl.league_id=e.league_id AND pl.profile_id=p.user_id
   WHERE p.event_id=e.id),'[]'::jsonb))::text)
$f$;

CREATE FUNCTION public.ranking_v1_review_revision(p_event_id text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE e public.events%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'ranking admin required' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.events WHERE id=p_event_id AND preset_type='ranking_v1';
 IF NOT FOUND OR NOT public.is_league_admin(e.league_id) THEN RAISE EXCEPTION 'ranking admin required' USING ERRCODE='42501'; END IF;
 IF e.status<>'resultWait' OR clock_timestamp()<e.prediction_deadline THEN RAISE EXCEPTION 'ranking review closed' USING ERRCODE='42501'; END IF;
 RETURN ranking_v1_private.revision(e);
END $f$;

CREATE FUNCTION public.ranking_v1_finalize(p_event_id text,p_revision text,p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE e public.events%ROWTYPE; receipt ranking_v1_private.finalize_receipts%ROWTYPE;
 v_actor uuid:=auth.uid(); prediction_count integer; inserted_count integer; mapped_count integer;
BEGIN
 IF v_actor IS NULL OR p_revision IS NULL OR p_revision !~ '^[0-9a-f]{32}$' THEN
  RAISE EXCEPTION 'ranking finalize invalid credentials or revision' USING ERRCODE='42501';
 END IF;
 SELECT * INTO e FROM public.events WHERE id=p_event_id AND preset_type='ranking_v1' FOR UPDATE;
 IF NOT FOUND OR NOT public.is_league_admin(e.league_id) THEN RAISE EXCEPTION 'ranking admin required' USING ERRCODE='42501'; END IF;
 -- Serialize with changes of the actor membership. Mapping rows are also
 -- locked below. The full club membership/retirement lifecycle is not yet integrated.
 PERFORM 1 FROM public.league_members lm WHERE lm.league_id=e.league_id AND lm.user_id=v_actor
  AND lm.membership_status='active' AND lm.role IN('owner','co_owner') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'ranking admin required' USING ERRCODE='42501'; END IF;
 IF NOT ranking_v1_private.valid_order(p_result,e.rules) THEN RAISE EXCEPTION 'ranking result invalid' USING ERRCODE='22023'; END IF;
 IF e.status='finalized' THEN
  SELECT * INTO receipt FROM ranking_v1_private.finalize_receipts WHERE event_id=e.id;
  IF NOT FOUND OR receipt.revision IS DISTINCT FROM p_revision OR receipt.result_payload IS DISTINCT FROM p_result THEN
   RAISE EXCEPTION 'ranking already finalized with different review or result' USING ERRCODE='40001';
  END IF;
  RETURN jsonb_build_object('eventId',e.id,'status','finalized','scoreCount',receipt.score_count,'recovered',true);
 END IF;
 IF e.status<>'resultWait' OR e.prediction_deadline IS NULL OR clock_timestamp()<e.prediction_deadline THEN
  RAISE EXCEPTION 'ranking finalization requires closed predictions' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.results WHERE event_id=e.id) OR EXISTS(SELECT 1 FROM public.scores WHERE event_id=e.id)
  OR EXISTS(SELECT 1 FROM ranking_v1_private.finalize_receipts WHERE event_id=e.id) THEN
  RAISE EXCEPTION 'ranking preexisting result or scores' USING ERRCODE='55000';
 END IF;
 -- Only submitted predictions are ranked, even when their member later
 -- leaves; a missing or ambiguous historical mapping blocks finalization.
 PERFORM pl.id FROM public.players pl JOIN public.predictions p
  ON p.user_id=pl.profile_id AND p.event_id=e.id WHERE pl.league_id=e.league_id
  ORDER BY pl.id FOR SHARE OF pl NOWAIT;
 SELECT count(*) INTO prediction_count FROM public.predictions WHERE event_id=e.id;
 SELECT count(*) INTO mapped_count FROM public.predictions p JOIN public.players pl
  ON pl.profile_id=p.user_id AND pl.league_id=e.league_id WHERE p.event_id=e.id;
 IF prediction_count=0 OR mapped_count<>prediction_count THEN
  RAISE EXCEPTION 'ranking missing submissions or player mapping' USING ERRCODE='22023';
 END IF;
 IF p_revision IS DISTINCT FROM ranking_v1_private.revision(e) THEN RAISE EXCEPTION 'ranking stale review' USING ERRCODE='40001'; END IF;
 IF EXISTS(SELECT 1 FROM public.predictions p WHERE p.event_id=e.id AND NOT ranking_v1_private.valid_order(p.payload,e.rules)) THEN
  RAISE EXCEPTION 'ranking saved prediction invalid' USING ERRCODE='22023';
 END IF;
 INSERT INTO ranking_v1_private.finalize_permits VALUES(e.id,v_actor,txid_current());
 INSERT INTO public.results(event_id,payload,updated_by) VALUES(e.id,p_result,v_actor);
 INSERT INTO public.scores(event_id,player_id,total_score,breakdown)
 SELECT e.id,pl.id,(sc.score->>'scoreTenths')::numeric/10,sc.score
 FROM public.predictions p JOIN public.players pl ON pl.profile_id=p.user_id AND pl.league_id=e.league_id
 CROSS JOIN LATERAL (SELECT ranking_v1_private.score_order(e.rules,p.payload,p_result) score) sc
 WHERE p.event_id=e.id;
 GET DIAGNOSTICS inserted_count=ROW_COUNT;
 IF inserted_count<>prediction_count THEN RAISE EXCEPTION 'ranking incomplete score write'; END IF;
 INSERT INTO ranking_v1_private.finalize_receipts(event_id,revision,result_payload,actor,score_count)
 VALUES(e.id,p_revision,p_result,v_actor,inserted_count);
 UPDATE public.events SET status='finalized' WHERE id=e.id;
 DELETE FROM ranking_v1_private.finalize_permits WHERE event_id=e.id AND finalize_permits.actor=v_actor AND txid=txid_current();
 IF NOT FOUND THEN RAISE EXCEPTION 'ranking finalization permit missing'; END IF;
 RETURN jsonb_build_object('eventId',e.id,'status','finalized','scoreCount',inserted_count,'recovered',false);
END $f$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ranking_v1_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ranking_v1_review_revision(text),public.ranking_v1_finalize(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ranking_v1_review_revision(text),public.ranking_v1_finalize(text,text,jsonb) TO authenticated;
