SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SELECT public.test_reject($q$UPDATE public.events SET preset_type='other' WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET preset_type='koshien' WHERE id='c'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET league_id='00000000-0000-0000-0000-000000000020' WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET created_by='00000000-0000-0000-0000-000000000003' WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET created_by=NULL WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET id='moved' WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$INSERT INTO public.matches(event_id,round_key,match_no) VALUES('save','R1',1)$q$,'42501');
-- Preserve actual client settings shape and identical identity assignments.
UPDATE public.events SET id=id,preset_type=preset_type,league_id=league_id,created_by=created_by,
 name='Renamed',status='open',prediction_deadline=now()+interval '1 day' WHERE id='save';
UPDATE public.events SET prediction_deadline=now()-interval '1 day' WHERE id='save';
RESET ROLE;
SELECT public.test_assert((SELECT name='Renamed' AND status='open' AND prediction_deadline<now()
 FROM public.events WHERE id='save'),'settings updates remain compatible across deadline');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM yoso_approval_private.revisions WHERE event_id='save'),'identity rejections do not create revision');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM yoso_approval_private.write_permits WHERE event_id='save'),'identity rejections do not issue permit');
SAVEPOINT authorized_writer;
SET LOCAL ROLE authenticated;
SELECT public.save_koshien_result_snapshot('save','[]','[]','{"result":"guarded"}');
SELECT public.test_reject($q$UPDATE public.events SET preset_type='other' WHERE id='save'$q$,'42501');
SELECT public.test_reject($q$UPDATE public.events SET league_id='00000000-0000-0000-0000-000000000020' WHERE id='save'$q$,'42501');
RESET ROLE;
SELECT public.test_assert((SELECT revision=1 FROM yoso_approval_private.revisions WHERE event_id='save'),'authorized save works with identity guard');
SELECT public.test_assert((SELECT payload->>'result'='guarded' FROM public.results WHERE event_id='save'),'result persists with identity guard');
ROLLBACK TO SAVEPOINT authorized_writer;
RESET ROLE;
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.results WHERE event_id='save'),'save rollback remains atomic');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
WITH changed AS (UPDATE public.events SET name='forbidden' WHERE id='save' RETURNING id)
 SELECT public.test_assert((SELECT count(*)=0 FROM changed),'ordinary member still cannot edit settings');
RESET ROLE;
SELECT public.test_reject($q$UPDATE public.events SET preset_type='other' WHERE id='save'$q$,'42501');
SELECT public.test_assert((SELECT preset_type='koshien' AND league_id='00000000-0000-0000-0000-000000000010'
 AND created_by='00000000-0000-0000-0000-000000000001' FROM public.events WHERE id='save'),'all original identity values preserved');
ROLLBACK;
