-- Synthetic fixture reflecting reviewed production policies, not full schema.
BEGIN;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$f$;
CREATE TABLE auth.users(id uuid PRIMARY KEY);
CREATE TABLE public.profiles(id uuid PRIMARY KEY,auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 display_name text NOT NULL,deleted_at timestamptz,updated_at timestamptz DEFAULT now());
CREATE TABLE public.leagues(id uuid PRIMARY KEY,name text NOT NULL,created_by uuid NOT NULL REFERENCES public.profiles(id));
CREATE TABLE public.league_members(league_id uuid REFERENCES public.leagues(id) ON DELETE CASCADE,user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,role text,membership_status text,PRIMARY KEY(league_id,user_id));
CREATE FUNCTION public.is_league_member(p_league_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.league_members WHERE league_id=p_league_id AND user_id=auth.uid() AND membership_status='active')
$f$;
CREATE FUNCTION public.is_league_admin(p_league_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.league_members WHERE league_id=p_league_id AND user_id=auth.uid() AND membership_status='active' AND role IN('owner','co_owner'))
$f$;
CREATE TABLE public.events(id text PRIMARY KEY,league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,name text NOT NULL,preset_type text NOT NULL,status text NOT NULL,
 prediction_deadline timestamptz,rules jsonb NOT NULL,created_by uuid NOT NULL,sport_type text);
CREATE TABLE public.predictions(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,event_id text REFERENCES public.events(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,payload jsonb NOT NULL,submitted_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),UNIQUE(event_id,user_id));
CREATE TABLE public.results(event_id text PRIMARY KEY REFERENCES public.events(id),payload jsonb,updated_by uuid);
CREATE TABLE public.players(id uuid PRIMARY KEY,league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
 profile_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,display_name text NOT NULL DEFAULT 'Fixture',is_admin boolean NOT NULL DEFAULT false,
 updated_at timestamptz DEFAULT now(),UNIQUE(league_id,profile_id));
-- Match the live scores numeric columns/defaults and stored generated total (catalog verified 2026-11-27).
CREATE TABLE public.scores(event_id text REFERENCES public.events(id),player_id uuid REFERENCES public.players(id),
 phase1_score numeric(12,3) NOT NULL DEFAULT 0,phase2_score numeric(12,3) NOT NULL DEFAULT 0,
 phase3_score numeric(12,3) NOT NULL DEFAULT 0,revenge_score numeric(12,3) NOT NULL DEFAULT 0,zombie_score numeric(12,3) NOT NULL DEFAULT 0,
 total_score numeric(12,3) GENERATED ALWAYS AS (phase1_score+phase2_score+phase3_score+revenge_score+zombie_score) STORED,
 breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,PRIMARY KEY(event_id,player_id));
CREATE FUNCTION public.is_prediction_open(p_event_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.events e WHERE e.id=p_event_id AND e.status='open'
  AND (e.prediction_deadline IS NULL OR now()<e.prediction_deadline) AND public.is_league_member(e.league_id))
$f$;
CREATE FUNCTION public.is_prediction_public(p_event_id text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='public' AS $f$
 SELECT EXISTS(SELECT 1 FROM public.events e WHERE e.id=p_event_id AND public.is_league_member(e.league_id)
  AND (e.status IN('resultWait','finalized','archive') OR (e.prediction_deadline IS NOT NULL AND now()>=e.prediction_deadline)))
$f$;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_select_members ON public.events FOR SELECT TO authenticated USING(public.is_league_member(league_id));
CREATE POLICY events_insert_admin ON public.events FOR INSERT TO authenticated WITH CHECK(created_by=auth.uid() AND public.is_league_admin(league_id));
CREATE POLICY events_update_admin ON public.events FOR UPDATE TO authenticated USING(public.is_league_admin(league_id)) WITH CHECK(public.is_league_admin(league_id));
CREATE POLICY events_delete_admin ON public.events FOR DELETE TO authenticated USING(public.is_league_admin(league_id));
CREATE POLICY predictions_select_owner_or_public ON public.predictions FOR SELECT TO authenticated USING((user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=predictions.event_id AND public.is_league_member(e.league_id))) OR public.is_prediction_public(event_id));
CREATE POLICY predictions_insert_self_before_deadline ON public.predictions FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid() AND public.is_prediction_open(event_id));
CREATE POLICY predictions_update_self_before_deadline ON public.predictions FOR UPDATE TO authenticated USING(user_id=auth.uid() AND public.is_prediction_open(event_id)) WITH CHECK(user_id=auth.uid() AND public.is_prediction_open(event_id));
CREATE POLICY predictions_delete_self_before_deadline ON public.predictions FOR DELETE TO authenticated USING(user_id=auth.uid() AND public.is_prediction_open(event_id));
CREATE POLICY result_admin ON public.results FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=results.event_id AND public.is_league_admin(e.league_id))) WITH CHECK(EXISTS(SELECT 1 FROM public.events e WHERE e.id=results.event_id AND public.is_league_admin(e.league_id)));
CREATE POLICY score_admin ON public.scores FOR ALL TO authenticated USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=scores.event_id AND public.is_league_admin(e.league_id))) WITH CHECK(EXISTS(SELECT 1 FROM public.events e WHERE e.id=scores.event_id AND public.is_league_admin(e.league_id)));
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.events,public.predictions,public.results,public.scores TO authenticated;
GRANT USAGE ON SEQUENCE public.predictions_id_seq TO authenticated;
INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002'),('00000000-0000-0000-0000-000000000003');
INSERT INTO public.profiles(id,auth_user_id,display_name) SELECT id,id,'Fixture' FROM auth.users;
INSERT INTO public.leagues VALUES
 ('00000000-0000-0000-0000-000000000010','Fixture Club','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000020','Other Club','00000000-0000-0000-0000-000000000003');
INSERT INTO public.league_members VALUES
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','owner','active'),
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','member','active'),
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','owner','active');
CREATE TEMP TABLE inputs AS SELECT
 '{"version":1,"candidates":[{"id":"a","label":"A","multiplierTenths":10},{"id":"b","label":"B","multiplierTenths":13},{"id":"c","label":"C","multiplierTenths":16},{"id":"d","label":"D","multiplierTenths":19}]}'::jsonb config,
 '{"version":1,"candidateIds":["a","b","c","d"]}'::jsonb pick;
GRANT SELECT ON inputs TO authenticated;
INSERT INTO public.events VALUES
 ('legacy','00000000-0000-0000-0000-000000000010','old','koshien','open',now()+interval '1 day','{}','00000000-0000-0000-0000-000000000001','baseball'),
 ('expired','00000000-0000-0000-0000-000000000010','past','ranking_v1','open',now()-interval '1 day',(SELECT config FROM inputs),'00000000-0000-0000-0000-000000000001','baseball'),
 ('expired-draft','00000000-0000-0000-0000-000000000010','draft','ranking_v1','draft',now()-interval '1 day',(SELECT config FROM inputs),'00000000-0000-0000-0000-000000000001','baseball'),
 ('management-expired','00000000-0000-0000-0000-000000000010','expired','ranking_v1','open',now()-interval '1 day',(SELECT config FROM inputs),'00000000-0000-0000-0000-000000000001','baseball');
INSERT INTO public.predictions(event_id,user_id,payload) VALUES
 ('legacy','00000000-0000-0000-0000-000000000001','{"legacy":true}'),
 ('expired','00000000-0000-0000-0000-000000000001',(SELECT pick FROM inputs)),
 ('expired-draft','00000000-0000-0000-0000-000000000001',(SELECT pick FROM inputs));
INSERT INTO public.results VALUES('legacy','{"legacy":true}','00000000-0000-0000-0000-000000000001');
INSERT INTO public.players(id,league_id,profile_id) VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001'),
 ('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002'),
 ('00000000-0000-0000-0000-000000000013','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003');
INSERT INTO public.scores(event_id,player_id,phase1_score) VALUES('legacy','00000000-0000-0000-0000-000000000001',25);
-- Prove the old prototype's write shape cannot work even as the fixture owner.
DO $f$ BEGIN
 BEGIN
  INSERT INTO public.scores(event_id,player_id,total_score)
  VALUES('legacy','00000000-0000-0000-0000-000000000012',999);
  RAISE EXCEPTION 'generated total accepted explicit insert';
 EXCEPTION WHEN SQLSTATE '428C9' THEN NULL; END;
 IF (SELECT total_score FROM public.scores WHERE event_id='legacy') IS DISTINCT FROM 25::numeric THEN
  RAISE EXCEPTION 'generated total fixture mismatch';
 END IF;
END $f$;
INSERT INTO public.events
 SELECT x.id,'00000000-0000-0000-0000-000000000010','Finalize fixture','ranking_v1','resultWait',now()-interval '1 day',
 (SELECT config FROM inputs),'00000000-0000-0000-0000-000000000001','baseball'
 FROM (VALUES('finalize-case'),('missing-player'),('invalid-saved'),('empty-submissions')) x(id);
INSERT INTO public.predictions(event_id,user_id,payload) VALUES
 ('finalize-case','00000000-0000-0000-0000-000000000001',(SELECT pick FROM inputs)),
 ('finalize-case','00000000-0000-0000-0000-000000000002','{"version":1,"candidateIds":["b","a","d","c"]}'),
 ('missing-player','00000000-0000-0000-0000-000000000003',(SELECT pick FROM inputs)),
 ('invalid-saved','00000000-0000-0000-0000-000000000001','{"version":1,"candidateIds":["a","a","b","c"]}');
CREATE TEMP TABLE legacy_snapshot AS SELECT jsonb_build_array(
 (SELECT to_jsonb(e) FROM public.events e WHERE id='legacy'),
 (SELECT to_jsonb(p) FROM public.predictions p WHERE event_id='legacy'),
 (SELECT to_jsonb(r) FROM public.results r WHERE event_id='legacy'),
 (SELECT to_jsonb(s) FROM public.scores s WHERE event_id='legacy')) AS state;
-- Reproduce existing early-publication path in a rolled-back subtransaction.
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $f$ BEGIN
 BEGIN
  UPDATE public.events SET status='resultWait' WHERE id='legacy';
  IF NOT public.is_prediction_public('legacy') THEN RAISE EXCEPTION 'baseline not reproduced'; END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback probe';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
END $f$;
RESET ROLE;
