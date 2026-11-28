-- Captured 2026-11-25 from production catalog, metadata only.
-- All 70 public FKs, primary/unique constraints and participating column types/nullability.
-- Minimal dependency graph: non-key columns/checks/indexes/other triggers omitted.
-- No production rows, auth secrets, or actual account IDs.
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
CREATE SCHEMA yoso_admin_finalize_private;
REVOKE ALL ON SCHEMA yoso_admin_finalize_private FROM PUBLIC,anon,authenticated;
GRANT USAGE ON SCHEMA auth TO authenticated;
CREATE TABLE public.event_teams (
 id bigint NOT NULL,
 event_id text NOT NULL,
 name text NOT NULL
);
CREATE TABLE public.events (
 id text NOT NULL,
 league_id uuid NOT NULL,
 name text NOT NULL,
 preset_type text NOT NULL,
 status text NOT NULL,
 rules jsonb NOT NULL,
 created_by uuid NOT NULL,
 season text
);
CREATE TABLE public.external_match_imports (
 id uuid NOT NULL,
 event_id text NOT NULL,
 source text NOT NULL,
 external_key text NOT NULL,
 source_url text NOT NULL,
 normalized_payload jsonb NOT NULL,
 imported_match_id uuid NOT NULL,
 confirmed_by uuid NOT NULL,
 canceled_by uuid
);
CREATE TABLE public.external_result_fetches (
 id uuid NOT NULL,
 event_id text NOT NULL,
 requested_by uuid NOT NULL
);
CREATE TABLE public.external_team_aliases (
 id uuid NOT NULL,
 event_id text NOT NULL,
 source text NOT NULL,
 normalized_external_name text NOT NULL,
 team_id uuid NOT NULL,
 created_by uuid NOT NULL
);
CREATE TABLE public.final_score_predictions (
 id uuid NOT NULL,
 event_id text NOT NULL,
 player_id uuid NOT NULL,
 champion_team_id uuid,
 runner_up_team_id uuid
);
CREATE TABLE public.koshien_automation_state (
 event_id text NOT NULL
);
CREATE TABLE public.koshien_later_prediction_requests (
 event_id text NOT NULL,
 player_id uuid NOT NULL,
 phase_key text NOT NULL,
 request_id uuid NOT NULL
);
CREATE TABLE public.koshien_later_rounds (
 id uuid NOT NULL,
 event_id text NOT NULL,
 phase_key text NOT NULL,
 team_a_id uuid,
 team_b_id uuid
);
CREATE TABLE public.koshien_result_cancellations (
 id bigint NOT NULL,
 event_id text NOT NULL,
 canceled_by uuid NOT NULL
);
CREATE TABLE public.koshien_result_reopens (
 id bigint NOT NULL,
 event_id text NOT NULL,
 reopened_by uuid NOT NULL
);
CREATE TABLE public.koshien_revenge_eligibility (
 event_id text NOT NULL,
 player_id uuid NOT NULL
);
CREATE TABLE public.koshien_zombie_eligibility (
 event_id text NOT NULL,
 player_id uuid NOT NULL
);
CREATE TABLE public.league_admin_audit (
 id bigint NOT NULL,
 league_id uuid NOT NULL,
 target_user_id uuid NOT NULL,
 changed_by uuid NOT NULL
);
CREATE TABLE public.league_join_requests (
 id uuid NOT NULL,
 league_id uuid NOT NULL,
 requester_id uuid NOT NULL,
 reviewed_by uuid
);
CREATE TABLE public.league_members (
 league_id uuid NOT NULL,
 user_id uuid NOT NULL,
 role text NOT NULL,
 membership_status text NOT NULL
);
CREATE TABLE public.leagues (
 id uuid NOT NULL,
 name text NOT NULL,
 invite_code text NOT NULL,
 created_by uuid NOT NULL
);
CREATE TABLE public.matches (
 id uuid NOT NULL,
 event_id text NOT NULL,
 round_key text NOT NULL,
 match_no integer,
 team1_id uuid,
 team2_id uuid,
 winner_team_id uuid,
 loser_team_id uuid
);
CREATE TABLE public.phase1_picks (
 id uuid NOT NULL,
 event_id text NOT NULL,
 player_id uuid NOT NULL,
 team_id uuid NOT NULL,
 pick_order integer NOT NULL
);
CREATE TABLE public.phase2_draft_picks (
 id uuid NOT NULL,
 event_id text NOT NULL,
 player_id uuid NOT NULL,
 team_id uuid NOT NULL,
 draft_round integer NOT NULL,
 draft_id uuid NOT NULL,
 pick_no integer NOT NULL,
 request_id uuid NOT NULL
);
CREATE TABLE public.phase2_drafts (
 id uuid NOT NULL,
 event_id text NOT NULL
);
CREATE TABLE public.players (
 id uuid NOT NULL,
 league_id uuid NOT NULL,
 profile_id uuid
);
CREATE TABLE public.predictions (
 id bigint NOT NULL,
 event_id text NOT NULL,
 user_id uuid NOT NULL
);
CREATE TABLE public.profiles (
 id uuid NOT NULL,
 auth_user_id uuid
);
CREATE TABLE public.results (
 id bigint NOT NULL,
 event_id text NOT NULL,
 updated_by uuid NOT NULL
);
CREATE TABLE public.revenge_picks (
 id uuid NOT NULL,
 event_id text NOT NULL,
 player_id uuid NOT NULL,
 match_id uuid,
 target_team_id uuid
);
CREATE TABLE public.scores (
 id uuid NOT NULL,
 event_id text NOT NULL,
 player_id uuid NOT NULL
);
CREATE TABLE public.teams (
 id uuid NOT NULL,
 event_id text NOT NULL,
 name text NOT NULL
);
CREATE TABLE public.zombie_predictions (
 id uuid NOT NULL,
 event_id text NOT NULL,
 player_id uuid NOT NULL,
 team_id uuid
);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.leagues ADD CONSTRAINT leagues_pkey PRIMARY KEY (id);
ALTER TABLE public.leagues ADD CONSTRAINT leagues_invite_code_key UNIQUE (invite_code);
ALTER TABLE public.league_members ADD CONSTRAINT league_members_pkey PRIMARY KEY (league_id, user_id);
ALTER TABLE public.events ADD CONSTRAINT events_pkey PRIMARY KEY (id);
ALTER TABLE public.event_teams ADD CONSTRAINT event_teams_pkey PRIMARY KEY (id);
ALTER TABLE public.event_teams ADD CONSTRAINT event_teams_event_id_name_key UNIQUE (event_id, name);
ALTER TABLE public.predictions ADD CONSTRAINT predictions_pkey PRIMARY KEY (id);
ALTER TABLE public.predictions ADD CONSTRAINT predictions_event_id_user_id_key UNIQUE (event_id, user_id);
ALTER TABLE public.results ADD CONSTRAINT results_pkey PRIMARY KEY (id);
ALTER TABLE public.results ADD CONSTRAINT results_event_id_key UNIQUE (event_id);
ALTER TABLE public.players ADD CONSTRAINT players_pkey PRIMARY KEY (id);
ALTER TABLE public.players ADD CONSTRAINT players_league_id_profile_id_key UNIQUE (league_id, profile_id);
ALTER TABLE public.teams ADD CONSTRAINT teams_pkey PRIMARY KEY (id);
ALTER TABLE public.teams ADD CONSTRAINT teams_event_id_name_key UNIQUE (event_id, name);
ALTER TABLE public.matches ADD CONSTRAINT matches_pkey PRIMARY KEY (id);
ALTER TABLE public.matches ADD CONSTRAINT matches_event_id_round_key_match_no_key UNIQUE (event_id, round_key, match_no);
ALTER TABLE public.phase1_picks ADD CONSTRAINT phase1_picks_pkey PRIMARY KEY (id);
ALTER TABLE public.phase1_picks ADD CONSTRAINT phase1_picks_event_id_player_id_pick_order_key UNIQUE (event_id, player_id, pick_order);
ALTER TABLE public.phase1_picks ADD CONSTRAINT phase1_picks_event_id_player_id_team_id_key UNIQUE (event_id, player_id, team_id);
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_pkey PRIMARY KEY (id);
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_event_id_player_id_draft_round_key UNIQUE (event_id, player_id, draft_round);
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_event_id_team_id_key UNIQUE (event_id, team_id);
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_pkey PRIMARY KEY (id);
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_event_id_player_id_key UNIQUE (event_id, player_id);
ALTER TABLE public.scores ADD CONSTRAINT scores_pkey PRIMARY KEY (id);
ALTER TABLE public.scores ADD CONSTRAINT scores_event_id_player_id_key UNIQUE (event_id, player_id);
ALTER TABLE public.revenge_picks ADD CONSTRAINT revenge_picks_pkey PRIMARY KEY (id);
ALTER TABLE public.zombie_predictions ADD CONSTRAINT zombie_predictions_pkey PRIMARY KEY (id);
ALTER TABLE public.phase2_drafts ADD CONSTRAINT phase2_drafts_pkey PRIMARY KEY (id);
ALTER TABLE public.phase2_drafts ADD CONSTRAINT phase2_drafts_event_id_key UNIQUE (event_id);
ALTER TABLE public.phase2_drafts ADD CONSTRAINT phase2_drafts_id_event_id_key UNIQUE (id, event_id);
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_draft_pick_key UNIQUE (draft_id, pick_no);
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_draft_team_key UNIQUE (draft_id, team_id);
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_draft_player_round_key UNIQUE (draft_id, player_id, draft_round);
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_draft_player_request_key UNIQUE (draft_id, player_id, request_id);
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_pkey PRIMARY KEY (id);
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_event_id_phase_key_key UNIQUE (event_id, phase_key);
ALTER TABLE public.koshien_revenge_eligibility ADD CONSTRAINT koshien_revenge_eligibility_pkey PRIMARY KEY (event_id, player_id);
ALTER TABLE public.koshien_zombie_eligibility ADD CONSTRAINT koshien_zombie_eligibility_pkey PRIMARY KEY (event_id, player_id);
ALTER TABLE public.external_team_aliases ADD CONSTRAINT external_team_aliases_pkey PRIMARY KEY (id);
ALTER TABLE public.external_team_aliases ADD CONSTRAINT external_team_aliases_event_id_source_normalized_external_n_key UNIQUE (event_id, source, normalized_external_name);
ALTER TABLE public.external_result_fetches ADD CONSTRAINT external_result_fetches_pkey PRIMARY KEY (id);
ALTER TABLE public.external_match_imports ADD CONSTRAINT external_match_imports_pkey PRIMARY KEY (id);
ALTER TABLE public.external_match_imports ADD CONSTRAINT external_match_imports_event_id_source_external_key_key UNIQUE (event_id, source, external_key);
ALTER TABLE public.league_admin_audit ADD CONSTRAINT league_admin_audit_pkey PRIMARY KEY (id);
ALTER TABLE public.koshien_result_cancellations ADD CONSTRAINT koshien_result_cancellations_pkey PRIMARY KEY (id);
ALTER TABLE public.koshien_result_reopens ADD CONSTRAINT koshien_result_reopens_pkey PRIMARY KEY (id);
ALTER TABLE public.league_join_requests ADD CONSTRAINT league_join_requests_pkey PRIMARY KEY (id);
ALTER TABLE public.league_join_requests ADD CONSTRAINT league_join_requests_league_id_requester_id_key UNIQUE (league_id, requester_id);
ALTER TABLE public.koshien_later_prediction_requests ADD CONSTRAINT koshien_later_prediction_requests_pkey PRIMARY KEY (event_id, player_id, phase_key, request_id);
ALTER TABLE public.koshien_automation_state ADD CONSTRAINT koshien_automation_state_pkey PRIMARY KEY (event_id);
INSERT INTO auth.users VALUES('00000000-0000-0000-0001-000000000090');
INSERT INTO public.event_teams(id,event_id,name) VALUES(101,'events-1','event_teams-name-1');
INSERT INTO public.events(id,league_id,name,preset_type,status,rules,created_by,season) VALUES('events-1','00000000-0000-0000-0001-000000000017','events-name-1','koshien','finalized','{"resultFlow":{"status":"finalized"}}'::jsonb,'00000000-0000-0000-0001-000000000024','2026');
INSERT INTO public.external_match_imports(id,event_id,source,external_key,source_url,normalized_payload,imported_match_id,confirmed_by,canceled_by) VALUES('00000000-0000-0000-0001-000000000003','events-1','jhbf','jhbf:summer:2026:2026-08-10:1','https://www.jhbf.or.jp/sensyuken/2026/schedule/schedule_20260810.html','{"source":"jhbf","externalKey":"jhbf:summer:2026:2026-08-10:1"}'::jsonb,'00000000-0000-0000-0001-000000000018','00000000-0000-0000-0001-000000000024','00000000-0000-0000-0001-000000000024');
INSERT INTO public.external_result_fetches(id,event_id,requested_by) VALUES('00000000-0000-0000-0001-000000000004','events-1','00000000-0000-0000-0001-000000000024');
INSERT INTO public.external_team_aliases(id,event_id,source,normalized_external_name,team_id,created_by) VALUES('00000000-0000-0000-0001-000000000005','events-1','jhbf','external_team_aliases-normalized_external_name-1','00000000-0000-0000-0001-000000000028','00000000-0000-0000-0001-000000000024');
INSERT INTO public.final_score_predictions(id,event_id,player_id,champion_team_id,runner_up_team_id) VALUES('00000000-0000-0000-0001-000000000006','events-1','00000000-0000-0000-0001-000000000022','00000000-0000-0000-0001-000000000028','00000000-0000-0000-0001-000000000028');
INSERT INTO public.koshien_automation_state(event_id) VALUES('events-1');
INSERT INTO public.koshien_later_prediction_requests(event_id,player_id,phase_key,request_id) VALUES('events-1','00000000-0000-0000-0001-000000000022','koshien_later_prediction_requests-phase_key-1','00000000-0000-0000-0001-000000000008');
INSERT INTO public.koshien_later_rounds(id,event_id,phase_key,team_a_id,team_b_id) VALUES('00000000-0000-0000-0001-000000000009','events-1','koshien_later_rounds-phase_key-1','00000000-0000-0000-0001-000000000028','00000000-0000-0000-0001-000000000028');
INSERT INTO public.koshien_result_cancellations(id,event_id,canceled_by) VALUES(110,'events-1','00000000-0000-0000-0001-000000000024');
INSERT INTO public.koshien_result_reopens(id,event_id,reopened_by) VALUES(111,'events-1','00000000-0000-0000-0001-000000000024');
INSERT INTO public.koshien_revenge_eligibility(event_id,player_id) VALUES('events-1','00000000-0000-0000-0001-000000000022');
INSERT INTO public.koshien_zombie_eligibility(event_id,player_id) VALUES('events-1','00000000-0000-0000-0001-000000000022');
INSERT INTO public.league_admin_audit(id,league_id,target_user_id,changed_by) VALUES(114,'00000000-0000-0000-0001-000000000017','00000000-0000-0000-0001-000000000024','00000000-0000-0000-0001-000000000024');
INSERT INTO public.league_join_requests(id,league_id,requester_id,reviewed_by) VALUES('00000000-0000-0000-0001-000000000015','00000000-0000-0000-0001-000000000017','00000000-0000-0000-0001-000000000024','00000000-0000-0000-0001-000000000024');
INSERT INTO public.league_members(league_id,user_id,role,membership_status) VALUES('00000000-0000-0000-0001-000000000017','00000000-0000-0000-0001-000000000024','owner','active');
INSERT INTO public.leagues(id,name,invite_code,created_by) VALUES('00000000-0000-0000-0001-000000000017','leagues-name-1','leagues-invite_code-1','00000000-0000-0000-0001-000000000024');
INSERT INTO public.matches(id,event_id,round_key,match_no,team1_id,team2_id,winner_team_id,loser_team_id) VALUES('00000000-0000-0000-0001-000000000018','events-1','R1',1,'00000000-0000-0000-0001-000000000028','00000000-0000-0000-0001-000000000028','00000000-0000-0000-0001-000000000028','00000000-0000-0000-0001-000000000028');
INSERT INTO public.phase1_picks(id,event_id,player_id,team_id,pick_order) VALUES('00000000-0000-0000-0001-000000000019','events-1','00000000-0000-0000-0001-000000000022','00000000-0000-0000-0001-000000000028',1);
INSERT INTO public.phase2_draft_picks(id,event_id,player_id,team_id,draft_round,draft_id,pick_no,request_id) VALUES('00000000-0000-0000-0001-000000000020','events-1','00000000-0000-0000-0001-000000000022','00000000-0000-0000-0001-000000000028',1,'00000000-0000-0000-0001-000000000021',1,'00000000-0000-0000-0001-000000000020');
INSERT INTO public.phase2_drafts(id,event_id) VALUES('00000000-0000-0000-0001-000000000021','events-1');
INSERT INTO public.players(id,league_id,profile_id) VALUES('00000000-0000-0000-0001-000000000022','00000000-0000-0000-0001-000000000017','00000000-0000-0000-0001-000000000024');
INSERT INTO public.predictions(id,event_id,user_id) VALUES(123,'events-1','00000000-0000-0000-0001-000000000024');
INSERT INTO public.profiles(id,auth_user_id) VALUES('00000000-0000-0000-0001-000000000024','00000000-0000-0000-0001-000000000090');
INSERT INTO public.results(id,event_id,updated_by) VALUES(125,'events-1','00000000-0000-0000-0001-000000000024');
INSERT INTO public.revenge_picks(id,event_id,player_id,match_id,target_team_id) VALUES('00000000-0000-0000-0001-000000000026','events-1','00000000-0000-0000-0001-000000000022','00000000-0000-0000-0001-000000000018','00000000-0000-0000-0001-000000000028');
INSERT INTO public.scores(id,event_id,player_id) VALUES('00000000-0000-0000-0001-000000000027','events-1','00000000-0000-0000-0001-000000000022');
INSERT INTO public.teams(id,event_id,name) VALUES('00000000-0000-0000-0001-000000000028','events-1','teams-name-1');
INSERT INTO public.zombie_predictions(id,event_id,player_id,team_id) VALUES('00000000-0000-0000-0001-000000000029','events-1','00000000-0000-0000-0001-000000000022','00000000-0000-0000-0001-000000000028');
INSERT INTO auth.users VALUES('00000000-0000-0000-0002-000000000090');
INSERT INTO public.event_teams(id,event_id,name) VALUES(201,'events-2','event_teams-name-2');
INSERT INTO public.events(id,league_id,name,preset_type,status,rules,created_by,season) VALUES('events-2','00000000-0000-0000-0002-000000000017','events-name-2','koshien','finalized','{"resultFlow":{"status":"finalized"}}'::jsonb,'00000000-0000-0000-0002-000000000024','2026');
INSERT INTO public.external_match_imports(id,event_id,source,external_key,source_url,normalized_payload,imported_match_id,confirmed_by,canceled_by) VALUES('00000000-0000-0000-0002-000000000003','events-2','jhbf','jhbf:summer:2026:2026-08-10:1','https://www.jhbf.or.jp/sensyuken/2026/schedule/schedule_20260810.html','{"source":"jhbf","externalKey":"jhbf:summer:2026:2026-08-10:1"}'::jsonb,'00000000-0000-0000-0002-000000000018','00000000-0000-0000-0002-000000000024','00000000-0000-0000-0002-000000000024');
INSERT INTO public.external_result_fetches(id,event_id,requested_by) VALUES('00000000-0000-0000-0002-000000000004','events-2','00000000-0000-0000-0002-000000000024');
INSERT INTO public.external_team_aliases(id,event_id,source,normalized_external_name,team_id,created_by) VALUES('00000000-0000-0000-0002-000000000005','events-2','jhbf','external_team_aliases-normalized_external_name-2','00000000-0000-0000-0002-000000000028','00000000-0000-0000-0002-000000000024');
INSERT INTO public.final_score_predictions(id,event_id,player_id,champion_team_id,runner_up_team_id) VALUES('00000000-0000-0000-0002-000000000006','events-2','00000000-0000-0000-0002-000000000022','00000000-0000-0000-0002-000000000028','00000000-0000-0000-0002-000000000028');
INSERT INTO public.koshien_automation_state(event_id) VALUES('events-2');
INSERT INTO public.koshien_later_prediction_requests(event_id,player_id,phase_key,request_id) VALUES('events-2','00000000-0000-0000-0002-000000000022','koshien_later_prediction_requests-phase_key-2','00000000-0000-0000-0002-000000000008');
INSERT INTO public.koshien_later_rounds(id,event_id,phase_key,team_a_id,team_b_id) VALUES('00000000-0000-0000-0002-000000000009','events-2','koshien_later_rounds-phase_key-2','00000000-0000-0000-0002-000000000028','00000000-0000-0000-0002-000000000028');
INSERT INTO public.koshien_result_cancellations(id,event_id,canceled_by) VALUES(210,'events-2','00000000-0000-0000-0002-000000000024');
INSERT INTO public.koshien_result_reopens(id,event_id,reopened_by) VALUES(211,'events-2','00000000-0000-0000-0002-000000000024');
INSERT INTO public.koshien_revenge_eligibility(event_id,player_id) VALUES('events-2','00000000-0000-0000-0002-000000000022');
INSERT INTO public.koshien_zombie_eligibility(event_id,player_id) VALUES('events-2','00000000-0000-0000-0002-000000000022');
INSERT INTO public.league_admin_audit(id,league_id,target_user_id,changed_by) VALUES(214,'00000000-0000-0000-0002-000000000017','00000000-0000-0000-0002-000000000024','00000000-0000-0000-0002-000000000024');
INSERT INTO public.league_join_requests(id,league_id,requester_id,reviewed_by) VALUES('00000000-0000-0000-0002-000000000015','00000000-0000-0000-0002-000000000017','00000000-0000-0000-0002-000000000024','00000000-0000-0000-0002-000000000024');
INSERT INTO public.league_members(league_id,user_id,role,membership_status) VALUES('00000000-0000-0000-0002-000000000017','00000000-0000-0000-0002-000000000024','owner','active');
INSERT INTO public.leagues(id,name,invite_code,created_by) VALUES('00000000-0000-0000-0002-000000000017','leagues-name-2','leagues-invite_code-2','00000000-0000-0000-0002-000000000024');
INSERT INTO public.matches(id,event_id,round_key,match_no,team1_id,team2_id,winner_team_id,loser_team_id) VALUES('00000000-0000-0000-0002-000000000018','events-2','R1',1,'00000000-0000-0000-0002-000000000028','00000000-0000-0000-0002-000000000028','00000000-0000-0000-0002-000000000028','00000000-0000-0000-0002-000000000028');
INSERT INTO public.phase1_picks(id,event_id,player_id,team_id,pick_order) VALUES('00000000-0000-0000-0002-000000000019','events-2','00000000-0000-0000-0002-000000000022','00000000-0000-0000-0002-000000000028',1);
INSERT INTO public.phase2_draft_picks(id,event_id,player_id,team_id,draft_round,draft_id,pick_no,request_id) VALUES('00000000-0000-0000-0002-000000000020','events-2','00000000-0000-0000-0002-000000000022','00000000-0000-0000-0002-000000000028',1,'00000000-0000-0000-0002-000000000021',1,'00000000-0000-0000-0002-000000000020');
INSERT INTO public.phase2_drafts(id,event_id) VALUES('00000000-0000-0000-0002-000000000021','events-2');
INSERT INTO public.players(id,league_id,profile_id) VALUES('00000000-0000-0000-0002-000000000022','00000000-0000-0000-0002-000000000017','00000000-0000-0000-0002-000000000024');
INSERT INTO public.predictions(id,event_id,user_id) VALUES(223,'events-2','00000000-0000-0000-0002-000000000024');
INSERT INTO public.profiles(id,auth_user_id) VALUES('00000000-0000-0000-0002-000000000024','00000000-0000-0000-0002-000000000090');
INSERT INTO public.results(id,event_id,updated_by) VALUES(225,'events-2','00000000-0000-0000-0002-000000000024');
INSERT INTO public.revenge_picks(id,event_id,player_id,match_id,target_team_id) VALUES('00000000-0000-0000-0002-000000000026','events-2','00000000-0000-0000-0002-000000000022','00000000-0000-0000-0002-000000000018','00000000-0000-0000-0002-000000000028');
INSERT INTO public.scores(id,event_id,player_id) VALUES('00000000-0000-0000-0002-000000000027','events-2','00000000-0000-0000-0002-000000000022');
INSERT INTO public.teams(id,event_id,name) VALUES('00000000-0000-0000-0002-000000000028','events-2','teams-name-2');
INSERT INTO public.zombie_predictions(id,event_id,player_id,team_id) VALUES('00000000-0000-0000-0002-000000000029','events-2','00000000-0000-0000-0002-000000000022','00000000-0000-0000-0002-000000000028');
ALTER TABLE public.leagues ADD CONSTRAINT leagues_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.league_members ADD CONSTRAINT league_members_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE public.league_members ADD CONSTRAINT league_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.events ADD CONSTRAINT events_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE public.events ADD CONSTRAINT events_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.event_teams ADD CONSTRAINT event_teams_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.predictions ADD CONSTRAINT predictions_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.predictions ADD CONSTRAINT predictions_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.results ADD CONSTRAINT results_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.results ADD CONSTRAINT results_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.players ADD CONSTRAINT players_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE public.players ADD CONSTRAINT players_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.teams ADD CONSTRAINT teams_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.matches ADD CONSTRAINT matches_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.matches ADD CONSTRAINT matches_team1_id_fkey FOREIGN KEY (team1_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.matches ADD CONSTRAINT matches_team2_id_fkey FOREIGN KEY (team2_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.matches ADD CONSTRAINT matches_winner_team_id_fkey FOREIGN KEY (winner_team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.phase1_picks ADD CONSTRAINT phase1_picks_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.phase1_picks ADD CONSTRAINT phase1_picks_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.phase1_picks ADD CONSTRAINT phase1_picks_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_champion_team_id_fkey FOREIGN KEY (champion_team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_runner_up_team_id_fkey FOREIGN KEY (runner_up_team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.scores ADD CONSTRAINT scores_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.scores ADD CONSTRAINT scores_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.revenge_picks ADD CONSTRAINT revenge_picks_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.revenge_picks ADD CONSTRAINT revenge_picks_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.revenge_picks ADD CONSTRAINT revenge_picks_match_id_fkey FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE;
ALTER TABLE public.revenge_picks ADD CONSTRAINT revenge_picks_target_team_id_fkey FOREIGN KEY (target_team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.zombie_predictions ADD CONSTRAINT zombie_predictions_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.zombie_predictions ADD CONSTRAINT zombie_predictions_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.zombie_predictions ADD CONSTRAINT zombie_predictions_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.matches ADD CONSTRAINT matches_loser_team_id_fkey FOREIGN KEY (loser_team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.phase2_drafts ADD CONSTRAINT phase2_drafts_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_draft_id_fkey FOREIGN KEY (draft_id) REFERENCES phase2_drafts(id) ON DELETE CASCADE;
ALTER TABLE public.phase2_draft_picks ADD CONSTRAINT phase2_draft_picks_draft_event_fkey FOREIGN KEY (draft_id, event_id) REFERENCES phase2_drafts(id, event_id) ON DELETE CASCADE;
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_team_a_id_fkey FOREIGN KEY (team_a_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_team_b_id_fkey FOREIGN KEY (team_b_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.koshien_revenge_eligibility ADD CONSTRAINT koshien_revenge_eligibility_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.koshien_revenge_eligibility ADD CONSTRAINT koshien_revenge_eligibility_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.koshien_zombie_eligibility ADD CONSTRAINT koshien_zombie_eligibility_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.koshien_zombie_eligibility ADD CONSTRAINT koshien_zombie_eligibility_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.external_team_aliases ADD CONSTRAINT external_team_aliases_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.external_team_aliases ADD CONSTRAINT external_team_aliases_team_id_fkey FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE;
ALTER TABLE public.external_team_aliases ADD CONSTRAINT external_team_aliases_created_by_fkey FOREIGN KEY (created_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.external_result_fetches ADD CONSTRAINT external_result_fetches_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.external_result_fetches ADD CONSTRAINT external_result_fetches_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.external_match_imports ADD CONSTRAINT external_match_imports_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.external_match_imports ADD CONSTRAINT external_match_imports_imported_match_id_fkey FOREIGN KEY (imported_match_id) REFERENCES matches(id) ON DELETE RESTRICT;
ALTER TABLE public.external_match_imports ADD CONSTRAINT external_match_imports_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.league_admin_audit ADD CONSTRAINT league_admin_audit_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE public.league_admin_audit ADD CONSTRAINT league_admin_audit_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.league_admin_audit ADD CONSTRAINT league_admin_audit_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.koshien_result_cancellations ADD CONSTRAINT koshien_result_cancellations_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.koshien_result_cancellations ADD CONSTRAINT koshien_result_cancellations_canceled_by_fkey FOREIGN KEY (canceled_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.koshien_result_reopens ADD CONSTRAINT koshien_result_reopens_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.koshien_result_reopens ADD CONSTRAINT koshien_result_reopens_reopened_by_fkey FOREIGN KEY (reopened_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.external_match_imports ADD CONSTRAINT external_match_imports_canceled_by_fkey FOREIGN KEY (canceled_by) REFERENCES profiles(id) ON DELETE RESTRICT;
ALTER TABLE public.league_join_requests ADD CONSTRAINT league_join_requests_league_id_fkey FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
ALTER TABLE public.league_join_requests ADD CONSTRAINT league_join_requests_requester_id_fkey FOREIGN KEY (requester_id) REFERENCES profiles(id) ON DELETE CASCADE;
ALTER TABLE public.league_join_requests ADD CONSTRAINT league_join_requests_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_auth_user_id_fkey FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.koshien_later_prediction_requests ADD CONSTRAINT koshien_later_prediction_requests_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.koshien_later_prediction_requests ADD CONSTRAINT koshien_later_prediction_requests_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.koshien_automation_state ADD CONSTRAINT koshien_automation_state_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.delete_club(p_league_id uuid, p_confirm_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'login required' using errcode = '42501';
  end if;
  if not public.is_league_owner(p_league_id) then
    raise exception 'club owner permission is required' using errcode = '42501';
  end if;

  select l.name into v_name
  from public.leagues l
  where l.id = p_league_id
    and l.created_by = auth.uid()
  for update;

  if v_name is null or btrim(coalesce(p_confirm_name, '')) <> v_name then
    raise exception 'club name confirmation does not match' using errcode = '22023';
  end if;

  delete from public.leagues
  where id = p_league_id;
end;
$function$;

CREATE OR REPLACE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_event_id text;
  v_status text;
  v_flow_status text;
BEGIN
  FOR v_event_id IN
    SELECT DISTINCT id
    FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.event_id ELSE NULL END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.event_id ELSE NULL END
    ]) AS ids(id)
    WHERE id IS NOT NULL
    ORDER BY id
  LOOP
    v_status := NULL;
    v_flow_status := NULL;
    SELECT e.status, e.rules->'resultFlow'->>'status' INTO v_status, v_flow_status
    FROM public.events e
    WHERE e.id = v_event_id AND e.preset_type = 'koshien'
    FOR SHARE NOWAIT;
    IF v_status = 'finalized' OR v_flow_status = 'finalized' THEN
      RAISE EXCEPTION 'reopen finalized Koshien results before editing'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.is_league_owner(p_league_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
      and lm.membership_status = 'active'
      and lm.role = 'owner'
  );
$function$;
CREATE TRIGGER yoso_guard_finalized_event_teams BEFORE INSERT OR DELETE OR UPDATE ON public.event_teams FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();
CREATE TRIGGER yoso_guard_finalized_matches BEFORE INSERT OR DELETE OR UPDATE ON public.matches FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();
CREATE TRIGGER yoso_guard_finalized_results BEFORE INSERT OR DELETE OR UPDATE ON public.results FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();
CREATE TRIGGER yoso_guard_finalized_scores BEFORE INSERT OR DELETE OR UPDATE ON public.scores FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();
CREATE TRIGGER yoso_guard_finalized_teams BEFORE INSERT OR DELETE OR UPDATE ON public.teams FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();
REVOKE ALL ON FUNCTION public.delete_club(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.delete_club(uuid,text) TO authenticated;
REVOKE ALL ON FUNCTION yoso_admin_finalize_private.guard_finalized_result_write() FROM PUBLIC,anon,authenticated;
