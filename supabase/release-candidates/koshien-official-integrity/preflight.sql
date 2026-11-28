-- Read-only release preflight. Run against production only with read access.
-- A passing result is necessary, not sufficient, for an approved release.
-- Re-run immediately before deployment; never repair mismatches automatically.
BEGIN READ ONLY;
SET LOCAL search_path=public,pg_catalog;
WITH
fk AS (
 SELECT count(*) AS n,
  md5(string_agg(conrelid::regclass::text||':'||conname||':'||pg_get_constraintdef(oid),
   E'\n' ORDER BY conrelid::regclass::text,conname)) AS fingerprint
 FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace
),
expected_rpc(name,hash,definer,auth_execute) AS (
 VALUES
 ('sync_koshien_official_schedule','f4d88cf0af5dc2ad05dbe9a4112e5c7a',false,true),
 ('auto_sync_koshien_official_schedule','83e20d3234af222b63d747cf34230346',true,false),
 ('auto_sync_koshien_late_schedule','068de18f22a1195cdca346daf5bbf4f5',true,false)
),
rpc_drift AS (
 SELECT count(*) AS n FROM expected_rpc x
 LEFT JOIN pg_proc p ON p.oid=to_regprocedure('public.'||x.name||'(text,jsonb,text,timestamptz)')
 WHERE p.oid IS NULL OR md5(p.prosrc) IS DISTINCT FROM x.hash
 OR p.prosecdef IS DISTINCT FROM x.definer
 OR has_function_privilege('authenticated',p.oid,'EXECUTE') IS DISTINCT FROM x.auth_execute
 OR has_function_privilege('anon',p.oid,'EXECUTE') IS DISTINCT FROM false
 OR has_function_privilege('service_role',p.oid,'EXECUTE') IS DISTINCT FROM true
),
import_bad AS (
 SELECT count(*) AS n FROM public.external_match_imports i
 LEFT JOIN public.events e ON e.id=i.event_id
 LEFT JOIN public.matches m ON m.id=i.imported_match_id
 WHERE e.id IS NULL OR m.id IS NULL OR m.event_id IS DISTINCT FROM i.event_id
 OR e.preset_type IS DISTINCT FROM 'koshien'
 OR e.season IS DISTINCT FROM split_part(i.external_key,':',3)
 OR NOT coalesce(split_part(i.external_key,':',3) ~ '^(202[0-9]|203[0-5])$',false)
 OR split_part(i.external_key,':',2) IS DISTINCT FROM 'summer'
 OR split_part(i.external_key,':',3) IS DISTINCT FROM left(split_part(i.external_key,':',4),4)
 OR i.normalized_payload->>'source' IS DISTINCT FROM i.source
 OR i.normalized_payload->>'externalKey' IS DISTINCT FROM i.external_key
 OR NOT coalesce(i.source_url IN (
  'https://www.jhbf.or.jp/sensyuken/'||e.season||'/schedule/schedule_'||replace(split_part(i.external_key,':',4),'-','')||'.html',
  'https://jhbf.or.jp/sensyuken/'||e.season||'/schedule/schedule_'||replace(split_part(i.external_key,':',4),'-','')||'.html'
 ),false)
),
schedule_bad AS (
 SELECT count(*) AS n FROM public.matches m JOIN public.events e ON e.id=m.event_id
 WHERE e.preset_type='koshien' AND m.starts_at IS NOT NULL
 AND extract(year FROM m.starts_at AT TIME ZONE 'Asia/Tokyo')::text IS DISTINCT FROM e.season
),
season_bad AS (
 SELECT count(*) AS n FROM public.events WHERE preset_type='koshien'
 AND NOT coalesce(season ~ '^(202[0-9]|203[0-5])$',false)
),
object_collisions AS (
 SELECT
  (SELECT count(*) FROM pg_proc p JOIN pg_namespace s ON s.oid=p.pronamespace
   WHERE (s.nspname='public' AND p.proname='open_koshien_draft') OR
   (s.nspname='yoso_admin_finalize_private' AND p.proname IN
    ('guard_koshien_draft_open','keep_open_koshien_rounds_confirmed','keep_confirmed_koshien_start_rounds','require_koshien_draft_open_permit')))
  +(SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
    ('yoso_guard_koshien_draft_open','yoso_keep_open_koshien_rounds_confirmed','yoso_keep_confirmed_koshien_team_round','yoso_keep_confirmed_koshien_event_team_round','yoso_require_koshien_draft_open_permit'))
  +(SELECT count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname IN
    ('yoso_import_event_identity_unique','yoso_import_match_identity_unique','yoso_import_event_identity','yoso_import_match_event','yoso_import_identity'))
  +(SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='external_match_imports' AND column_name IN ('import_year','import_preset'))
  +(SELECT count(*) FROM pg_class c JOIN pg_namespace s ON s.oid=c.relnamespace WHERE
    (s.nspname='public' AND c.relname IN ('yoso_import_event_identity_idx','yoso_import_match_event_idx'))
    OR (s.nspname='yoso_admin_finalize_private' AND c.relname='draft_open_permits')) AS n
),
private_acl AS (
 SELECT coalesce((SELECT pg_get_userbyid(nspowner)='postgres'
  AND NOT has_schema_privilege('anon',oid,'USAGE')
  AND NOT has_schema_privilege('authenticated',oid,'USAGE')
  AND NOT has_schema_privilege('authenticated',oid,'CREATE')
  FROM pg_namespace WHERE nspname='yoso_admin_finalize_private'),false) AS ok
),
checks AS (
 SELECT 'foreign_key_graph' AS check_name,n=70 AND fingerprint='4239f331a161c1235ea731a606253b15' AS ok,n::text AS observed FROM fk
 UNION ALL SELECT 'schedule_rpc_definition_and_acl',n=0,n::text FROM rpc_drift
 UNION ALL SELECT 'import_identity_violations',n=0,n::text FROM import_bad
 UNION ALL SELECT 'schedule_year_violations',n=0,n::text FROM schedule_bad
 UNION ALL SELECT 'invalid_saved_seasons',n=0,n::text FROM season_bad
 UNION ALL SELECT 'release_object_collisions',n=0,n::text FROM object_collisions
 UNION ALL SELECT 'private_schema_permissions',ok,ok::text FROM private_acl
)
SELECT check_name,ok,observed FROM checks ORDER BY check_name;
ROLLBACK;
