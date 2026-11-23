-- Production events BEFORE UPDATE triggers, observed in read-only catalog on 2026-11-23.
-- Include them in the disposable transaction to verify name-order coexistence.
ALTER TABLE public.events ADD COLUMN updated_at timestamptz;
ALTER TABLE public.events ADD COLUMN rules_config jsonb;
CREATE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path TO 'public' AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER events_set_updated_at BEFORE UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE FUNCTION public.protect_jhbf_import_test_event_marker() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $fn$
DECLARE v_marker jsonb;
BEGIN
  v_marker := coalesce(OLD.rules->'testHarness',
    OLD.rules->'config'->'testHarness',OLD.rules_config->'testHarness');
  IF OLD.name = '【TEST】高野連結果取込確認'
    AND v_marker->>'kind' = 'jhbf_minimal_import'
    AND OLD.id = 'jhbf-import-test-' || replace(OLD.league_id::text, '-', '') THEN
    NEW.name := OLD.name;
    NEW.league_id := OLD.league_id;
    NEW.preset_type := 'koshien';
    NEW.rules := jsonb_set(coalesce(NEW.rules, '{}'::jsonb),
      '{testHarness}',v_marker,true);
    NEW.rules_config := jsonb_set(coalesce(NEW.rules_config, '{}'::jsonb),
      '{testHarness}',v_marker,true);
  END IF;
  RETURN NEW;
END;
$fn$;
CREATE TRIGGER protect_jhbf_import_test_event_marker BEFORE UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION public.protect_jhbf_import_test_event_marker();
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
-- The existing production test-import marker runs before the approval guard.
INSERT INTO public.events(id,preset_type,league_id,created_by,name,status,rules)
VALUES('jhbf-import-test-00000000000000000000000000000010','koshien',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  '【TEST】高野連結果取込確認','open',
  '{"testHarness":{"kind":"jhbf_minimal_import"},"resultFlow":{"state":"draft"}}');
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
UPDATE public.events SET name='tampered',preset_type='other',
  rules='{"resultFlow":{"state":"draft"}}'
WHERE id='jhbf-import-test-00000000000000000000000000000010';
SELECT public.test_reject(
  $q$UPDATE public.events SET status='finalized'
  WHERE id='jhbf-import-test-00000000000000000000000000000010'$q$,'42501');
RESET ROLE;
SELECT public.test_assert((SELECT name='【TEST】高野連結果取込確認'
  AND preset_type='koshien'
  AND rules->'testHarness'->>'kind'='jhbf_minimal_import'
  AND rules_config->'testHarness'->>'kind'='jhbf_minimal_import'
  AND updated_at IS NOT NULL AND status='open'
  FROM public.events
  WHERE id='jhbf-import-test-00000000000000000000000000000010'),
  'production marker and timestamp triggers coexist with approval guard');
ROLLBACK;
