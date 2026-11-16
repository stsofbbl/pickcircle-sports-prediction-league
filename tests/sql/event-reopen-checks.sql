SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='';
SELECT public.test_reject($q$SELECT public.reopen_koshien_results('done')$q$,'42501');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SELECT public.test_reject($q$SELECT public.reopen_koshien_results('done')$q$,'42501');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SELECT public.test_reject($q$SELECT public.reopen_koshien_results('done')$q$,'42501');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT public.test_reject($q$SELECT public.reopen_koshien_results(NULL)$q$,'22023');
SELECT public.test_reject($q$SELECT public.reopen_koshien_results('missing')$q$,'P0002');
SELECT public.test_reject($q$SELECT public.reopen_koshien_results('save')$q$,'55000');
SELECT public.test_reject($q$INSERT INTO yoso_approval_private.transition_permits(event_id,transaction_id,actor_id) VALUES('done',txid_current(),auth.uid())$q$,'42501');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT public.test_reject($q$SELECT public.reopen_koshien_results('done')$q$,'42501');
RESET ROLE;
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.koshien_result_reopens),'rejected reopen leaves no audit');
SAVEPOINT reopen_success;
SET LOCAL ROLE authenticated;
SELECT public.reopen_koshien_results('done');
RESET ROLE;
SELECT public.test_assert((SELECT status='resultWait' AND rules->'resultFlow'->>'status'='none'
 FROM public.events WHERE id='done'),'authorized reopen resets flow');
SELECT public.test_assert((SELECT revision=1 FROM yoso_approval_private.revisions WHERE event_id='done'),'reopen advances revision');
SELECT public.test_assert((SELECT previous_event->>'status'='finalized' AND reopened_by='00000000-0000-0000-0000-000000000001'
 FROM public.koshien_result_reopens WHERE event_id='done'),'reopen preserves prior event and actor');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM yoso_approval_private.transition_permits),'transition permit consumed');
SET LOCAL ROLE authenticated;
SELECT public.test_reject($q$UPDATE public.events SET status='finalized' WHERE id='done'$q$,'42501');
SELECT public.test_reject($q$SELECT public.reopen_koshien_results('done')$q$,'55000');
RESET ROLE;
ROLLBACK TO SAVEPOINT reopen_success;
RESET ROLE;
SELECT public.test_assert((SELECT status='finalized' FROM public.events WHERE id='done'),'rollback restores finalized event');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.koshien_result_reopens)
 AND NOT EXISTS(SELECT 1 FROM yoso_approval_private.transition_permits)
 AND NOT EXISTS(SELECT 1 FROM yoso_approval_private.revisions WHERE event_id='done'),'rollback restores audit permit and revision');

-- Force a late failure AFTER the approval trigger has consumed the permit.
CREATE FUNCTION public.test_fail_reopen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'late failure' USING ERRCODE='P0001'; END;
$$;
CREATE TRIGGER zz_test_fail_reopen AFTER UPDATE ON public.events
 FOR EACH ROW EXECUTE FUNCTION public.test_fail_reopen();
SET LOCAL ROLE authenticated;
SELECT public.test_reject($q$SELECT public.reopen_koshien_results('done')$q$,'P0001');
RESET ROLE;
DROP TRIGGER zz_test_fail_reopen ON public.events;
SELECT public.test_assert((SELECT status='finalized' FROM public.events WHERE id='done')
 AND NOT EXISTS(SELECT 1 FROM public.koshien_result_reopens)
 AND NOT EXISTS(SELECT 1 FROM yoso_approval_private.revisions WHERE event_id='done')
 AND NOT EXISTS(SELECT 1 FROM yoso_approval_private.transition_permits),'late failure rolls back entire reopen');

-- Trusted fixture writes invalid capabilities to test exact matching.
INSERT INTO yoso_approval_private.transition_permits VALUES
 ('done',txid_current()-1,'00000000-0000-0000-0000-000000000001','finalized','resultWait',
 '{"state":"finalized"}','{"state":"finalized"}');
SET LOCAL ROLE authenticated;
SELECT public.test_reject($q$UPDATE public.events SET status='resultWait' WHERE id='done'$q$,'42501');
RESET ROLE;
UPDATE yoso_approval_private.transition_permits SET transaction_id=txid_current(),actor_id='00000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
SELECT public.test_reject($q$UPDATE public.events SET status='resultWait' WHERE id='done'$q$,'42501');
RESET ROLE;
UPDATE yoso_approval_private.transition_permits SET actor_id='00000000-0000-0000-0000-000000000001',new_status='open';
SET LOCAL ROLE authenticated;
SELECT public.test_reject($q$UPDATE public.events SET status='resultWait' WHERE id='done'$q$,'42501');
RESET ROLE;
UPDATE yoso_approval_private.transition_permits SET new_status='resultWait',new_flow='{}';
SET LOCAL ROLE authenticated;
SELECT public.test_reject($q$UPDATE public.events SET status='resultWait' WHERE id='done'$q$,'42501');
RESET ROLE;
DELETE FROM yoso_approval_private.transition_permits;
SET LOCAL ROLE authenticated;
SELECT public.reopen_koshien_results('done');
RESET ROLE;
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM yoso_approval_private.transition_permits),'successful retry consumes exact permit');
ROLLBACK;
