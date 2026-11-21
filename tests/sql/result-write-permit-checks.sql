-- Fixture owns the transaction; all changes/roles roll back at the end.
SELECT yoso_approval_private.lock_revision('save');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT public.test_reject($q$INSERT INTO public.matches(event_id,round_key,match_no) VALUES('save','R1',1)$q$,'42501');
SELECT public.test_reject($q$INSERT INTO public.results(event_id,updated_by) VALUES('save',auth.uid())$q$,'42501');
SELECT public.test_reject($q$INSERT INTO public.scores(event_id,player_id) VALUES('save','20000000-0000-0000-0000-000000000001')$q$,'42501');
SELECT public.test_reject($q$SELECT yoso_approval_private.issue_write_permit('save')$q$,'42501');
SELECT public.test_reject($q$INSERT INTO yoso_approval_private.write_permits VALUES('save',txid_current(),auth.uid())$q$,'42501');
-- A client-controlled flag is never a permit.
SET LOCAL yoso.result_write_permit='true';
SELECT public.test_reject($q$INSERT INTO public.matches(event_id,round_key,match_no) VALUES('save','R1',1)$q$,'42501');
RESET ROLE;
SELECT public.test_assert((SELECT revision=0 FROM yoso_approval_private.revisions WHERE event_id='save'),'rejections leave revision unchanged');

-- Failure after entry must roll back permit and revision.
SET LOCAL ROLE authenticated;
SELECT public.test_reject($q$SELECT public.save_koshien_result_snapshot('save','{}','[]','{}')$q$,'P0001');
RESET ROLE;
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM yoso_approval_private.write_permits WHERE event_id='save'),'invalid save leaves no permit');
SELECT public.test_assert((SELECT revision=0 FROM yoso_approval_private.revisions WHERE event_id='save'),'invalid save rolls revision back');

SAVEPOINT authorized_save;
SET LOCAL ROLE authenticated;
SELECT public.save_koshien_result_snapshot('save','[{"event_id":"save","round_key":"R1","match_no":1,"team1_id":"10000000-0000-0000-0000-000000000001","team2_id":"10000000-0000-0000-0000-000000000002","team1_score":3,"team2_score":1,"winner_team_id":"10000000-0000-0000-0000-000000000001","loser_team_id":"10000000-0000-0000-0000-000000000002","status":"completed"}]','[]','{"result":"guarded"}');
RESET ROLE;
SELECT public.test_assert((SELECT revision=1 FROM yoso_approval_private.revisions WHERE event_id='save'),'guarded save advances once');
SELECT public.test_assert((SELECT payload->>'result'='guarded' FROM public.results WHERE event_id='save'),'guarded save persists results');
SELECT public.test_assert((SELECT team1_score=3 FROM public.matches WHERE event_id='save'),'guarded save persists match');
SELECT public.test_assert((SELECT count(*)=1 FROM public.scores WHERE event_id='save'),'guarded save persists scores');
SELECT public.test_assert((SELECT transaction_id=txid_current() FROM yoso_approval_private.write_permits WHERE event_id='save'),'permit bound to transaction');
-- Isolate rejection reasons from RLS by exercising the trigger as table owner.
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT public.test_reject($q$UPDATE public.matches SET team1_score=5 WHERE event_id='save'$q$,'42501');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
UPDATE yoso_approval_private.write_permits SET transaction_id=txid_current()-1 WHERE event_id='save';
SELECT public.test_reject($q$UPDATE public.results SET payload='{}' WHERE event_id='save'$q$,'42501');
SELECT public.test_reject($q$DELETE FROM public.matches WHERE event_id='save'$q$,'42501');
SELECT public.test_reject($q$DELETE FROM public.scores WHERE event_id='save'$q$,'42501');
SELECT public.test_reject($q$DELETE FROM public.results WHERE event_id='save'$q$,'42501');
SELECT yoso_approval_private.issue_write_permit('save');
SELECT public.test_reject($q$UPDATE public.matches SET event_id='b' WHERE event_id='save'$q$,'42501');
SELECT public.test_reject($q$INSERT INTO public.matches(event_id,round_key,match_no) VALUES('b','R1',1)$q$,'42501');
ROLLBACK TO SAVEPOINT authorized_save;
RESET ROLE;
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM yoso_approval_private.write_permits WHERE event_id='save'),'rollback discards permit');
SELECT public.test_assert((SELECT revision=0 FROM yoso_approval_private.revisions WHERE event_id='save'),'rollback restores revision');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.results WHERE event_id='save'),'rollback discards result');

-- The permit must not override the invoker RPC's original RLS.
DROP POLICY results_admin ON public.results;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT public.test_reject($q$SELECT public.save_koshien_result_snapshot('save','[]','[]','{}')$q$,'42501');
RESET ROLE;
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM yoso_approval_private.write_permits WHERE event_id='save'),'RLS rejection rolls permit back');
SELECT public.test_assert((SELECT revision=0 FROM yoso_approval_private.revisions WHERE event_id='save'),'RLS rejection rolls revision back');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT public.test_reject($q$SELECT yoso_approval_private.begin_result_write('save')$q$,'42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT public.test_reject($q$SELECT yoso_approval_private.begin_result_write('save')$q$,'42501');
RESET ROLE;
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM yoso_approval_private.write_permits WHERE event_id='save'),'unauthorized entry creates no permit');
SELECT public.test_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.save_koshien_result_snapshot(text,jsonb,jsonb,jsonb)'::regprocedure),'guarded save remains invoker');
ROLLBACK;
