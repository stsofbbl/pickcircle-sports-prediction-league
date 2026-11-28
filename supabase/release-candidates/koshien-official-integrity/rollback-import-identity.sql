-- REVIEW CANDIDATE, not an automatic rollback. Removes only added objects.
-- Original foreign keys, import records and permissions are retained.
ALTER TABLE public.external_match_imports
 DROP CONSTRAINT yoso_import_event_identity,
 DROP CONSTRAINT yoso_import_match_event,
 DROP CONSTRAINT yoso_import_identity;
DROP INDEX public.yoso_import_event_identity_idx;
DROP INDEX public.yoso_import_match_event_idx;
ALTER TABLE public.external_match_imports DROP COLUMN import_preset,DROP COLUMN import_year;
ALTER TABLE public.matches DROP CONSTRAINT yoso_import_match_identity_unique;
ALTER TABLE public.events DROP CONSTRAINT yoso_import_event_identity_unique;
