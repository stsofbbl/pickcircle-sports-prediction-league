-- Read-only release preflight for PR #47. Review every failed row before assembling
-- or applying a migration. No RPC is invoked and no production data is written.
-- Baseline captured from project gubsrwaxpifhvwommpos on 2026-11-23.
-- Definition hashes cover pg_get_functiondef output on the observed DB;
-- baseline now also covers the existing reopen RPC and event-trigger bodies.
-- a changed hash requires review, not automatic replacement.
WITH expected_functions(signature, definition_md5) AS (
  VALUES
    ('public.save_koshien_result_snapshot(text,jsonb,jsonb,jsonb)',
     '6443a7d5501cfda739cadab8a43ea31b'),
    ('public.reopen_koshien_results(text)',
     '5ec4ce9202c5b53dd8b925175f871dec'),
    ('public.review_club_join_request(uuid,boolean)',
     '942f039924ce9678bd6dbca226645fa0'),
    ('public.delete_club(uuid,text)',
     '36d416e67899d02cedbb378b4f28e0f4'),
    -- Both functions implement BEFORE UPDATE triggers that new guards must
    -- coexist with. Trigger-name checks alone cannot detect body drift.
    ('public.set_updated_at()',
     '02092079ad584cbf7c3fd90ac7ab8e3d'),
    ('public.protect_jhbf_import_test_event_marker()',
     '0753345215c3872ddd46f9af36e51b22')
), function_checks AS (
  SELECT e.signature,
    e.definition_md5 AS expected_md5,
    md5(pg_get_functiondef(to_regprocedure(e.signature))) AS actual_md5
  FROM expected_functions e
), new_rpc_checks AS (
  SELECT x.signature, to_regprocedure(x.signature) IS NULL AS absent
  FROM (VALUES
    ('public.get_koshien_shared_approval_state(text)'),
    ('public.submit_koshien_shared_results(text,bigint)'),
    ('public.approve_koshien_shared_results(text,uuid,bigint)'),
    ('public.set_koshien_shared_approval_policy(text,text,bigint)')
  ) AS x(signature)
), existing_event_triggers AS (
  SELECT array_agg(t.tgname ORDER BY t.tgname) AS names
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.events'::regclass AND NOT t.tgisinternal
), checks AS (
  SELECT 'private schema absent' AS item,
    to_regnamespace('yoso_approval_private') IS NULL AS passed
  UNION ALL
  SELECT 'existing function: ' || signature,
    actual_md5 IS NOT DISTINCT FROM expected_md5
  FROM function_checks
  UNION ALL
  SELECT 'new RPC absent: ' || signature, absent FROM new_rpc_checks
  UNION ALL
  SELECT 'existing events trigger set',
    names = ARRAY['events_set_updated_at',
                  'protect_jhbf_import_test_event_marker']::name[]
  FROM existing_event_triggers
  UNION ALL
  SELECT 'required relation: ' || x.relname,
    to_regclass('public.' || x.relname) IS NOT NULL
  FROM (VALUES ('events'),('leagues'),('league_members'),('players'),
               ('teams'),('event_teams'),('matches'),('results'),('scores'))
       AS x(relname)
)
SELECT item,passed FROM checks ORDER BY passed,item;
