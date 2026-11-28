SET LOCAL ROLE authenticated;
SELECT public.test_conflicts('40001');
RESET ROLE;
DO $test$ BEGIN
 IF EXISTS(SELECT 1 FROM baseline_functions b JOIN pg_proc p ON p.oid=b.oid WHERE to_jsonb(p) IS DISTINCT FROM b.meta)
 OR (SELECT state FROM baseline_data) IS DISTINCT FROM jsonb_build_array((SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.events x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.phase2_drafts x),(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.koshien_later_rounds x),(SELECT count(*) FROM public.phase2_draft_picks),(SELECT count(*) FROM public.final_score_predictions),(SELECT count(*) FROM public.revenge_picks),(SELECT count(*) FROM public.zombie_predictions),(SELECT count(*) FROM public.koshien_later_prediction_requests))
 THEN RAISE EXCEPTION 'rollback mismatch'; END IF;
END $test$;
ROLLBACK;
SELECT 'PASS: rollback restores all original RPCs; fixture business data unchanged';
