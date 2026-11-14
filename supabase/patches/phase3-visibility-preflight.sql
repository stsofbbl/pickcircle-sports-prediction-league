-- Read-only preflight. All columns must be true before applying the migration.
-- Recheck policy definitions if any result is false; do not automatically repair history.
SELECT
 (SELECT count(*)=4 AND bool_and(relrowsecurity) FROM pg_class
  WHERE relnamespace='public'::regnamespace AND relname IN
  ('events','players','koshien_later_rounds','final_score_predictions')) AS rls_enabled,
 (SELECT count(*)=2 AND bool_and(NOT rolsuper AND NOT rolbypassrls)
  FROM pg_roles WHERE rolname IN ('authenticated','anon')) AS application_roles_enforce_rls,
 (SELECT count(*)=2 FROM pg_policies WHERE schemaname='public'
  AND tablename='final_score_predictions') AS expected_policy_count,
 EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
  AND tablename='final_score_predictions'
  AND policyname='final_score_predictions_select_owner_or_public'
  AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[]
  AND qual LIKE '%is_prediction_public(event_id)%') AS expected_old_select_policy,
 NOT (has_table_privilege('authenticated','public.final_score_predictions','INSERT')
 OR has_table_privilege('authenticated','public.final_score_predictions','UPDATE')
 OR has_table_privilege('authenticated','public.final_score_predictions','DELETE')) AS no_direct_prediction_writes;
