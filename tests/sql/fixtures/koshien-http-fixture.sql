-- HTTP integration only, loaded after existing disposable lifecycle fixture.
-- Mirror API-visible columns and minimal relationship/RLS contracts; not a production schema.
ALTER TABLE public.leagues ADD COLUMN name text, ADD COLUMN invite_code text UNIQUE;
UPDATE public.leagues SET name='HTTP fixture',invite_code='fixture-http' WHERE id='00000000-0000-0000-0000-000000000010';
CREATE TABLE public.profiles(id uuid PRIMARY KEY,display_name text);
INSERT INTO public.profiles VALUES
 ('00000000-0000-0000-0000-000000000001','Fixture admin'),
 ('00000000-0000-0000-0000-000000000002','Fixture member'),
 ('00000000-0000-0000-0000-000000000003','Fixture outsider');
ALTER TABLE public.league_members ADD FOREIGN KEY(user_id) REFERENCES public.profiles(id);
ALTER TABLE public.predictions ADD FOREIGN KEY(user_id) REFERENCES public.profiles(id);
ALTER TABLE public.events ADD COLUMN sport_type text DEFAULT 'baseball', ADD COLUMN created_at timestamptz DEFAULT now();
ALTER TABLE public.teams ADD COLUMN game_multiplier numeric;
ALTER TABLE public.matches ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.results ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.players ADD COLUMN display_name text;
ALTER TABLE public.scores ADD COLUMN phase1_score numeric DEFAULT 0, ADD COLUMN phase2_score numeric DEFAULT 0,
 ADD COLUMN phase3_score numeric DEFAULT 0, ADD COLUMN revenge_score numeric DEFAULT 0,
 ADD COLUMN zombie_score numeric DEFAULT 0, ADD COLUMN breakdown jsonb DEFAULT '{}'::jsonb;
-- Real PostgREST provides request.jwt.claims after validating signature. No
-- session variables are set by the HTTP test client; only the token is sent.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
 SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid
$f$;
ALTER TABLE public.leagues ENABLE ROW LEVEL SECURITY;
CREATE POLICY http_league_select ON public.leagues FOR SELECT TO authenticated USING(public.is_league_member(id));
ALTER TABLE public.league_members ENABLE ROW LEVEL SECURITY;
-- Match effective production member visibility and role/status constraints.
ALTER TABLE public.league_members ADD CHECK(membership_status IN ('active','removed')), ADD CHECK(role IN ('owner','co_owner','member'));
CREATE POLICY http_member_select ON public.league_members FOR SELECT TO authenticated USING(membership_status='active' AND public.is_league_member(league_id));
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY http_profile_select ON public.profiles FOR SELECT TO authenticated USING(id=auth.uid() OR EXISTS(
 SELECT 1 FROM public.league_members mine JOIN public.players historical ON historical.league_id=mine.league_id AND historical.profile_id=profiles.id
 WHERE mine.user_id=auth.uid() AND mine.membership_status='active'));
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY http_match_select ON public.matches FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=matches.event_id AND public.is_league_member(e.league_id)));
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
CREATE POLICY http_result_select ON public.results FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=results.event_id AND public.is_league_member(e.league_id)));
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY http_score_select ON public.scores FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=scores.event_id AND public.is_league_member(e.league_id)));
GRANT SELECT ON public.leagues,public.league_members,public.profiles TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
-- The authenticator cannot bypass RLS and cannot assume postgres/service_role.
CREATE ROLE yoso_http_authenticator LOGIN NOINHERIT;
GRANT anon,authenticated TO yoso_http_authenticator;
REVOKE CONNECT ON DATABASE yoso_koshien_lifecycle_test FROM PUBLIC;
GRANT CONNECT ON DATABASE yoso_koshien_lifecycle_test TO yoso_http_authenticator;
