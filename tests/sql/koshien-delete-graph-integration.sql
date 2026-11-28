-- Run only against disposable graph DB, with synthetic rows.
BEGIN;
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f')<>70 THEN RAISE EXCEPTION 'production FK graph incomplete'; END IF;
END $$;
CREATE FUNCTION public.fixture_graph_snapshot() RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE t text; v jsonb; result jsonb:='{}';
BEGIN
 FOREACH t IN ARRAY ARRAY['event_teams','events','external_match_imports','external_result_fetches','external_team_aliases','final_score_predictions','koshien_automation_state','koshien_later_prediction_requests','koshien_later_rounds','koshien_result_cancellations','koshien_result_reopens','koshien_revenge_eligibility','koshien_zombie_eligibility','league_admin_audit','league_join_requests','league_members','leagues','matches','phase1_picks','phase2_draft_picks','phase2_drafts','players','predictions','profiles','results','revenge_picks','scores','teams','zombie_predictions'] LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY to_jsonb(x)::text),''[]''::jsonb) FROM public.%I x',t) INTO v;
  -- Ignore candidate-generated columns when comparing original business rows.
  IF t='external_match_imports' THEN
   SELECT coalesce(jsonb_agg(x-'import_year'-'import_preset' ORDER BY (x-'import_year'-'import_preset')::text),'[]'::jsonb) INTO v FROM jsonb_array_elements(v) x;
  END IF;
  result:=result||jsonb_build_object(t,v);
 END LOOP;
 RETURN result;
END $$;
CREATE TEMP TABLE graph_baseline AS SELECT public.fixture_graph_snapshot() AS snapshot;
CREATE TEMP TABLE graph_outcomes(stage text PRIMARY KEY, outcome text NOT NULL, details text NOT NULL);
GRANT SELECT,INSERT ON graph_outcomes TO authenticated;
-- Capture the actual existing behavior; rollback even if delete succeeds.
CREATE FUNCTION public.fixture_probe_delete(p_stage text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_state text; v_constraint text; v_message text;
BEGIN
 BEGIN
  PERFORM public.delete_club('00000000-0000-0000-0001-000000000017','leagues-name-1');
  RAISE EXCEPTION USING ERRCODE='P9001',MESSAGE='rollback successful cascade';
 EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_state=RETURNED_SQLSTATE,v_constraint=CONSTRAINT_NAME,v_message=MESSAGE_TEXT;
  IF v_state='P9001' THEN INSERT INTO pg_temp.graph_outcomes VALUES(p_stage,'deleted','');
  ELSE INSERT INTO pg_temp.graph_outcomes VALUES(p_stage,v_state,coalesce(v_constraint,'')||':'||v_message); END IF;
 END;
END $$;
GRANT EXECUTE ON FUNCTION public.fixture_probe_delete(text) TO authenticated;
SET request.jwt.claim.sub='00000000-0000-0000-0002-000000000024';
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.delete_club('00000000-0000-0000-0001-000000000017','leagues-name-1');
  RAISE EXCEPTION 'other club owner deleted target';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0001-000000000024';
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.delete_club('00000000-0000-0000-0001-000000000017','wrong name');
  RAISE EXCEPTION 'wrong confirmation accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $$;
SELECT public.fixture_probe_delete('baseline');
RESET ROLE;
DO $$ BEGIN
 IF public.fixture_graph_snapshot() IS DISTINCT FROM (SELECT snapshot FROM graph_baseline) THEN RAISE EXCEPTION 'baseline probe mutated rows'; END IF;
END $$;
-- @include supabase/release-candidates/koshien-official-integrity/import-identity.sql
SET ROLE authenticated;
SELECT public.fixture_probe_delete('candidate');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT outcome FROM graph_outcomes WHERE stage='candidate') IS DISTINCT FROM (SELECT outcome FROM graph_outcomes WHERE stage='baseline') OR
    (SELECT details FROM graph_outcomes WHERE stage='candidate') IS DISTINCT FROM (SELECT details FROM graph_outcomes WHERE stage='baseline') THEN
  RAISE EXCEPTION 'candidate changed club deletion behavior: %',(SELECT jsonb_agg(to_jsonb(o)) FROM graph_outcomes o);
 END IF;
 IF public.fixture_graph_snapshot() IS DISTINCT FROM (SELECT snapshot FROM graph_baseline) THEN RAISE EXCEPTION 'candidate probe mutated rows'; END IF;
END $$;
SELECT * FROM graph_outcomes ORDER BY stage;
-- When the production graph permits the cascade, check all 29 tables and
-- preserve the other club's rows and both profiles. If the existing graph
-- rejects the deletion, report that baseline limitation; do not weaken FK.
DO $$ DECLARE t text; v jsonb; before_rows jsonb; after_rows jsonb;
BEGIN
 IF (SELECT outcome FROM graph_outcomes WHERE stage='baseline')='deleted' THEN
  PERFORM public.delete_club('00000000-0000-0000-0001-000000000017','leagues-name-1');
  v:=public.fixture_graph_snapshot();
  FOREACH t IN ARRAY ARRAY['event_teams','events','external_match_imports','external_result_fetches','external_team_aliases','final_score_predictions','koshien_automation_state','koshien_later_prediction_requests','koshien_later_rounds','koshien_result_cancellations','koshien_result_reopens','koshien_revenge_eligibility','koshien_zombie_eligibility','league_admin_audit','league_join_requests','league_members','leagues','matches','phase1_picks','phase2_draft_picks','phase2_drafts','players','predictions','profiles','results','revenge_picks','scores','teams','zombie_predictions'] LOOP
   before_rows:=(SELECT snapshot->t FROM graph_baseline);
   after_rows:=v->t;
   IF t='profiles' THEN
    IF before_rows IS DISTINCT FROM after_rows THEN RAISE EXCEPTION 'profiles changed'; END IF;
   ELSE
    IF jsonb_array_length(after_rows)<>1 OR NOT (before_rows @> after_rows) THEN
     RAISE EXCEPTION 'club cascade did not retain exactly the other row: %',t;
    END IF;
   END IF;
  END LOOP;
  RAISE NOTICE 'PASS: candidate cascade removes only selected club across all graph tables';
 ELSE
  RAISE NOTICE 'BASELINE BLOCKER: actual FK graph refuses club deletion; candidate preserves same rejection';
 END IF;
END $$;
ROLLBACK;
SELECT 'PASS: 70-FK production graph baseline/candidate parity, owner/name authorization, transaction isolation';
