-- Actual captured RPC bodies; synthetic roster, not actual future schools.
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY lifecycle_prediction_select ON public.predictions FOR SELECT TO authenticated USING(
 (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=predictions.event_id AND public.is_league_member(e.league_id))) OR public.is_prediction_public(event_id));
CREATE POLICY lifecycle_prediction_insert ON public.predictions FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND public.is_prediction_open(event_id));
CREATE POLICY lifecycle_prediction_update ON public.predictions FOR UPDATE TO authenticated USING(user_id=auth.uid() AND public.is_prediction_open(event_id)) WITH CHECK(user_id=auth.uid() AND public.is_prediction_open(event_id));
ALTER TABLE public.phase1_picks ENABLE ROW LEVEL SECURITY;
CREATE POLICY lifecycle_picks_select ON public.phase1_picks FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.players p WHERE p.id=phase1_picks.player_id AND p.profile_id=auth.uid()) OR public.is_prediction_public(event_id));
CREATE POLICY lifecycle_picks_write ON public.phase1_picks FOR ALL TO authenticated USING(public.is_prediction_open(event_id) AND EXISTS(SELECT 1 FROM public.players p WHERE p.id=phase1_picks.player_id AND p.profile_id=auth.uid())) WITH CHECK(public.is_prediction_open(event_id) AND EXISTS(SELECT 1 FROM public.players p WHERE p.id=phase1_picks.player_id AND p.profile_id=auth.uid()));
GRANT SELECT,INSERT,UPDATE,DELETE ON public.predictions,public.phase1_picks TO authenticated;
GRANT USAGE,SELECT ON SEQUENCE public.predictions_id_seq TO authenticated;

CREATE FUNCTION public.fixture_roster() RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
 SELECT jsonb_agg(jsonb_build_object('district_name',district,'school_name','Fixture school '||n) ORDER BY n)
 FROM unnest(ARRAY['北北海道','南北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉','千葉','東東京','西東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡','愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島','山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄']) WITH ORDINALITY d(district,n)
$$;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
INSERT INTO public.events(id,league_id,preset_type,status,rules,name,season,prediction_deadline,created_by)
VALUES ('lifecycle-draft','00000000-0000-0000-0000-000000000010','koshien','draft','{"approvalPolicy":"admin","resultFlow":{"status":"none"},"config":{"teams":[],"startRoundsConfirmed":false,"externalResults":{"competitionType":"summer","year":2027}}}','Fixture 2027','2027',now()+interval '1 year',auth.uid());
SELECT public.replace_koshien_representatives('lifecycle-draft',public.fixture_roster(),2027)->>'count' AS representatives;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.teams WHERE event_id='lifecycle-draft')<>49 OR
    (SELECT count(*) FROM public.event_teams WHERE event_id='lifecycle-draft')<>49 THEN
   RAISE EXCEPTION 'real roster import failed';
 END IF;
END $$;
SELECT public.confirm_koshien_start_rounds('lifecycle-draft',(SELECT jsonb_agg(jsonb_build_object('representative_key',metadata->>'representative_key','start_round',CASE WHEN seed<=15 THEN 2 ELSE 1 END) ORDER BY seed) FROM public.teams WHERE event_id='lifecycle-draft'));
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $$ DECLARE v_ids uuid[]; BEGIN
 SELECT array_agg(id ORDER BY seed) INTO v_ids FROM (SELECT id,seed FROM public.teams WHERE event_id='lifecycle-draft' AND start_round=1 ORDER BY seed LIMIT 8) t;
 BEGIN
   PERFORM public.save_koshien_phase1_prediction('lifecycle-draft',v_ids,v_ids[1],'{"fixture":true}');
   RAISE EXCEPTION 'draft accepted prediction';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.open_koshien_draft('lifecycle-draft',public.koshien_admin_result_revision('lifecycle-draft'));
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $$ DECLARE v_ids uuid[]; v_result jsonb; BEGIN
 SELECT array_agg(id ORDER BY seed) INTO v_ids FROM (SELECT id,seed FROM public.teams WHERE event_id='lifecycle-draft' AND start_round=1 ORDER BY seed LIMIT 8) t;
 v_result:=public.save_koshien_phase1_prediction('lifecycle-draft',v_ids,v_ids[1],'{"fixture":true}');
 IF (v_result->>'pickCount')::int<>8 OR (SELECT count(*) FROM public.phase1_picks WHERE event_id='lifecycle-draft')<>8 OR (SELECT count(*) FROM public.phase1_picks WHERE event_id='lifecycle-draft' AND captain)<>1 OR (SELECT count(*) FROM public.predictions WHERE event_id='lifecycle-draft')<>1 THEN
 RAISE EXCEPTION 'prediction not saved'; END IF;
END $$;
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.predictions WHERE event_id='lifecycle-draft') OR EXISTS(SELECT 1 FROM public.phase1_picks WHERE event_id='lifecycle-draft') THEN
 RAISE EXCEPTION 'another member prediction exposed before deadline'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.matches WHERE event_id='test-finalize')<>48 OR (SELECT count(*) FROM public.scores WHERE event_id='test-finalize')<>1 THEN RAISE EXCEPTION 'existing fixture modified'; END IF;
END $$;
SELECT 'PASS: actual roster import -> confirm -> open -> member prediction with pre-deadline privacy';

-- Re-import and direct confirmation reset must both fail atomically after opening.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
   PERFORM public.replace_koshien_representatives('lifecycle-draft',public.fixture_roster(),2027);
   RAISE EXCEPTION 'open roster re-import succeeded';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
   UPDATE public.events SET rules=jsonb_set(rules,'{config,startRoundsConfirmed}','false')
   WHERE id='lifecycle-draft';
   RAISE EXCEPTION 'open confirmation reset succeeded';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id='lifecycle-draft'
   AND status='open' AND rules->'config'->'startRoundsConfirmed'='true'::jsonb)
 THEN RAISE EXCEPTION 'open event confirmation changed'; END IF;
END $$;

-- The existing confirm RPC can otherwise move four of the member's eight
-- first-round picks into round two while keeping the total distribution 34/15.
-- Protect both actual representations, and prove statement rollback preserves
-- every roster and pick row rather than merely retaining the confirmation flag.
CREATE TEMP TABLE lifecycle_round_baseline AS
SELECT
 (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text) FROM public.teams t WHERE t.event_id='lifecycle-draft') AS teams,
 (SELECT md5(jsonb_agg(to_jsonb(et) ORDER BY et.id)::text) FROM public.event_teams et WHERE et.event_id='lifecycle-draft') AS event_teams,
 (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text) FROM public.phase1_picks p WHERE p.event_id='lifecycle-draft') AS picks;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $$ DECLARE v_rows jsonb; BEGIN
 SELECT jsonb_agg(jsonb_build_object('representative_key',metadata->>'representative_key','start_round',
  CASE WHEN seed BETWEEN 1 AND 4 THEN 1 WHEN seed BETWEEN 16 AND 19 THEN 2 ELSE start_round END) ORDER BY seed)
 INTO v_rows FROM public.teams WHERE event_id='lifecycle-draft';
 BEGIN
   PERFORM public.confirm_koshien_start_rounds('lifecycle-draft',v_rows);
   RAISE EXCEPTION 'changed confirmed round assignment accepted';
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM <> 'confirmed Koshien start rounds cannot be changed while open' THEN RAISE; END IF;
 END;
 BEGIN
   UPDATE public.teams SET start_round=3-start_round WHERE event_id='lifecycle-draft' AND seed=16;
   RAISE EXCEPTION 'direct team start round changed';
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM <> 'confirmed Koshien start rounds cannot be changed while open' THEN RAISE; END IF;
 END;
 -- event_teams direct writes are allowed for the real admin. Fixture grant and
 -- policy are added below so this checks the trigger rather than an RLS denial.
END $$;
RESET ROLE;
CREATE POLICY lifecycle_event_teams_admin ON public.event_teams FOR UPDATE TO authenticated
 USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_teams.event_id AND public.is_league_admin(e.league_id)))
 WITH CHECK(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_teams.event_id AND public.is_league_admin(e.league_id)));
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
   UPDATE public.event_teams SET metadata=jsonb_set(metadata,'{startRound}','2') WHERE event_id='lifecycle-draft' AND name='Fixture school 16';
   RAISE EXCEPTION 'direct event team start round changed';
 EXCEPTION WHEN invalid_parameter_value THEN
   IF SQLERRM <> 'confirmed Koshien start rounds cannot be changed while open' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM lifecycle_round_baseline b WHERE
   b.teams IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY t.id)::text) FROM public.teams t WHERE t.event_id='lifecycle-draft')
   OR b.event_teams IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(et) ORDER BY et.id)::text) FROM public.event_teams et WHERE et.event_id='lifecycle-draft')
   OR b.picks IS DISTINCT FROM (SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY p.id)::text) FROM public.phase1_picks p WHERE p.event_id='lifecycle-draft')) THEN
 RAISE EXCEPTION 'denied round change mutated roster or picks'; END IF;
END $$;
-- Same-value changes and unrelated odds update are not prohibited.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.confirm_koshien_start_rounds('lifecycle-draft',(
 SELECT jsonb_agg(jsonb_build_object('representative_key',metadata->>'representative_key','start_round',start_round) ORDER BY seed)
 FROM public.teams WHERE event_id='lifecycle-draft'));
UPDATE public.teams SET odds=2 WHERE event_id='lifecycle-draft' AND seed=16;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.teams WHERE event_id='lifecycle-draft' AND seed=16 AND odds=2 AND start_round=1) THEN
 RAISE EXCEPTION 'unrelated odds update blocked'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: confirmed open start-round change rejected; roster/picks unchanged; same assignment and odds preserved';
