-- Runs after save/visibility checks in same rollback-only transaction.
-- Mirror members' production read permissions for results and scores.
CREATE POLICY result_member_read ON public.results FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=results.event_id AND public.is_league_member(e.league_id)));
CREATE POLICY score_member_read ON public.scores FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=scores.event_id AND public.is_league_member(e.league_id)));
CREATE TEMP TABLE finalize_review AS SELECT ''::text AS revision;
GRANT SELECT,UPDATE ON finalize_review TO authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
UPDATE finalize_review SET revision=public.ranking_v1_review_revision('finalize-case');
DO $f$ BEGIN
 BEGIN
  UPDATE public.events SET status='finalized' WHERE id='finalize-case';
  RAISE EXCEPTION 'direct finalization accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.ranking_v1_finalize('finalize-case',repeat('0',32),(SELECT pick FROM inputs));
  RAISE EXCEPTION 'stale revision accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN
  PERFORM public.ranking_v1_finalize('finalize-case',(SELECT revision FROM finalize_review),'{"version":1,"candidateIds":["a","a","b","c"]}');
  RAISE EXCEPTION 'invalid result accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.ranking_v1_finalize('new',repeat('0',32),(SELECT pick FROM inputs));
  RAISE EXCEPTION 'early finalization accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.ranking_v1_finalize('missing-player',public.ranking_v1_review_revision('missing-player'),(SELECT pick FROM inputs));
  RAISE EXCEPTION 'missing player accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.ranking_v1_finalize('invalid-saved',public.ranking_v1_review_revision('invalid-saved'),(SELECT pick FROM inputs));
  RAISE EXCEPTION 'invalid saved prediction accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  PERFORM public.ranking_v1_finalize('empty-submissions',public.ranking_v1_review_revision('empty-submissions'),(SELECT pick FROM inputs));
  RAISE EXCEPTION 'empty submissions accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  INSERT INTO ranking_v1_private.finalize_permits VALUES('finalize-case',auth.uid(),txid_current());
  RAISE EXCEPTION 'permit forged';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM set_config('ranking_v1.finalize_permit','true',true);
 BEGIN
  INSERT INTO public.results(event_id,payload,updated_by) VALUES('finalize-case',(SELECT pick FROM inputs),auth.uid());
  RAISE EXCEPTION 'GUC bypass accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
DO $f$ BEGIN
 BEGIN PERFORM public.ranking_v1_review_revision('finalize-case'); RAISE EXCEPTION 'member reviewed admin revision';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ranking_v1_finalize('finalize-case',(SELECT revision FROM finalize_review),(SELECT pick FROM inputs)); RAISE EXCEPTION 'member finalized';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
DO $f$ BEGIN
 BEGIN PERFORM public.ranking_v1_finalize('finalize-case',(SELECT revision FROM finalize_review),(SELECT pick FROM inputs)); RAISE EXCEPTION 'outsider finalized';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $f$;
RESET ROLE;
DO $f$ BEGIN
 IF EXISTS(SELECT 1 FROM public.results WHERE event_id<>'legacy') OR EXISTS(SELECT 1 FROM public.scores WHERE event_id<>'legacy')
 OR EXISTS(SELECT 1 FROM ranking_v1_private.finalize_receipts) OR EXISTS(SELECT 1 FROM ranking_v1_private.finalize_permits)
 OR has_function_privilege('anon','public.ranking_v1_finalize(text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'failed finalization leaked changes or privileges'; END IF;
END $f$;
-- Force a failure after INSERT results, while writing scores. Every prior
-- write and the private permit must roll back with the failing RPC.
CREATE FUNCTION ranking_v1_private.fixture_fail_score() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN IF NEW.event_id='finalize-case' THEN RAISE EXCEPTION 'fixture failure' USING ERRCODE='ZX002'; END IF; RETURN NEW; END $f$;
CREATE TRIGGER z_fixture_fail_score BEFORE INSERT ON public.scores FOR EACH ROW EXECUTE FUNCTION ranking_v1_private.fixture_fail_score();
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $f$ BEGIN
 BEGIN PERFORM public.ranking_v1_finalize('finalize-case',(SELECT revision FROM finalize_review),(SELECT pick FROM inputs)); RAISE EXCEPTION 'fixture failure not raised';
 EXCEPTION WHEN SQLSTATE 'ZX002' THEN NULL; END;
END $f$;
RESET ROLE;
DROP TRIGGER z_fixture_fail_score ON public.scores;
DROP FUNCTION ranking_v1_private.fixture_fail_score();
DO $f$ BEGIN
 IF EXISTS(SELECT 1 FROM public.results WHERE event_id='finalize-case') OR EXISTS(SELECT 1 FROM public.scores WHERE event_id='finalize-case')
 OR EXISTS(SELECT 1 FROM ranking_v1_private.finalize_receipts) OR EXISTS(SELECT 1 FROM ranking_v1_private.finalize_permits)
 OR (SELECT status FROM public.events WHERE id='finalize-case')<>'resultWait' THEN RAISE EXCEPTION 'partial finalization survived'; END IF;
END $f$;
SET LOCAL ROLE authenticated;
DO $f$ DECLARE answer jsonb; BEGIN
 answer:=public.ranking_v1_finalize('finalize-case',(SELECT revision FROM finalize_review),(SELECT pick FROM inputs));
 IF answer IS DISTINCT FROM '{"eventId":"finalize-case","status":"finalized","scoreCount":2,"recovered":false}'::jsonb THEN RAISE EXCEPTION 'unexpected finalize response %',answer; END IF;
 IF (SELECT total_score FROM public.scores WHERE event_id='finalize-case' AND player_id='00000000-0000-0000-0000-000000000001') IS DISTINCT FROM 32.8::numeric
 OR (SELECT total_score FROM public.scores WHERE event_id='finalize-case' AND player_id='00000000-0000-0000-0000-000000000012') IS DISTINCT FROM 11.6::numeric THEN RAISE EXCEPTION 'score mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM public.scores WHERE event_id='finalize-case' AND (phase1_score IS DISTINCT FROM total_score OR phase2_score<>0 OR phase3_score<>0 OR revenge_score<>0 OR zombie_score<>0 OR total_score IS DISTINCT FROM (breakdown->>'scoreTenths')::numeric/10)) THEN RAISE EXCEPTION 'generated ranking total or component mismatch'; END IF;
 answer:=public.ranking_v1_finalize('finalize-case',(SELECT revision FROM finalize_review),(SELECT pick FROM inputs));
 IF answer->'recovered' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'idempotent recovery failed'; END IF;
 BEGIN PERFORM public.ranking_v1_finalize('finalize-case',(SELECT revision FROM finalize_review),'{"version":1,"candidateIds":["b","a","c","d"]}'); RAISE EXCEPTION 'different retry accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN UPDATE public.scores SET phase1_score=999 WHERE event_id='finalize-case'; RAISE EXCEPTION 'score tampering accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.results SET payload='{}' WHERE event_id='finalize-case'; RAISE EXCEPTION 'result tampering accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.scores WHERE event_id='finalize-case'; RAISE EXCEPTION 'score deletion accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.events SET status='resultWait' WHERE id='finalize-case'; RAISE EXCEPTION 'unaudited reopen accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
DO $f$ BEGIN
 IF (SELECT count(*) FROM public.predictions WHERE event_id='finalize-case')<>2
 OR (SELECT count(*) FROM public.scores WHERE event_id='finalize-case')<>2
 OR (SELECT count(*) FROM public.results WHERE event_id='finalize-case')<>1 THEN RAISE EXCEPTION 'member cannot read finalized result'; END IF;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
DO $f$ BEGIN
 IF EXISTS(SELECT 1 FROM public.scores WHERE event_id='finalize-case') OR EXISTS(SELECT 1 FROM public.results WHERE event_id='finalize-case') THEN RAISE EXCEPTION 'cross-club final result leak'; END IF;
END $f$;
RESET ROLE;
DO $f$ BEGIN
 IF (SELECT count(*) FROM ranking_v1_private.finalize_receipts)<>1 OR EXISTS(SELECT 1 FROM ranking_v1_private.finalize_permits)
 OR (SELECT count(*) FROM public.scores WHERE event_id='finalize-case')<>2
 OR (SELECT state FROM legacy_snapshot) IS DISTINCT FROM jsonb_build_array(
 (SELECT to_jsonb(e) FROM public.events e WHERE id='legacy'),(SELECT to_jsonb(p) FROM public.predictions p WHERE event_id='legacy'),
 (SELECT to_jsonb(r) FROM public.results r WHERE event_id='legacy'),(SELECT to_jsonb(s) FROM public.scores s WHERE event_id='legacy')) THEN RAISE EXCEPTION 'finalization isolation or receipt failure'; END IF;
END $f$;
SELECT 'PASS: ranking atomic finalization, exact scores, rollback after partial write, retry, member publication, immutable result and legacy isolation';
