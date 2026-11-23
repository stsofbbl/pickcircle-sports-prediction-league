-- Disposable test only. This is a PAUSE/RESUME smoke test, NOT a
-- production rollback: old RPCs/triggers remain installed and active.
-- Run only inside the existing BEGIN/ROLLBACK approval integration fixture.
SELECT public.test_assert(
  (SELECT count(*)>0 FROM yoso_approval_private.submissions)
  AND (SELECT count(*)>0 FROM yoso_approval_private.votes),
  'pause test has real submission and vote records');
CREATE TEMP TABLE yoso_pause_baseline ON COMMIT DROP AS
 SELECT
   (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)
     FROM yoso_approval_private.submissions s) AS submissions,
   (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.submission_id,v.voter_user_id),'[]'::jsonb)
     FROM yoso_approval_private.votes v) AS votes;
REVOKE EXECUTE ON FUNCTION public.get_koshien_shared_approval_state(text)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.submit_koshien_shared_results(text,bigint)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.approve_koshien_shared_results(text,uuid,bigint)
  FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.set_koshien_shared_approval_policy(text,text,bigint)
  FROM authenticated;
SELECT public.test_assert(
  NOT pg_catalog.has_function_privilege('authenticated',
     'public.get_koshien_shared_approval_state(text)','EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated',
     'public.submit_koshien_shared_results(text,bigint)','EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated',
     'public.approve_koshien_shared_results(text,uuid,bigint)','EXECUTE')
  AND NOT pg_catalog.has_function_privilege('authenticated',
     'public.set_koshien_shared_approval_policy(text,text,bigint)','EXECUTE'),
  'all four new shared-approval entry points are paused');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.test_reject(
  $q$SELECT public.get_koshien_shared_approval_state('submit-probe')$q$,
  '42501');
SELECT public.test_reject(
  $q$SELECT public.submit_koshien_shared_results('submit-probe',5)$q$,
  '42501');
RESET ROLE;
SELECT public.test_assert(
  (SELECT b.submissions=(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)
      FROM yoso_approval_private.submissions s)
    AND b.votes=(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.submission_id,v.voter_user_id),'[]'::jsonb)
      FROM yoso_approval_private.votes v)
   FROM yoso_pause_baseline b),
  'pausing new RPCs preserves every submission, vote and audit snapshot');
-- Simulate restoring the EXACT four rights removed above, without changing
-- permissions for anon or private table DML.
GRANT EXECUTE ON FUNCTION public.get_koshien_shared_approval_state(text)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_koshien_shared_results(text,bigint)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_koshien_shared_results(text,uuid,bigint)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_koshien_shared_approval_policy(text,text,bigint)
  TO authenticated;
SELECT public.test_assert(
  pg_catalog.has_function_privilege('authenticated',
     'public.get_koshien_shared_approval_state(text)','EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated',
     'public.submit_koshien_shared_results(text,bigint)','EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated',
     'public.approve_koshien_shared_results(text,uuid,bigint)','EXECUTE')
  AND pg_catalog.has_function_privilege('authenticated',
     'public.set_koshien_shared_approval_policy(text,text,bigint)','EXECUTE'),
  'restoring the four entry point rights re-enables client access');
SELECT public.test_assert(
  (SELECT b.submissions=(SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.id),'[]'::jsonb)
      FROM yoso_approval_private.submissions s)
    AND b.votes=(SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.submission_id,v.voter_user_id),'[]'::jsonb)
      FROM yoso_approval_private.votes v)
   FROM yoso_pause_baseline b),
  'pausing and resuming requires no deletion or rewrite of approval records');
