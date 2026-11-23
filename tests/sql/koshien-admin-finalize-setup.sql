-- Disposable PostgreSQL fixture. No Supabase connection.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$f$;
CREATE TABLE public.leagues(id uuid PRIMARY KEY);
CREATE TABLE public.league_members(
  league_id uuid, user_id uuid, role text, membership_status text);
CREATE TABLE public.events(
  id text PRIMARY KEY, league_id uuid NOT NULL, preset_type text NOT NULL,
  status text NOT NULL, rules jsonb NOT NULL DEFAULT '{}'::jsonb);
CREATE TABLE public.teams(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id text);
CREATE TABLE public.event_teams(id bigserial PRIMARY KEY,event_id text NOT NULL);
CREATE TABLE public.matches(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id text NOT NULL,
  round_key text, match_no int, team1_id uuid,team2_id uuid,
  team1_score int,team2_score int,winner_team_id uuid,loser_team_id uuid,
  status text, updated_at timestamptz DEFAULT now(),
  UNIQUE(event_id,round_key,match_no));
CREATE TABLE public.results(event_id text PRIMARY KEY,payload jsonb NOT NULL);
CREATE TABLE public.players(id uuid PRIMARY KEY,league_id uuid,profile_id uuid);
CREATE TABLE public.scores(event_id text,player_id uuid,total_score integer);
CREATE FUNCTION public.is_league_admin(p_league_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.league_members
 WHERE league_id=p_league_id AND user_id=auth.uid()
 AND membership_status='active' AND role IN ('owner','co_owner'))
$f$;
CREATE FUNCTION public.koshien_result_version(p_event_id text) RETURNS bigint
LANGUAGE sql STABLE SET search_path='' AS $f$
 SELECT coalesce(sum(extract(epoch from m.updated_at)::bigint),0)
 FROM public.matches m WHERE m.event_id=p_event_id AND m.status='completed'
$f$;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
GRANT SELECT,UPDATE ON public.events,public.matches,public.scores,public.results,public.teams,public.event_teams TO authenticated;
INSERT INTO public.leagues VALUES('00000000-0000-0000-0000-000000000010');
INSERT INTO public.league_members VALUES
 ('00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001','owner','active'),
 ('00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000002','member','active');
INSERT INTO public.events VALUES(
 'test-finalize','00000000-0000-0000-0000-000000000010','koshien',
 'resultWait','{"approvalPolicy":"admin","resultFlow":{"status":"none"}}');
INSERT INTO public.teams(event_id) SELECT 'test-finalize' FROM generate_series(1,49);
WITH school_pair AS (
 SELECT id, row_number() OVER (ORDER BY id) rn FROM public.teams
), paired AS (
 SELECT a.id t1,b.id t2 FROM school_pair a JOIN school_pair b
 ON a.rn=1 AND b.rn=2
)
INSERT INTO public.matches(event_id,round_key,match_no,
 team1_id,team2_id,team1_score,team2_score,winner_team_id,loser_team_id,status)
SELECT 'test-finalize',v.round_key,g.no,
  p.t1,p.t2,2,1,p.t1,p.t2,'completed'
FROM (VALUES('R1',17),('R2',16),('R3',8),('QF',4),('SF',2),('F',1)) v(round_key,n)
CROSS JOIN LATERAL generate_series(1,v.n) g(no)
CROSS JOIN paired p;
INSERT INTO public.event_teams(event_id) VALUES ('test-finalize');
INSERT INTO public.results VALUES('test-finalize','{"finishes":{}}');
INSERT INTO public.players VALUES(
 '00000000-0000-0000-0000-000000000011',
 '00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000001');
INSERT INTO public.scores VALUES(
 'test-finalize','00000000-0000-0000-0000-000000000011',30);
