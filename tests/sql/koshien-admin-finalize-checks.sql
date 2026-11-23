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
-- The selected admin-only mode is mandatory; the other modes cannot be
-- silently finalized through this one-person RPC.
UPDATE public.events SET rules=jsonb_set(rules,'{approvalPolicy}','"half"')
 WHERE id='test-finalize';
DO $test$ BEGIN
  BEGIN
    PERFORM public.finalize_koshien_admin_results('test-finalize',
      public.koshien_result_version('test-finalize'));
    RAISE EXCEPTION 'half-policy finalized unexpectedly';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $test$;
UPDATE public.events SET rules=jsonb_set(rules,'{approvalPolicy}','"admin"')
 WHERE id='test-finalize';
RESET ROLE;
DELETE FROM public.scores WHERE event_id='test-finalize';
SET ROLE authenticated;
DO $test$ BEGIN
  BEGIN
    PERFORM public.finalize_koshien_admin_results('test-finalize',
      public.koshien_result_version('test-finalize'));
    RAISE EXCEPTION 'missing active score accepted unexpectedly';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $test$;
RESET ROLE;
INSERT INTO public.scores VALUES(
 'test-finalize','00000000-0000-0000-0000-000000000011',30);
UPDATE public.matches SET status='scheduled'
 WHERE event_id='test-finalize' AND round_key='F';
SET ROLE authenticated;
DO $test$ BEGIN
  BEGIN
    PERFORM public.finalize_koshien_admin_results('test-finalize',
      public.koshien_result_version('test-finalize'));
    RAISE EXCEPTION 'incomplete match accepted unexpectedly';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $test$;
RESET ROLE;
UPDATE public.matches SET status='completed'
 WHERE event_id='test-finalize' AND round_key='F';
SET ROLE authenticated;
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
  BEGIN
    UPDATE public.events SET
      rules=jsonb_set(rules,'{resultFlow,finalizedAt}','"tampered"')
      WHERE id='test-finalize';
    RAISE EXCEPTION 'post-finalization approval metadata tampered';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.teams SET event_id='test-finalize' WHERE event_id='test-finalize';
    RAISE EXCEPTION 'post-finalization representative edit succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.event_teams SET event_id='test-finalize'
      WHERE event_id='test-finalize';
    RAISE EXCEPTION 'post-finalization event-team edit succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
UPDATE public.events SET status='archive' WHERE id='test-finalize';
DO $test$ BEGIN
  BEGIN
    UPDATE public.matches SET team1_score=9 WHERE event_id='test-finalize';
    RAISE EXCEPTION 'archived finalized event could be rewritten';
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
