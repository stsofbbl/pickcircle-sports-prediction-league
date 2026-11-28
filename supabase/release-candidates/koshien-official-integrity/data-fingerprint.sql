-- Read-only data fingerprint for the approved release maintenance window.
-- Run immediately before and after schema changes, BEFORE allowing any new writes.
-- No IDs, personal data or credentials are returned. Generated import columns
-- are intentionally ignored. Compare every count and digest; any change stops
-- release for investigation (legitimate concurrent writes can also change them).
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH
snapshots(table_name,rows) AS (
 SELECT 'events',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public.events x
 UNION ALL SELECT 'teams',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public.teams x
 UNION ALL SELECT 'event_teams',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public.event_teams x
 UNION ALL SELECT 'matches',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public.matches x
 UNION ALL SELECT 'results',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.event_id),'[]'::jsonb) FROM public.results x
 UNION ALL SELECT 'scores',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.event_id,x.player_id),'[]'::jsonb) FROM public.scores x
 UNION ALL SELECT 'predictions',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public.predictions x
 UNION ALL SELECT 'phase1_picks',coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.id),'[]'::jsonb) FROM public.phase1_picks x
 UNION ALL SELECT 'external_match_imports',coalesce(jsonb_agg(to_jsonb(x)-'import_year'-'import_preset' ORDER BY x.id),'[]'::jsonb) FROM public.external_match_imports x
)
SELECT table_name,jsonb_array_length(rows) AS row_count,md5(rows::text) AS fingerprint FROM snapshots ORDER BY table_name;
ROLLBACK;
