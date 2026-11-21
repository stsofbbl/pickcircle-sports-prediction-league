-- Minimal dependency fixture: actual production save body, not full scoring schema.
BEGIN;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
ALTER TABLE public.events ADD COLUMN league_id uuid;
ALTER TABLE public.events ADD COLUMN prediction_deadline timestamptz;
CREATE TABLE public.league_members(league_id uuid,user_id uuid,role text,membership_status text);
CREATE FUNCTION public.is_league_admin(p_league_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM public.league_members lm
 WHERE lm.league_id=p_league_id AND lm.user_id=(SELECT auth.uid())
 AND lm.membership_status='active' AND lm.role IN ('owner','co_owner'));
$$;
CREATE TABLE public.teams(id uuid PRIMARY KEY,event_id text);
CREATE TABLE public.players(id uuid PRIMARY KEY,league_id uuid);
CREATE TABLE public.matches(
 event_id text,round_key text,match_no integer,team1_id uuid,team2_id uuid,
 team1_score integer,team2_score integer,winner_team_id uuid,loser_team_id uuid,
 status text,metadata jsonb,updated_at timestamptz,UNIQUE(event_id,round_key,match_no));
CREATE TABLE public.scores(event_id text,player_id uuid,phase1_score integer,
 phase2_score integer,phase3_score integer,revenge_score integer,zombie_score integer,
 breakdown jsonb,updated_at timestamptz,UNIQUE(event_id,player_id));
CREATE TABLE public.results(event_id text PRIMARY KEY,payload jsonb,updated_by uuid,updated_at timestamptz);
GRANT USAGE ON SCHEMA public,auth TO authenticated,anon;
GRANT SELECT ON public.events,public.teams,public.players TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.matches,public.scores,public.results TO authenticated;
-- Test the original invoker boundary even when the helper uses definer privileges.
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
CREATE POLICY results_admin ON public.results FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)))
 WITH CHECK(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)));
INSERT INTO public.events VALUES('save','koshien','00000000-0000-0000-0000-000000000010',now()-interval '1 day');
INSERT INTO public.league_members VALUES
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','owner','active'),
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','member','active'),
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','owner','active');
INSERT INTO public.teams VALUES
 ('10000000-0000-0000-0000-000000000001','save'),
 ('10000000-0000-0000-0000-000000000002','save');
INSERT INTO public.players VALUES
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010');
CREATE FUNCTION public.test_reject(query text, code text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE actual text;
BEGIN
 BEGIN EXECUTE query;
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS actual=RETURNED_SQLSTATE; END;
 IF actual IS DISTINCT FROM code THEN RAISE EXCEPTION 'Expected %, got %: %',code,actual,query; END IF;
 RAISE NOTICE 'PASS: rejection %',code;
END;
$$;
CREATE FUNCTION public.test_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END;
$$;
