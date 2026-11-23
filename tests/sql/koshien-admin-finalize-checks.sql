SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $test$ BEGIN
  BEGIN
    PERFORM public.finalize_koshien_admin_results('test-finalize',0);
    RAISE EXCEPTION 'non-admin succeeded unexpectedly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $test$ BEGIN
  BEGIN
    UPDATE public.events SET status='finalized' WHERE id='test-finalize';
    RAISE EXCEPTION 'direct finalize succeeded unexpectedly';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
DO $test$ BEGIN
  BEGIN
    PERFORM public.finalize_koshien_admin_results('test-finalize',0);
    RAISE EXCEPTION 'stale version succeeded unexpectedly';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
END $test$;
SELECT public.finalize_koshien_admin_results('test-finalize',
 public.koshien_result_version('test-finalize'));
DO $test$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id='test-finalize'
    AND status='finalized' AND rules->'resultFlow'->>'status'='finalized') THEN
    RAISE EXCEPTION 'finalized status not persisted';
  END IF;
  BEGIN
    UPDATE public.matches SET team1_score=9 WHERE event_id='test-finalize';
    RAISE EXCEPTION 'post-finalization match edit succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.scores SET total_score=9 WHERE event_id='test-finalize';
    RAISE EXCEPTION 'post-finalization score edit succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.results SET payload='{}'::jsonb WHERE event_id='test-finalize';
    RAISE EXCEPTION 'post-finalization result edit succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
RESET ROLE;
DO $test$ BEGIN
  IF EXISTS (SELECT 1 FROM yoso_admin_finalize_private.permits) THEN
    RAISE EXCEPTION 'finalization permit leaked after success';
  END IF;
END $test$;
SELECT 'PASS: no leaked permits';
SELECT 'PASS: admin-only finalization authorization, version, status, guards';
