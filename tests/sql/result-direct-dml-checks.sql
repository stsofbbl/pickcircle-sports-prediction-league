
-- Characterization of an UNSAFE prototype boundary, not a desired final contract.
-- Uses production admin UPDATE predicates read on 2026-11-16; full triggers absent.
-- Must be replaced by rejection assertions when the writer gate is implemented.
ALTER TABLE public.events ADD COLUMN status text DEFAULT 'resultWait';
ALTER TABLE public.events ADD COLUMN rules jsonb DEFAULT '{}';
GRANT UPDATE ON public.events TO authenticated;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_read_fixture ON public.events FOR SELECT TO authenticated USING (true);
CREATE POLICY events_update_admin ON public.events FOR UPDATE TO authenticated
 USING (public.is_league_admin(league_id)) WITH CHECK (public.is_league_admin(league_id));
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY matches_admin_all ON public.matches FOR ALL TO authenticated
 USING (EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)))
 WITH CHECK (EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)));
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY scores_admin_all ON public.scores FOR ALL TO authenticated
 USING (EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)))
 WITH CHECK (EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)));
DROP POLICY results_admin ON public.results;
CREATE POLICY results_select_fixture ON public.results FOR SELECT TO authenticated USING (true);
CREATE POLICY results_update_admin ON public.results FOR UPDATE TO authenticated
 USING (EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)))
 WITH CHECK (updated_by=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)));
CREATE POLICY results_insert_admin ON public.results FOR INSERT TO authenticated
 WITH CHECK (updated_by=(SELECT auth.uid()) AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)));
INSERT INTO public.matches(event_id,round_key,match_no,status,team1_score) VALUES('save','R1',1,'scheduled',0);
INSERT INTO public.scores(event_id,player_id,phase1_score) VALUES('save','20000000-0000-0000-0000-000000000001',0);
INSERT INTO public.results VALUES('save','{"result":"before"}','00000000-0000-0000-0000-000000000001',now());
SELECT yoso_approval_private.lock_revision('save');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
UPDATE public.matches SET team1_score=7 WHERE event_id='save';
UPDATE public.results SET payload='{"result":"direct"}' WHERE event_id='save';
UPDATE public.scores SET phase1_score=99 WHERE event_id='save';
UPDATE public.events SET status='finalized',rules='{"resultFlow":{"status":"finalized"}}' WHERE id='save';
RESET ROLE;
SELECT public.test_assert((SELECT team1_score=7 FROM public.matches WHERE event_id='save'),'KNOWN GAP: direct match update');
SELECT public.test_assert((SELECT payload->>'result'='direct' FROM public.results WHERE event_id='save'),'KNOWN GAP: direct result update');
SELECT public.test_assert((SELECT phase1_score=99 FROM public.scores WHERE event_id='save'),'KNOWN GAP: direct score update in minimal fixture');
SELECT public.test_assert((SELECT status='finalized' AND rules->'resultFlow'->>'status'='finalized' FROM public.events WHERE id='save'),'KNOWN GAP: direct event finalization');
SELECT public.test_assert((SELECT revision=0 FROM yoso_approval_private.revisions WHERE event_id='save'),'KNOWN GAP: all direct writes bypass revision');
-- Ordinary membership still does not grant admin writes. Zero updated rows is RLS rejection.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
WITH changed AS (UPDATE public.events SET status='open' WHERE id='save' RETURNING id)
 SELECT public.test_assert((SELECT count(*)=0 FROM changed),'member cannot change event');
WITH changed AS (UPDATE public.results SET payload='{}' WHERE event_id='save' RETURNING event_id)
 SELECT public.test_assert((SELECT count(*)=0 FROM changed),'member cannot change result');
RESET ROLE;
-- A blanket revoke is NOT a compatible fix: the existing save RPC is INVOKER.
REVOKE INSERT,UPDATE ON public.results FROM authenticated;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT public.test_reject($q$SELECT public.save_koshien_result_snapshot('save','[]','[]','{"result":"rpc"}')$q$,'42501');
RESET ROLE;
SELECT public.test_assert((SELECT revision=0 FROM yoso_approval_private.revisions WHERE event_id='save'),'revoked save rolls revision back');
SELECT public.test_assert((SELECT payload->>'result'='direct' FROM public.results WHERE event_id='save'),'revoked save preserves previous result');
SELECT public.test_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.save_koshien_result_snapshot(text,jsonb,jsonb,jsonb)'::regprocedure),'save still uses caller privileges');
ROLLBACK;
