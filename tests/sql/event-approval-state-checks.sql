SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT public.test_reject($q$UPDATE public.events SET name='must rollback',status='finalized' WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET status='resultWait' WHERE id='done'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET status=NULL WHERE id='done'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET rules=jsonb_set(rules,'{resultFlow,state}','"finalized"') WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET rules=rules-'resultFlow' WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET rules='{}' WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET rules=NULL WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET rules='{"resultFlow":null}' WHERE id='save'$q$,'42501');
-- A spoofable session flag must not bypass the gate.
SET LOCAL yoso.approval_transition='true';
SELECT public.test_reject($q$UPDATE public.events SET status='finalized' WHERE id='save'$q$,'42501');
RESET ROLE;
SELECT public.test_assert((SELECT name='Original' AND status='open' AND rules->'resultFlow'->>'state'='draft'
 FROM public.events WHERE id='save'),'failed state update preserves all fields');
SET LOCAL ROLE authenticated;
-- Existing client settings shape; non-final states and unchanged flow are allowed.
UPDATE public.events SET name='Renamed',status='resultWait',
 prediction_deadline=now()+interval '1 day',rules=rules WHERE id='save';
UPDATE public.events SET prediction_deadline=now()-interval '1 day' WHERE id='save';
UPDATE public.events SET name='Archived name',status='finalized',rules=rules WHERE id='done';
SELECT public.save_koshien_result_snapshot('save','[]','[]','{"result":"saved"}');
SELECT public.test_reject($q$UPDATE public.events SET status='finalized' WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET rules='{"resultFlow":{}}' WHERE id='save'$q$,'42501');
RESET ROLE;
SELECT public.test_assert((SELECT revision=1 FROM yoso_approval_private.revisions WHERE event_id='save'),'writer permit does not grant approval permission');
SELECT public.test_assert((SELECT payload->>'result'='saved' FROM public.results WHERE event_id='save'),'result RPC still saves');
SELECT public.test_assert((SELECT name='Renamed' AND status='resultWait' AND prediction_deadline<now()
 FROM public.events WHERE id='save'),'normal settings remain compatible across deadline');
SELECT public.test_assert((SELECT name='Archived name' AND status='finalized' FROM public.events WHERE id='done'),'unchanged finalized state permits rename');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
WITH changed AS (UPDATE public.events SET name='forbidden' WHERE id='save' RETURNING id)
 SELECT public.test_assert((SELECT count(*)=0 FROM changed),'ordinary member remains blocked by RLS');
RESET ROLE;
SELECT public.test_reject($q$UPDATE public.events SET status='resultWait' WHERE id='done'$q$,'42501');
ROLLBACK;
