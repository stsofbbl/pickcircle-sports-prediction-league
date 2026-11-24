-- The revision must distinguish subsecond match edits and score-only changes.
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $revision$ DECLARE v_before text;
BEGIN
  v_before := public.koshien_admin_result_revision('test-finalize');
  UPDATE public.matches SET updated_at=updated_at+interval '100 milliseconds'
    WHERE event_id='test-finalize' AND round_key='F';
  IF public.koshien_admin_result_revision('test-finalize') = v_before THEN
    RAISE EXCEPTION 'subsecond match update did not change revision';
  END IF;
  UPDATE public.matches SET updated_at=updated_at-interval '100 milliseconds'
    WHERE event_id='test-finalize' AND round_key='F';
  IF public.koshien_admin_result_revision('test-finalize') <> v_before THEN
    RAISE EXCEPTION 'match restoration did not restore revision';
  END IF;
  UPDATE public.scores SET total_score=total_score+1 WHERE event_id='test-finalize';
  IF public.koshien_admin_result_revision('test-finalize') = v_before THEN
    RAISE EXCEPTION 'score-only change did not change revision';
  END IF;
  BEGIN
    PERFORM public.finalize_koshien_admin_results('test-finalize',v_before);
    RAISE EXCEPTION 'stale reviewed scoreboard finalized';
  EXCEPTION WHEN serialization_failure THEN NULL; END;
  UPDATE public.scores SET total_score=total_score-1 WHERE event_id='test-finalize';
  IF public.koshien_admin_result_revision('test-finalize') <> v_before THEN
    RAISE EXCEPTION 'score restoration did not restore revision';
  END IF;
END $revision$;
RESET ROLE;
SELECT 'PASS: score-only and subsecond changes reject stale finalization';

SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $test$ BEGIN
  BEGIN
    PERFORM public.finalize_koshien_admin_results('test-finalize','00000000000000000000000000000000');
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
    PERFORM public.finalize_koshien_admin_results('test-finalize','00000000000000000000000000000000');
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
      public.koshien_admin_result_revision('test-finalize'));
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
      public.koshien_admin_result_revision('test-finalize'));
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
      public.koshien_admin_result_revision('test-finalize'));
    RAISE EXCEPTION 'incomplete match accepted unexpectedly';
  EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $test$;
RESET ROLE;
UPDATE public.matches SET status='completed'
 WHERE event_id='test-finalize' AND round_key='F';
SET ROLE authenticated;
SELECT public.finalize_koshien_admin_results('test-finalize',
 public.koshien_admin_result_revision('test-finalize'));
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
-- Reproduce the browser's archive UPDATE in the disposable database.
RESET ROLE;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $archive_member$ DECLARE v_rows integer;
BEGIN
  UPDATE public.events SET status='archive', archived_at=now()
    WHERE id='test-finalize' AND preset_type='koshien'
      AND status='finalized' AND archived_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'non-admin archived a finalized event';
  END IF;
END $archive_member$;
RESET ROLE;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
BEGIN;
UPDATE public.events SET status='archive', archived_at=now()
  WHERE id='test-finalize' AND preset_type='koshien'
    AND status='finalized' AND archived_at IS NULL;
DO $archive_rollback$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id='test-finalize'
    AND status='archive' AND archived_at IS NOT NULL) THEN
    RAISE EXCEPTION 'archive transaction did not update both fields';
  END IF;
END $archive_rollback$;
ROLLBACK;
DO $archive_rollback$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events WHERE id='test-finalize'
    AND status='finalized' AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'archive rollback did not restore both fields';
  END IF;
END $archive_rollback$;
DO $archive_admin$ DECLARE
  v_rows integer;
  v_rules jsonb;
  v_matches text;
  v_scores text;
  v_results text;
BEGIN
  SELECT rules INTO v_rules FROM public.events WHERE id='test-finalize';
  SELECT md5(coalesce(string_agg(to_jsonb(m)::text,'|' ORDER BY m.id::text),''))
    INTO v_matches FROM public.matches m WHERE event_id='test-finalize';
  SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'|' ORDER BY s.player_id::text),''))
    INTO v_scores FROM public.scores s WHERE event_id='test-finalize';
  SELECT md5(coalesce(string_agg(to_jsonb(r)::text,'|' ORDER BY r.event_id),''))
    INTO v_results FROM public.results r WHERE event_id='test-finalize';
  UPDATE public.events SET status='archive', archived_at=now()
    WHERE id='test-finalize' AND preset_type='koshien'
      AND status='finalized' AND archived_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 OR NOT EXISTS (SELECT 1 FROM public.events
    WHERE id='test-finalize' AND status='archive'
      AND archived_at IS NOT NULL AND rules=v_rules) THEN
    RAISE EXCEPTION 'admin archive did not persist expected fields';
  END IF;
  UPDATE public.events SET status='archive', archived_at=now()
    WHERE id='test-finalize' AND preset_type='koshien'
      AND status='finalized' AND archived_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'stale archive precondition did not reject duplicate';
  END IF;
  DELETE FROM public.events WHERE id='test-finalize';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'archived finalized event was deleted by authenticated admin';
  END IF;
  IF v_matches IS DISTINCT FROM (SELECT md5(coalesce(string_agg(to_jsonb(m)::text,'|' ORDER BY m.id::text),''))
    FROM public.matches m WHERE event_id='test-finalize')
    OR v_scores IS DISTINCT FROM (SELECT md5(coalesce(string_agg(to_jsonb(s)::text,'|' ORDER BY s.player_id::text),''))
      FROM public.scores s WHERE event_id='test-finalize')
    OR v_results IS DISTINCT FROM (SELECT md5(coalesce(string_agg(to_jsonb(r)::text,'|' ORDER BY r.event_id),''))
      FROM public.results r WHERE event_id='test-finalize') THEN
    RAISE EXCEPTION 'archive modified matches, scores or results';
  END IF;
END $archive_admin$;
SELECT 'PASS: archive RLS, status, archived_at, rollback, duplicate, child data';

DO $test$ BEGIN
  BEGIN
    UPDATE public.matches SET team1_score=9 WHERE event_id='test-finalize';
    RAISE EXCEPTION 'archived finalized event could be rewritten';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
DO $test$ BEGIN
  BEGIN
    UPDATE public.events SET status='resultWait',
      rules=jsonb_set(rules,'{resultFlow,status}','"none"')
      WHERE id='test-finalize';
    RAISE EXCEPTION 'unaudited direct reopen succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    UPDATE public.events SET
      rules=jsonb_set(rules,'{config}','{"scoreMultiplier":100}')
      WHERE id='test-finalize';
    RAISE EXCEPTION 'finalized scoring configuration was changed';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO public.koshien_result_reopens(event_id,previous_event,reopened_by)
    SELECT id,to_jsonb(e),'00000000-0000-0000-0000-000000000001'::uuid
    FROM public.events e WHERE id='test-finalize';
    RAISE EXCEPTION 'authenticated user forged a reopen audit';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $test$;
-- An archived result cannot be reopened by a non-admin. No audit row is written.
RESET ROLE;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $archive_reopen_member$ BEGIN
  BEGIN
    PERFORM public.reopen_koshien_results('test-finalize');
    RAISE EXCEPTION 'non-admin reopened archived results';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  IF EXISTS (SELECT 1 FROM public.koshien_result_reopens
      WHERE event_id='test-finalize') THEN
    RAISE EXCEPTION 'denied archived reopen wrote an audit row';
  END IF;
END $archive_reopen_member$;
RESET ROLE;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.reopen_koshien_results('test-finalize');
DO $test$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.events
    WHERE id='test-finalize' AND status='resultWait'
      AND archived_at IS NULL
      AND rules->'resultFlow'->>'status'='none') THEN
    RAISE EXCEPTION 'official reopen failed';
  END IF;
  IF (SELECT count(*) FROM public.koshien_result_reopens
      WHERE event_id='test-finalize') <> 1 THEN
    RAISE EXCEPTION 'official reopen did not record exactly one audit';
  END IF;
  IF (SELECT count(*) FROM public.matches
      WHERE event_id='test-finalize' AND status='completed') <> 48 THEN
    RAISE EXCEPTION 'reopen unexpectedly changed official matches';
  END IF;
END $test$;
UPDATE public.matches SET team1_score=3 WHERE event_id='test-finalize' AND round_key='F';
DO $test$ BEGIN
  IF (SELECT team1_score FROM public.matches
      WHERE event_id='test-finalize' AND round_key='F') <> 3 THEN
    RAISE EXCEPTION 'edits did not resume after audited reopen';
  END IF;
  BEGIN
    PERFORM public.reopen_koshien_results('test-finalize');
    RAISE EXCEPTION 'second reopen unexpectedly succeeded';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL; END;
END $test$;
RESET ROLE;
SELECT 'PASS: direct reopen blocked, audited reopen works, editing resumes';

DO $test$ BEGIN
  IF EXISTS (SELECT 1 FROM yoso_admin_finalize_private.permits) THEN
    RAISE EXCEPTION 'finalization permit leaked after success';
  END IF;
END $test$;
SELECT 'PASS: no leaked permits';
SELECT 'PASS: admin-only finalization authorization, version, status, guards';

-- #53: Verify real authenticated delete RLS without touching real events.
-- Direct deletion must be denied even for the owner of finalized Koshien.
SET ROLE authenticated;
SELECT public.finalize_koshien_admin_results('test-finalize',
 public.koshien_admin_result_revision('test-finalize'));
DO $finalized_delete$ DECLARE v_rows integer;
BEGIN
  DELETE FROM public.events WHERE id='test-finalize';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 OR NOT EXISTS (SELECT 1 FROM public.events
      WHERE id='test-finalize' AND status='finalized') THEN
    RAISE EXCEPTION 'owner directly deleted finalized Koshien';
  END IF;
  IF (SELECT count(*) FROM public.matches WHERE event_id='test-finalize') <> 48
     OR (SELECT count(*) FROM public.scores WHERE event_id='test-finalize') <> 1
     OR (SELECT count(*) FROM public.results WHERE event_id='test-finalize') <> 1
     OR (SELECT count(*) FROM public.koshien_result_reopens
         WHERE event_id='test-finalize') <> 1 THEN
    RAISE EXCEPTION 'denied direct deletion modified child or audit rows';
  END IF;
END $finalized_delete$;
-- The finalized status and the finalized flow status both protect archived rows.
BEGIN;
UPDATE public.events SET status='archive',archived_at=now()
 WHERE id='test-finalize' AND status='finalized';
DO $archive_delete$ DECLARE v_rows integer;
BEGIN
  DELETE FROM public.events WHERE id='test-finalize';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'owner directly deleted archived finalized Koshien';
  END IF;
END $archive_delete$;
ROLLBACK;

-- Other sports and unfinished Koshien retain their prior admin-delete behavior.
RESET ROLE;
INSERT INTO public.events(id,league_id,preset_type,status,rules) VALUES
 ('test-unfinished','00000000-0000-0000-0000-000000000010','koshien',
    'resultWait','{"resultFlow":{"status":"none"}}'),
 ('test-other-sport','00000000-0000-0000-0000-000000000010','worldCup',
    'finalized','{"resultFlow":{"status":"finalized"}}');
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $member_delete$ DECLARE v_rows integer;
BEGIN
  DELETE FROM public.events WHERE id='test-unfinished';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN RAISE EXCEPTION 'member deleted unfinished Koshien'; END IF;
END $member_delete$;
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $admin_delete$ DECLARE v_rows integer;
BEGIN
  DELETE FROM public.events WHERE id IN ('test-unfinished','test-other-sport');
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'existing unfinished/other-sport delete behavior changed';
  END IF;
END $admin_delete$;
RESET ROLE;
SELECT 'PASS: finalized/archived delete denied, unfinished/other sport preserved';

-- A legitimate club-deletion security-definer must still be able to cascade.
CREATE FUNCTION public.fixture_delete_club(p_league_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $club$
BEGIN
  IF NOT public.is_league_admin(p_league_id) THEN
    RAISE EXCEPTION 'owner permission required' USING ERRCODE='42501';
  END IF;
  DELETE FROM public.leagues WHERE id=p_league_id;
END
$club$;
GRANT EXECUTE ON FUNCTION public.fixture_delete_club(uuid) TO authenticated;
SET ROLE authenticated;
SELECT public.fixture_delete_club('00000000-0000-0000-0000-000000000010');
RESET ROLE;
DO $cascade$ BEGIN
  IF EXISTS (SELECT 1 FROM public.events WHERE id='test-finalize')
     OR EXISTS (SELECT 1 FROM public.matches WHERE event_id='test-finalize')
     OR EXISTS (SELECT 1 FROM public.scores WHERE event_id='test-finalize')
     OR EXISTS (SELECT 1 FROM public.results WHERE event_id='test-finalize')
     OR EXISTS (SELECT 1 FROM public.teams WHERE event_id='test-finalize')
     OR EXISTS (SELECT 1 FROM public.event_teams WHERE event_id='test-finalize')
     OR EXISTS (SELECT 1 FROM public.koshien_result_reopens WHERE event_id='test-finalize')
  THEN RAISE EXCEPTION 'authorized security-definer club cascade left child rows'; END IF;
END $cascade$;
SELECT 'PASS: owner-managed club deletion retains FK cascade after RLS hardening';
