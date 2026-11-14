-- Included inside phase3-visibility.sql's disposable transaction.
-- Real production RPC/refresh bodies; dependency tables are minimal fixtures.
-- No phase2 draft rows/triggers are exercised by these phase3-only scenarios.
ALTER TABLE public.league_members ADD COLUMN role text DEFAULT 'member';
ALTER TABLE public.players ADD COLUMN display_name text;
ALTER TABLE public.koshien_later_rounds
 ADD COLUMN start_mode text DEFAULT 'automatic',
 ADD COLUMN end_mode text DEFAULT 'automatic',
 ADD COLUMN opens_at timestamptz,
 ADD COLUMN deadline_at timestamptz,
 ADD COLUMN locked_at timestamptz,
 ADD COLUMN updated_at timestamptz,
 ADD COLUMN version integer DEFAULT 0;
ALTER TABLE public.final_score_predictions
 ADD COLUMN predicted_score_a integer DEFAULT 1,
 ADD COLUMN predicted_score_b integer DEFAULT 0,
 ADD COLUMN predicted_tiebreak_score_a integer DEFAULT 0,
 ADD COLUMN predicted_tiebreak_score_b integer DEFAULT 0;
CREATE TABLE public.phase2_drafts (event_id text, status text, deadline_at timestamptz);
CREATE TABLE public.koshien_revenge_eligibility (event_id text, player_id uuid);
CREATE TABLE public.revenge_picks (event_id text, player_id uuid);
CREATE TABLE public.koshien_zombie_eligibility (event_id text, player_id uuid);
CREATE TABLE public.zombie_predictions (
 event_id text, player_id uuid, team_id uuid, created_at timestamptz, updated_at timestamptz);
CREATE TABLE public.teams (id uuid PRIMARY KEY, event_id text, name text, sqrt_odds numeric);
CREATE TABLE public.scores (
 event_id text, player_id uuid, phase1_score numeric, revenge_score numeric,
 phase2_score numeric, zombie_score numeric, phase3_score numeric,
 total_score numeric, breakdown jsonb);
\ir fixtures/phase3-production-constraints.sql
\ir fixtures/phase3-production-functions.sql

UPDATE public.league_members SET membership_status='active';
UPDATE public.koshien_later_rounds
 SET status='open', opens_at=clock_timestamp()-interval '2 days',
 deadline_at=clock_timestamp()+interval '1 day', version=0
 WHERE event_id='event' AND phase_key='phase3';

CREATE FUNCTION public.assert_phase3_rpc(expected_count integer, expected_status text, label text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE payload jsonb; actual_count integer;
BEGIN
 IF current_user <> 'yoso_phase3_test_member' THEN RAISE EXCEPTION 'Test role required'; END IF;
 payload := public.get_koshien_later_phase_state('event');
 actual_count := jsonb_array_length(payload #> '{phase3,predictions}');
 IF actual_count <> expected_count
 OR payload #>> '{rounds,phase3,status}' IS DISTINCT FROM expected_status
 OR payload #>> '{phase3,prediction,player_id}' IS DISTINCT FROM '10000000-0000-0000-0000-000000000001' THEN
   RAISE EXCEPTION '%: unexpected RPC payload %',label,payload;
 END IF;
 IF (SELECT count(*) FROM public.final_score_predictions WHERE event_id='event')
    <> (CASE WHEN expected_count=0 THEN 1 ELSE expected_count END) THEN
   RAISE EXCEPTION '%: RPC and direct SELECT disagree',label;
 END IF;
 RAISE NOTICE 'PASS RPC: %',label;
END $$;

SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE yoso_phase3_test_member;
SELECT public.assert_phase3_rpc(0,'open','before final deadline: own only');
RESET ROLE;

-- At the captured deadline, every subsequent clock_timestamp() is >= deadline.
UPDATE public.koshien_later_rounds SET deadline_at=clock_timestamp()
 WHERE event_id='event' AND phase_key='phase3';
SET LOCAL ROLE yoso_phase3_test_member;
SELECT public.assert_phase3_rpc(2,'locked','deadline reached: refresh locks before RPC publishes');
SELECT public.assert_phase3_rpc(2,'locked','repeated read preserves locked visibility');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT version FROM public.koshien_later_rounds WHERE event_id='event' AND phase_key='phase3') <> 1 THEN
   RAISE EXCEPTION 'Repeated RPC must not repeatedly increment locked version';
 END IF;
END $$;

UPDATE public.koshien_later_rounds
 SET status='open',deadline_at=clock_timestamp()-interval '1 day'
 WHERE event_id='event' AND phase_key='phase3';
SET LOCAL ROLE yoso_phase3_test_member;
SELECT public.assert_phase3_rpc(2,'locked','after final deadline: public to members');
RESET ROLE;

UPDATE public.koshien_later_rounds SET status='open',end_mode='manual'
 WHERE event_id='event' AND phase_key='phase3';
SET LOCAL ROLE yoso_phase3_test_member;
SELECT public.assert_phase3_rpc(0,'open','manual end remains private despite past deadline');
RESET ROLE;

UPDATE public.koshien_later_rounds
 SET status='ready',end_mode='automatic',opens_at=clock_timestamp()-interval '2 days',
 deadline_at=clock_timestamp()+interval '1 day'
 WHERE event_id='event' AND phase_key='phase3';
SET LOCAL ROLE yoso_phase3_test_member;
SELECT public.assert_phase3_rpc(0,'open','automatic opening does not publish predictions');
RESET ROLE;

UPDATE public.koshien_later_rounds SET status='completed'
 WHERE event_id='event' AND phase_key='phase3';
SET LOCAL ROLE yoso_phase3_test_member;
SELECT public.assert_phase3_rpc(2,'completed','completed phase remains published');
RESET ROLE;

-- Unauthorized RPC must reject BEFORE mutating an expired open round.
UPDATE public.koshien_later_rounds SET status='open',deadline_at=clock_timestamp()-interval '1 day',version=0
 WHERE event_id='event' AND phase_key='phase3';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
SET LOCAL ROLE yoso_phase3_test_member;
DO $$ BEGIN
 BEGIN
   PERFORM public.get_koshien_later_phase_state('event');
   RAISE EXCEPTION 'Outsider RPC unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 RAISE NOTICE 'PASS RPC: outsider denied';
END $$;
SET LOCAL request.jwt.claim.sub='';
DO $$ BEGIN
 BEGIN
   PERFORM public.get_koshien_later_phase_state('event');
   RAISE EXCEPTION 'Missing identity RPC unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 RAISE NOTICE 'PASS RPC: missing identity denied';
END $$;
RESET ROLE;
UPDATE public.league_members SET membership_status='inactive'
 WHERE user_id='00000000-0000-0000-0000-000000000001';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE yoso_phase3_test_member;
DO $$ BEGIN
 BEGIN
   PERFORM public.get_koshien_later_phase_state('event');
   RAISE EXCEPTION 'Removed owner RPC unexpectedly succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
 RAISE NOTICE 'PASS RPC: removed owner denied';
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.koshien_later_rounds
 WHERE event_id='event' AND phase_key='phase3' AND status='open' AND version=0) THEN
   RAISE EXCEPTION 'Unauthorized RPC changed phase state';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.koshien_later_rounds
 WHERE event_id='other-event' AND phase_key='phase3' AND version=0) THEN
   RAISE EXCEPTION 'RPC changed another event';
 END IF;
 RAISE NOTICE 'PASS RPC: rejected calls and other event retain state';
END $$;
