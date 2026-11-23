-- READ ONLY: capture the exact existing definitions and ACLs BEFORE approval
-- migration/replacement. Store query output securely outside the source repo.
-- This is a SOURCE/ACL SNAPSHOT, not a database backup or an executable rollback.
-- Never assume a past hash is sufficient to restore a function body.
WITH expected_functions(signature) AS (
  VALUES
    ('public.save_koshien_result_snapshot(text,jsonb,jsonb,jsonb)'),
    ('public.reopen_koshien_results(text)'),
    ('public.review_club_join_request(uuid,boolean)'),
    ('public.delete_club(uuid,text)'),
    ('public.set_updated_at()'),
    ('public.protect_jhbf_import_test_event_marker()')
), function_rows AS (
  SELECT
    'function'::text AS object_type,
    x.signature AS identity,
    pg_catalog.pg_get_userbyid(p.proowner) AS object_owner,
    md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_md5,
    pg_catalog.pg_get_functiondef(p.oid) AS original_definition,
    p.proacl::text AS original_acl,
    (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'grantee',CASE WHEN a.grantee=0 THEN 'PUBLIC'
          ELSE pg_catalog.pg_get_userbyid(a.grantee) END,
        'grantor',pg_catalog.pg_get_userbyid(a.grantor),
        'privilege',a.privilege_type,
        'grant_option',a.is_grantable
      ) ORDER BY a.grantee,a.grantor,a.privilege_type),'[]'::jsonb)
      FROM pg_catalog.aclexplode(p.proacl) a
    ) AS acl_details
  FROM expected_functions x
  LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(x.signature)
), trigger_rows AS (
  SELECT
    'trigger'::text AS object_type,
    'public.events.'||x.trigger_name AS identity,
    pg_catalog.pg_get_userbyid(tg.relowner) AS object_owner,
    md5(pg_catalog.pg_get_triggerdef(t.oid)) AS definition_md5,
    pg_catalog.pg_get_triggerdef(t.oid) AS original_definition,
    t.tgenabled::text AS original_acl,
    jsonb_build_object('enabled_state',t.tgenabled) AS acl_details
  FROM (VALUES ('events_set_updated_at'),
               ('protect_jhbf_import_test_event_marker')) x(trigger_name)
  LEFT JOIN pg_catalog.pg_trigger t ON t.tgrelid='public.events'::regclass
    AND t.tgname=x.trigger_name AND NOT t.tgisinternal
  LEFT JOIN pg_catalog.pg_class tg ON tg.oid=t.tgrelid
), all_rows AS (
  SELECT * FROM function_rows
  UNION ALL
  SELECT * FROM trigger_rows
)
SELECT object_type,identity,object_owner,definition_md5,
  original_definition,original_acl,acl_details
FROM all_rows ORDER BY object_type,identity;
