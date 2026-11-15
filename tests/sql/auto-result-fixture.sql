-- Runs after save/cancel concurrency fixture; all additions roll back.
BEGIN;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO authenticated,anon,service_role;
ALTER TABLE public.events ADD COLUMN created_by uuid;
ALTER TABLE public.results ADD COLUMN id uuid DEFAULT gen_random_uuid();
ALTER TABLE public.teams ADD COLUMN name text;
CREATE TABLE public.external_match_imports(
 id uuid DEFAULT gen_random_uuid(),event_id text,source text,external_key text,
 source_url text,normalized_payload jsonb,raw_payload jsonb,imported_match_id uuid,
 fetched_at timestamptz,confirmed_by uuid,status text,confirmed_at timestamptz,
 UNIQUE(event_id,source,external_key));
INSERT INTO public.events(id,preset_type,league_id,created_by) VALUES
 ('auto','koshien','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001');
INSERT INTO public.teams VALUES
 ('30000000-0000-0000-0000-000000000001','auto','Team A'),
 ('30000000-0000-0000-0000-000000000002','auto','Team B');
INSERT INTO public.matches(event_id,round_key,match_no,team1_id,team2_id,status,id) VALUES
 ('auto','R1',1,'30000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','scheduled','40000000-0000-0000-0000-000000000001');
INSERT INTO public.results(event_id,payload) VALUES
 ('auto','{"matches":[{"round":"R1","match_no":1,"status":"scheduled"}]}');
