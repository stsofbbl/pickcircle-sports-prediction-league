-- REVIEW CANDIDATE, not a migration. Apply only in an approved transaction.
-- Existing event/match FKs and permissions are preserved.
-- Explicit season required for JHBF history; no legacy year is guessed.
ALTER TABLE public.events ADD CONSTRAINT yoso_import_event_identity_unique UNIQUE(id,season,preset_type);
ALTER TABLE public.matches ADD CONSTRAINT yoso_import_match_identity_unique UNIQUE(id,event_id);
ALTER TABLE public.external_match_imports
 ADD COLUMN import_year text GENERATED ALWAYS AS (split_part(external_key,':',3)) STORED NOT NULL,
 ADD COLUMN import_preset text GENERATED ALWAYS AS ('koshien'::text) STORED NOT NULL,
 ADD CONSTRAINT yoso_import_event_identity FOREIGN KEY(event_id,import_year,import_preset)
   REFERENCES public.events(id,season,preset_type),
 ADD CONSTRAINT yoso_import_match_event FOREIGN KEY(imported_match_id,event_id)
   REFERENCES public.matches(id,event_id),
 ADD CONSTRAINT yoso_import_identity CHECK (
  import_year ~ '^(202[0-9]|203[0-5])$'
  AND split_part(external_key,':',2)='summer'
  AND import_year=left(split_part(external_key,':',4),4)
  AND normalized_payload->>'source' IS NOT DISTINCT FROM source
  AND normalized_payload->>'externalKey' IS NOT DISTINCT FROM external_key
  AND source_url IN (
   'https://www.jhbf.or.jp/sensyuken/'||import_year||'/schedule/schedule_'||replace(split_part(external_key,':',4),'-','')||'.html',
   'https://jhbf.or.jp/sensyuken/'||import_year||'/schedule/schedule_'||replace(split_part(external_key,':',4),'-','')||'.html'
  )
 );
-- Child-side indexes support FK checks when parent identity is changed.
CREATE INDEX yoso_import_event_identity_idx ON public.external_match_imports(event_id,import_year,import_preset);
CREATE INDEX yoso_import_match_event_idx ON public.external_match_imports(imported_match_id,event_id);
