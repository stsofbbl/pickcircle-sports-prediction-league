\set ON_ERROR_STOP on
-- Run ONLY against a fresh disposable database named yoso_phase3_rls_test.
-- psql -X -d yoso_phase3_rls_test -f tests/sql/phase3-visibility.sql
-- Minimal RLS contract fixture; not a replacement for full-schema/API tests.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'yoso_phase3_rls_test'
     OR to_regclass('public.events') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'auth') THEN
    RAISE EXCEPTION 'Requires fresh disposable yoso_phase3_rls_test database';
  END IF;
END $$;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
CREATE TABLE public.league_members (league_id uuid, user_id uuid, membership_status text);
CREATE TABLE public.events (id text PRIMARY KEY, league_id uuid, status text, prediction_deadline timestamptz);
CREATE TABLE public.players (id uuid PRIMARY KEY, league_id uuid, profile_id uuid);
CREATE TABLE public.koshien_later_rounds (event_id text, phase_key text, status text);
CREATE TABLE public.final_score_predictions (event_id text, player_id uuid);
CREATE FUNCTION public.is_league_member(p_league_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.league_members lm
 WHERE lm.league_id=p_league_id AND lm.user_id=(SELECT auth.uid())
 AND lm.membership_status='active');
$$;
CREATE FUNCTION public.is_prediction_public(p_event_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id
 AND public.is_league_member(e.league_id)
 AND (e.status IN ('resultWait','finalized','archive')
 OR (e.prediction_deadline IS NOT NULL AND now()>=e.prediction_deadline)));
$$;
CREATE FUNCTION public.is_prediction_open(p_event_id text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.id=p_event_id AND e.status='open'
 AND (e.prediction_deadline IS NULL OR now()<e.prediction_deadline)
 AND public.is_league_member(e.league_id));
$$;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.koshien_later_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_score_predictions ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_select_members ON public.events FOR SELECT TO authenticated USING (public.is_league_member(league_id));
CREATE POLICY players_select_members ON public.players FOR SELECT TO authenticated USING (public.is_league_member(league_id));
CREATE POLICY koshien_later_rounds_select_members ON public.koshien_later_rounds FOR SELECT TO authenticated
 USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_member(e.league_id)));
-- Include BOTH production permissive policies: ALL contributes to SELECT too.
CREATE POLICY final_score_predictions_select_owner_or_public ON public.final_score_predictions
 FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.players p WHERE p.id=player_id AND p.profile_id=(SELECT auth.uid()))
 OR public.is_prediction_public(event_id));
CREATE POLICY final_score_predictions_self_before_deadline ON public.final_score_predictions
 FOR ALL TO authenticated
 USING (public.is_prediction_open(event_id) AND EXISTS (
 SELECT 1 FROM public.players p WHERE p.id=player_id AND p.profile_id=(SELECT auth.uid())))
 WITH CHECK (public.is_prediction_open(event_id) AND EXISTS (
 SELECT 1 FROM public.players p WHERE p.id=player_id AND p.profile_id=(SELECT auth.uid())));
GRANT USAGE ON SCHEMA public, auth TO authenticated;
-- Production authenticated has no prediction INSERT/UPDATE/DELETE grant.
GRANT SELECT ON public.events,public.players,public.koshien_later_rounds,public.final_score_predictions TO authenticated;
INSERT INTO public.league_members VALUES
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','active'),
 ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002','active'),
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','active');
INSERT INTO public.events VALUES ('event','00000000-0000-0000-0000-000000000010','resultWait',now()-interval '1 day');
INSERT INTO public.players VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002');
INSERT INTO public.final_score_predictions VALUES ('event','10000000-0000-0000-0000-000000000001'),('event','10000000-0000-0000-0000-000000000002');
CREATE FUNCTION public.assert_visible(expected integer, label text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE actual integer;
BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=current_user AND (rolsuper OR rolbypassrls))
 OR current_user <> 'authenticated' THEN
   RAISE EXCEPTION 'Assertions must run as non-bypass test role';
 END IF;
 SELECT count(*) INTO actual FROM public.final_score_predictions;
 IF actual <> expected THEN RAISE EXCEPTION '%: expected %, got %',label,expected,actual; END IF;
 RAISE NOTICE 'PASS: %',label;
END $$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(2,'baseline reproduces early disclosure after event deadline');
RESET ROLE;
\ir ../../supabase/migrations/20261114123717_protect_phase3_prediction_visibility.sql
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(1,'owner only when phase3 is absent despite expired event deadline');
RESET ROLE;
INSERT INTO public.koshien_later_rounds VALUES ('event','zombie','completed'),('event','phase3','open');
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(1,'zombie completion does not publish open phase3');
RESET ROLE;
-- A completed round belonging to another event must not publish this event.
INSERT INTO public.events VALUES ('other-event','00000000-0000-0000-0000-000000000010','archive',now()-interval '1 day');
INSERT INTO public.koshien_later_rounds VALUES ('other-event','phase3','completed');
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(1,'another event phase3 does not publish current predictions');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
DO $$ BEGIN
 IF (SELECT player_id FROM public.final_score_predictions) IS DISTINCT FROM '10000000-0000-0000-0000-000000000002' THEN
   RAISE EXCEPTION 'Peer must see their own prediction only';
 END IF;
 RAISE NOTICE 'PASS: peer identity sees own row only';
END $$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SELECT public.assert_visible(0,'other league cannot read open phase3');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
RESET ROLE;
-- Transaction now() is stable: verify exact event deadline and either side.
UPDATE public.events SET status='open',prediction_deadline=now()-interval '1 microsecond' WHERE id='event';
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(1,'event deadline passed does not publish open phase3');
RESET ROLE;
UPDATE public.events SET prediction_deadline=now() WHERE id='event';
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(1,'exact event deadline does not publish open phase3');
RESET ROLE;
UPDATE public.events SET prediction_deadline=now()+interval '1 microsecond' WHERE id='event';
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(1,'before event deadline only owner visible');
RESET ROLE;
UPDATE public.events SET status='archive';
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(1,'archived event does not override phase3 visibility');
RESET ROLE;
UPDATE public.events SET status='open',prediction_deadline=now()+interval '1 day';
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(1,'ALL policy still limits open event to owner');
RESET ROLE;
UPDATE public.koshien_later_rounds SET status='locked' WHERE phase_key='phase3';
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(2,'manual phase3 lock publishes even before event deadline');
RESET ROLE;
UPDATE public.koshien_later_rounds SET status='completed' WHERE phase_key='phase3';
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(2,'completed phase3 remains visible');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SELECT public.assert_visible(0,'other league cannot read completed phase3');
SET LOCAL request.jwt.claim.sub='';
SELECT public.assert_visible(0,'missing identity cannot read completed phase3');
RESET ROLE;
UPDATE public.league_members SET membership_status='inactive'
 WHERE user_id='00000000-0000-0000-0000-000000000001';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.assert_visible(0,'removed owner cannot read even own prediction');
DO $$ BEGIN
 IF has_table_privilege(current_user,'public.final_score_predictions','INSERT')
 OR has_table_privilege(current_user,'public.final_score_predictions','UPDATE')
 OR has_table_privilege(current_user,'public.final_score_predictions','DELETE') THEN
   RAISE EXCEPTION 'Prediction write grants unexpectedly enabled';
 END IF;
END $$;
RESET ROLE;
\ir phase3-rpc-integration.sql
-- Match production: anon has SELECT grants but no applicable SELECT policies.
GRANT USAGE ON SCHEMA public, auth TO anon;
GRANT SELECT ON public.events, public.players, public.final_score_predictions TO anon;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET LOCAL ROLE anon;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.final_score_predictions) THEN
   RAISE EXCEPTION 'Anon read predictions even with a member identity claim';
 END IF;
 RAISE NOTICE 'PASS role: anon denied even with member identity claim';
END $$;
RESET ROLE;
ROLLBACK;
