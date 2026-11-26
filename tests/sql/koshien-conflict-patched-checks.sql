SET LOCAL ROLE authenticated;
SELECT public.test_conflicts('PT409');
RESET ROLE;
DO $test$ BEGIN
 IF EXISTS(SELECT 1 FROM baseline_functions b JOIN pg_proc p ON p.oid=b.oid WHERE to_jsonb(p)-'prosrc' IS DISTINCT FROM b.meta-'prosrc')
 THEN RAISE EXCEPTION 'metadata changed'; END IF;
END $test$;
SELECT 'PASS: all five real conflict branches return PT409, metadata unchanged';
