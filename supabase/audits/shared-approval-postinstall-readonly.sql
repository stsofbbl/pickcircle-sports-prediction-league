-- READ ONLY: evaluate after all shared-approval SQL is installed.
-- Prototype release gate, not a migration and not a rollback script.
-- The queries remain safe on an unmodified database (failed checks return false).
WITH api_functions(signature) AS (
  VALUES ('public.get_koshien_shared_approval_state(text)'),
         ('public.submit_koshien_shared_results(text,bigint)'),
         ('public.approve_koshien_shared_results(text,uuid,bigint)'),
         ('public.set_koshien_shared_approval_policy(text,text,bigint)')
), api_details AS (
  SELECT f.signature,p.oid,p.prosecdef
  FROM api_functions f LEFT JOIN pg_catalog.pg_proc p
    ON p.oid=pg_catalog.to_regprocedure(f.signature)
), private_function_specs(signature,expected_definer,allow_auth) AS (
  -- Existing public save_koshien_result_snapshot is SECURITY INVOKER and
  -- must reach only this guarded SECURITY DEFINER entry.
  VALUES
    ('yoso_approval_private.begin_result_write(text)',true,true),
    ('yoso_approval_private.lock_revision(text)',false,false),
    ('yoso_approval_private.advance_revision(text,bigint)',false,false),
    ('yoso_approval_private.issue_write_permit(text)',false,false)
), private_function_details AS (
  SELECT x.signature,x.expected_definer,x.allow_auth,p.oid,p.prosecdef
  FROM private_function_specs x LEFT JOIN pg_catalog.pg_proc p
    ON p.oid=pg_catalog.to_regprocedure(x.signature)
), private_tables(name,rls_required) AS (
  VALUES ('revisions',false),('write_permits',true),
         ('transition_permits',true),('submissions',true),('votes',true)
), private_details AS (
  SELECT t.name,t.rls_required,c.oid,c.relrowsecurity
  FROM private_tables t LEFT JOIN pg_catalog.pg_class c
    ON c.oid=pg_catalog.to_regclass('yoso_approval_private.'||t.name)
), expected_triggers(tablename,triggername) AS (
  VALUES
    ('events','protect_koshien_event_identity'),
    ('events','protect_koshien_approval_state'),
    ('events','yoso_protect_shared_approval_event_status'),
    ('teams','yoso_protect_koshien_team_configuration'),
    ('event_teams','yoso_protect_koshien_event_team_configuration'),
    ('matches','require_result_write_permit'),
    ('results','require_result_write_permit'),
    ('scores','require_result_write_permit')
), checks(item,passed) AS (
  SELECT 'private schema exists',
    pg_catalog.to_regnamespace('yoso_approval_private') IS NOT NULL
  UNION ALL
  SELECT 'private schema denies anon USAGE',
    CASE WHEN pg_catalog.to_regnamespace('yoso_approval_private') IS NULL
      THEN false
      ELSE NOT pg_catalog.has_schema_privilege('anon','yoso_approval_private','USAGE')
    END
  UNION ALL
  SELECT 'private schema allows authenticated USAGE',
    CASE WHEN pg_catalog.to_regnamespace('yoso_approval_private') IS NULL
      THEN false
      ELSE pg_catalog.has_schema_privilege('authenticated','yoso_approval_private','USAGE')
    END
  UNION ALL
  SELECT 'RPC exists: '||signature,oid IS NOT NULL
  FROM api_details
  UNION ALL
  SELECT 'RPC is SECURITY DEFINER: '||signature,coalesce(prosecdef,false)
  FROM api_details
  UNION ALL
  SELECT 'RPC denies anon EXECUTE: '||signature,
    coalesce(NOT pg_catalog.has_function_privilege('anon',oid,'EXECUTE'),false)
  FROM api_details
  UNION ALL
  SELECT 'RPC allows authenticated EXECUTE: '||signature,
    coalesce(pg_catalog.has_function_privilege('authenticated',oid,'EXECUTE'),false)
  FROM api_details
  UNION ALL
  SELECT 'private helper exists: '||signature,oid IS NOT NULL
  FROM private_function_details
  UNION ALL
  SELECT 'private helper definer mode: '||signature,
    coalesce(prosecdef=expected_definer,false)
  FROM private_function_details
  UNION ALL
  SELECT 'private helper denies anon EXECUTE: '||signature,
    coalesce(NOT pg_catalog.has_function_privilege('anon',oid,'EXECUTE'),false)
  FROM private_function_details
  UNION ALL
  SELECT 'private helper authenticated EXECUTE: '||signature,
    coalesce(pg_catalog.has_function_privilege('authenticated',oid,'EXECUTE')
      =allow_auth,false)
  FROM private_function_details
  UNION ALL
  SELECT 'private table exists: '||name,oid IS NOT NULL
  FROM private_details
  UNION ALL
  SELECT 'private RLS: '||name,
    coalesce(relrowsecurity,false)
  FROM private_details WHERE rls_required
  UNION ALL
  SELECT 'private table denies client DML: '||t.name,
    coalesce(
      NOT pg_catalog.has_table_privilege('anon',t.oid,'SELECT')
      AND NOT pg_catalog.has_table_privilege('anon',t.oid,'INSERT')
      AND NOT pg_catalog.has_table_privilege('anon',t.oid,'UPDATE')
      AND NOT pg_catalog.has_table_privilege('anon',t.oid,'DELETE')
      AND NOT pg_catalog.has_table_privilege('authenticated',t.oid,'SELECT')
      AND NOT pg_catalog.has_table_privilege('authenticated',t.oid,'INSERT')
      AND NOT pg_catalog.has_table_privilege('authenticated',t.oid,'UPDATE')
      AND NOT pg_catalog.has_table_privilege('authenticated',t.oid,'DELETE'),false)
  FROM private_details t
  UNION ALL
  SELECT 'private table denies client TRUNCATE: '||t.name,
    coalesce(
      NOT pg_catalog.has_table_privilege('anon',t.oid,'TRUNCATE')
      AND NOT pg_catalog.has_table_privilege('authenticated',t.oid,'TRUNCATE'),false)
  FROM private_details t
  UNION ALL
  SELECT 'trigger enabled: '||x.tablename||'.'||x.triggername,
    EXISTS(SELECT 1 FROM pg_catalog.pg_trigger tg
      WHERE tg.tgrelid=pg_catalog.to_regclass('public.'||x.tablename)
        AND tg.tgname=x.triggername AND NOT tg.tgisinternal
        AND tg.tgenabled IN ('O','A'))
  FROM expected_triggers x
)
SELECT item,coalesce(passed,false) AS passed FROM checks ORDER BY passed,item;
