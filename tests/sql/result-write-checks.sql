
SET LOCAL ROLE authenticated;
SELECT public.test_reject($q$SELECT public.save_koshien_result_snapshot('save','[]','[]','{}')$q$,'42501');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT public.test_reject($q$SELECT public.save_koshien_result_snapshot('save','[]','[]','{}')$q$,'42501');
SELECT public.test_reject($q$SELECT yoso_approval_private.begin_result_write('save')$q$,'42501');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SELECT public.test_reject($q$SELECT public.save_koshien_result_snapshot('save','[]','[]','{}')$q$,'42501');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT public.save_koshien_result_snapshot('save','[{"event_id":"save","round_key":"R1","match_no":1,"team1_id":"10000000-0000-0000-0000-000000000001","team2_id":"10000000-0000-0000-0000-000000000002","team1_score":3,"team2_score":1,"winner_team_id":"10000000-0000-0000-0000-000000000001","loser_team_id":"10000000-0000-0000-0000-000000000002","status":"completed"}]','[]','{"result":"first"}');
RESET ROLE;
SELECT public.test_assert((SELECT revision=1 FROM yoso_approval_private.revisions WHERE event_id='save'),'authorized save advances once');
SELECT public.test_assert((SELECT payload->>'result'='first' FROM public.results WHERE event_id='save'),'result persisted');
SELECT public.test_assert((SELECT team1_score=3 AND status='completed' FROM public.matches WHERE event_id='save'),'match persisted');
SELECT public.test_assert((SELECT count(*)=1 FROM public.scores WHERE event_id='save'),'score row persisted');
-- Replaying the same payload still advances the approval revision: a result
-- save is a state-changing operation even when its content is unchanged.
SAVEPOINT identical_result_replay;
SET LOCAL ROLE authenticated;
SELECT public.save_koshien_result_snapshot('save','[{"event_id":"save","round_key":"R1","match_no":1,"team1_id":"10000000-0000-0000-0000-000000000001","team2_id":"10000000-0000-0000-0000-000000000002","team1_score":3,"team2_score":1,"winner_team_id":"10000000-0000-0000-0000-000000000001","loser_team_id":"10000000-0000-0000-0000-000000000002","status":"completed"}]','[]','{"result":"first"}');
RESET ROLE;
SELECT public.test_assert((SELECT revision=2 FROM yoso_approval_private.revisions WHERE event_id='save'),'identical save advances revision');
SELECT public.test_assert((SELECT payload->>'result'='first' FROM public.results WHERE event_id='save'),'identical save preserves result content');
ROLLBACK TO SAVEPOINT identical_result_replay;
SELECT public.test_assert((SELECT revision=1 FROM yoso_approval_private.revisions WHERE event_id='save'),'replay rollback restores revision');
SET LOCAL ROLE authenticated;
SELECT public.test_reject($q$SELECT public.save_koshien_result_snapshot('save','{}','[]','{}')$q$,'P0001');
SELECT public.test_reject($q$SELECT public.save_koshien_result_snapshot('save','[{"event_id":"foreign","round_key":"R1","match_no":1,"status":"scheduled"}]','[]','{}')$q$,'P0001');
RESET ROLE;
SELECT public.test_assert((SELECT revision=1 FROM yoso_approval_private.revisions WHERE event_id='save'),'invalid payload rolls revision back');
SELECT public.test_assert((SELECT payload->>'result'='first' FROM public.results WHERE event_id='save'),'invalid payload preserves result');
-- Result writes retain their existing deadline semantics (not prediction writes).
UPDATE public.events SET prediction_deadline=now()+interval '1 day' WHERE id='save';
SET LOCAL ROLE authenticated;
SELECT public.save_koshien_result_snapshot('save','[]','[]','{"result":"second"}');
RESET ROLE;
SELECT public.test_assert((SELECT revision=2 FROM yoso_approval_private.revisions WHERE event_id='save'),'save before prediction deadline retains existing behavior');
-- Force a late-stage RLS rejection: helper must not bypass save caller's RLS.
DROP POLICY results_admin ON public.results;
SET LOCAL ROLE authenticated;
SELECT public.test_reject($q$SELECT public.save_koshien_result_snapshot('save','[]','[]','{"result":"blocked"}')$q$,'42501');
RESET ROLE;
SELECT public.test_assert((SELECT revision=2 FROM yoso_approval_private.revisions WHERE event_id='save'),'RLS failure rolls revision back');
SELECT public.test_assert((SELECT payload->>'result'='second' FROM public.results WHERE event_id='save'),'RLS failure preserves result');
UPDATE public.league_members SET membership_status='inactive' WHERE user_id='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.test_reject($q$SELECT yoso_approval_private.begin_result_write('save')$q$,'42501');
RESET ROLE;
SELECT public.test_assert((SELECT revision=2 FROM yoso_approval_private.revisions WHERE event_id='save'),'inactive owner does not advance');
SET LOCAL ROLE anon;
SELECT public.test_reject($q$SELECT yoso_approval_private.begin_result_write('save')$q$,'42501');
RESET ROLE;
SELECT public.test_assert(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.save_koshien_result_snapshot(text,jsonb,jsonb,jsonb)'::regprocedure),'save remains SECURITY INVOKER');
ROLLBACK;
