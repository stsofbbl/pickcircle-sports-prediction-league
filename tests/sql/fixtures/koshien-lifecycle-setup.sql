-- Extend existing disposable finalization fixture. No production connection.
ALTER TABLE public.events ADD COLUMN name text;
ALTER TABLE public.events ADD COLUMN season text;
ALTER TABLE public.events ADD COLUMN prediction_deadline timestamptz;
ALTER TABLE public.events ADD COLUMN created_by uuid;
ALTER TABLE public.teams ADD COLUMN name text, ADD COLUMN team_id text, ADD COLUMN school_name text,
 ADD COLUMN prefecture text, ADD COLUMN region text, ADD COLUMN seed integer,
 ADD COLUMN start_round integer DEFAULT 1 CHECK(start_round IN(1,2)),
 ADD COLUMN odds numeric DEFAULT 1 CHECK(odds>0),
 ADD COLUMN sqrt_odds numeric GENERATED ALWAYS AS (sqrt(odds)) STORED,
 ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb, ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.teams ADD UNIQUE(event_id,name);
CREATE UNIQUE INDEX lifecycle_team_rep_key ON public.teams(event_id,(metadata->>'representative_key')) WHERE nullif(metadata->>'representative_key','') IS NOT NULL;
CREATE UNIQUE INDEX lifecycle_team_district_key ON public.teams(event_id,(metadata->>'district_key')) WHERE nullif(metadata->>'district_key','') IS NOT NULL;
ALTER TABLE public.event_teams ADD COLUMN name text, ADD COLUMN seed integer, ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.event_teams ADD UNIQUE(event_id,name);
CREATE TABLE public.predictions(id bigserial PRIMARY KEY,event_id text,user_id uuid,payload jsonb,submitted_at timestamptz,updated_at timestamptz,UNIQUE(event_id,user_id));
CREATE TABLE public.phase1_picks(id uuid DEFAULT gen_random_uuid() PRIMARY KEY,event_id text,player_id uuid,team_id uuid REFERENCES public.teams(id),
 pick_order int CHECK(pick_order>=1),captain boolean,odds_snapshot numeric,sqrt_odds_snapshot numeric,
 UNIQUE(event_id,player_id,pick_order),UNIQUE(event_id,player_id,team_id));
-- Empty referenced tables for the real representative replacement's stale-team checks.
-- Their unrelated lifecycle behavior is not simulated.
CREATE TABLE public.phase2_draft_picks(team_id uuid);
CREATE TABLE public.phase2_drafts(eligible_team_ids uuid[]);
CREATE TABLE public.final_score_predictions(champion_team_id uuid,runner_up_team_id uuid);
CREATE TABLE public.koshien_later_rounds(team_a_id uuid,team_b_id uuid);
CREATE TABLE public.koshien_revenge_eligibility(allowed_team_ids uuid[]);
CREATE TABLE public.koshien_zombie_eligibility(allowed_team_ids uuid[]);
CREATE TABLE public.phase3_predictions(team_a_id uuid,team_b_id uuid);
CREATE TABLE public.external_team_aliases(team_id uuid);
CREATE TABLE public.revenge_picks(target_team_id uuid);
CREATE TABLE public.zombie_picks(target_team_id uuid);
CREATE TABLE public.zombie_predictions(team_id uuid);
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
CREATE POLICY lifecycle_players_select ON public.players FOR SELECT TO authenticated USING(public.is_league_member(league_id));
GRANT SELECT ON public.players TO authenticated;
INSERT INTO public.players VALUES('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002');
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY lifecycle_teams_select ON public.teams FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=teams.event_id AND public.is_league_member(e.league_id)));
CREATE POLICY lifecycle_teams_admin ON public.teams FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=teams.event_id AND public.is_league_admin(e.league_id))) WITH CHECK(EXISTS(SELECT 1 FROM public.events e WHERE e.id=teams.event_id AND public.is_league_admin(e.league_id)));
ALTER TABLE public.event_teams ENABLE ROW LEVEL SECURITY;
CREATE POLICY lifecycle_event_teams_select ON public.event_teams FOR SELECT TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_teams.event_id AND public.is_league_member(e.league_id)));
GRANT INSERT ON public.events TO authenticated;
CREATE POLICY lifecycle_events_insert ON public.events FOR INSERT TO authenticated WITH CHECK(created_by=auth.uid() AND public.is_league_admin(league_id));
-- Run after captured RPC definitions have been installed.
