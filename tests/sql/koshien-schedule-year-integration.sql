
-- All DDL and data changes here run in the disposable lifecycle DB only.
BEGIN;
ALTER TABLE public.matches ADD COLUMN starts_at timestamptz, ADD COLUMN metadata jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.results ADD COLUMN id uuid DEFAULT gen_random_uuid(), ADD COLUMN updated_by uuid,
 ADD COLUMN updated_at timestamptz DEFAULT now();
UPDATE public.events SET season='2026',created_by='00000000-0000-0000-0000-000000000001' WHERE id='test-finalize';
UPDATE public.results SET payload=jsonb_build_object('matches',(
 SELECT jsonb_agg(jsonb_build_object('round',round_key,'match_no',match_no,'status',status) ORDER BY round_key,match_no)
 FROM public.matches WHERE event_id='test-finalize')) WHERE event_id='test-finalize';
CREATE ROLE fixture_schedule_service NOLOGIN;
GRANT USAGE ON SCHEMA public TO fixture_schedule_service;
REVOKE ALL ON FUNCTION public.sync_koshien_official_schedule(text,jsonb,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_sync_koshien_official_schedule(text,jsonb,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_sync_koshien_late_schedule(text,jsonb,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_koshien_official_schedule(text,jsonb,text,timestamptz) TO authenticated,fixture_schedule_service;
GRANT EXECUTE ON FUNCTION public.auto_sync_koshien_official_schedule(text,jsonb,text,timestamptz),
 public.auto_sync_koshien_late_schedule(text,jsonb,text,timestamptz) TO fixture_schedule_service;

CREATE TEMP TABLE fixture_schedule_inputs AS
SELECT
 jsonb_agg(row_payload ORDER BY round_key,match_no) FILTER(WHERE round_key IN ('R1','R2')) AS early,
 jsonb_agg(row_payload ORDER BY round_key,match_no) FILTER(WHERE round_key='R3' AND match_no=1) AS late,
 jsonb_agg(jsonb_set(row_payload,'{starts_at}','"2027-08-10T08:00:00+09:00"') ORDER BY round_key,match_no) FILTER(WHERE round_key IN ('R1','R2')) AS early_wrong,
 jsonb_agg(jsonb_set(row_payload,'{starts_at}','"2026-12-31T16:00:00Z"') ORDER BY round_key,match_no) FILTER(WHERE round_key='R3' AND match_no=1) AS late_wrong
FROM (SELECT round_key,match_no,jsonb_build_object('round_key',round_key,'match_no',match_no,
 'starts_at','2026-08-10T08:00:00+09:00','tournament_day_no',1,'daily_match_no',1) AS row_payload
 FROM public.matches WHERE event_id='test-finalize') x;
GRANT SELECT ON fixture_schedule_inputs TO authenticated,fixture_schedule_service;
CREATE TEMP TABLE fixture_schedule_baseline AS SELECT
 (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.matches m) AS matches,
 (SELECT jsonb_agg(to_jsonb(r) ORDER BY event_id) FROM public.results r) AS results,
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY event_id,player_id) FROM public.scores s) AS scores,
 (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.events e) AS events;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
-- Reproduce actual missing-year checks before installing the candidate.
DO $$ DECLARE v jsonb; BEGIN
 BEGIN
  v:=public.sync_koshien_official_schedule('test-finalize',(SELECT early_wrong FROM fixture_schedule_inputs),
    'https://www.jhbf.or.jp/sensyuken/2027/schedule/','2026-08-01T00:00:00Z');
  IF v->>'count' IS DISTINCT FROM '33' OR NOT EXISTS(SELECT 1 FROM public.matches
   WHERE event_id='test-finalize' AND extract(year FROM starts_at AT TIME ZONE 'Asia/Tokyo')=2027) THEN
   RAISE EXCEPTION 'expected baseline wrong-year write was not reproduced';
  END IF;
  RAISE EXCEPTION USING ERRCODE='ZX001',MESSAGE='rollback baseline reproduction';
 EXCEPTION WHEN SQLSTATE 'ZX001' THEN NULL; END;
END $$;
RESET ROLE;

-- @include supabase/release-candidates/koshien-official-integrity/schedule-year.sql

-- Test manual RPC through the existing admin role, and automated RPCs through
-- a role with only execution permission. Exact error proves year guard fired.
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.sync_koshien_official_schedule('test-finalize',(SELECT early_wrong FROM fixture_schedule_inputs),
   'https://www.jhbf.or.jp/sensyuken/2027/schedule/','2026-08-01T00:00:00Z');
  RAISE EXCEPTION 'manual wrong year accepted';
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM<>'official schedule year must match saved Koshien season' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.sync_koshien_official_schedule('test-finalize',(SELECT early FROM fixture_schedule_inputs),
   'https://www.jhbf.or.jp/sensyuken/2027/schedule/','2026-08-01T00:00:00Z');
  RAISE EXCEPTION 'manual wrong source accepted';
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM<>'official schedule year must match saved Koshien season' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
SET ROLE fixture_schedule_service;
DO $$ BEGIN
 BEGIN
  PERFORM public.auto_sync_koshien_official_schedule('test-finalize',(SELECT early_wrong FROM fixture_schedule_inputs),
   'https://www.jhbf.or.jp/sensyuken/2026/schedule/','2026-08-01T00:00:00Z');
  RAISE EXCEPTION 'automatic wrong row year accepted';
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM<>'official schedule year must match saved Koshien season' THEN RAISE; END IF;
 END;
 BEGIN
  PERFORM public.auto_sync_koshien_late_schedule('test-finalize',(SELECT late_wrong FROM fixture_schedule_inputs),
   'https://www.jhbf.or.jp/sensyuken/2026/schedule/','2026-08-01T00:00:00Z');
  RAISE EXCEPTION 'JST new-year boundary accepted';
 EXCEPTION WHEN invalid_parameter_value THEN
  IF SQLERRM<>'official schedule year must match saved Koshien season' THEN RAISE; END IF;
 END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM fixture_schedule_baseline b WHERE
  b.matches IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.matches m)
  OR b.results IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(r) ORDER BY event_id) FROM public.results r)
  OR b.scores IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY event_id,player_id) FROM public.scores s)
  OR b.events IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(e) ORDER BY id) FROM public.events e))
 THEN RAISE EXCEPTION 'invalid schedules mutated persistent state'; END IF;
END $$;

-- Existing permission boundary remains unchanged.
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET ROLE authenticated;
DO $$ BEGIN
 BEGIN
  PERFORM public.sync_koshien_official_schedule('test-finalize',(SELECT early FROM fixture_schedule_inputs),
   'https://www.jhbf.or.jp/sensyuken/2026/schedule/','2026-08-01T00:00:00Z');
  RAISE EXCEPTION 'member schedule mutation accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  PERFORM public.auto_sync_koshien_official_schedule('test-finalize','[]','','2026-08-01T00:00:00Z');
  RAISE EXCEPTION 'member can execute service-only RPC';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
DO $$ DECLARE v jsonb; BEGIN
 v:=public.sync_koshien_official_schedule('test-finalize',(SELECT early FROM fixture_schedule_inputs),
   'https://www.jhbf.or.jp/sensyuken/2026/schedule/','2026-08-01T00:00:00Z');
 IF v->>'count' IS DISTINCT FROM '33' OR v->>'changed' IS DISTINCT FROM '33' THEN RAISE EXCEPTION 'valid manual schedule failed: %',v; END IF;
 v:=public.sync_koshien_official_schedule('test-finalize',(SELECT early FROM fixture_schedule_inputs),
   'https://www.jhbf.or.jp/sensyuken/2026/schedule/','2026-08-01T00:00:00Z');
 IF v->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'manual retry changed state: %',v; END IF;
END $$;
RESET ROLE;
SET ROLE fixture_schedule_service;
DO $$ DECLARE v jsonb; BEGIN
 v:=public.auto_sync_koshien_official_schedule('test-finalize',(SELECT early FROM fixture_schedule_inputs),
   'https://www.jhbf.or.jp/sensyuken/2026/schedule/','2026-08-01T00:00:00Z');
 IF v->>'count' IS DISTINCT FROM '33' THEN RAISE EXCEPTION 'valid automatic schedule failed: %',v; END IF;
 v:=public.auto_sync_koshien_late_schedule('test-finalize',(SELECT late FROM fixture_schedule_inputs),
   'https://www.jhbf.or.jp/sensyuken/2026/schedule/','2026-08-01T00:00:00Z');
 IF v->>'count' IS DISTINCT FROM '1' OR v->>'changed' IS DISTINCT FROM '1' THEN RAISE EXCEPTION 'valid late schedule failed: %',v; END IF;
 v:=public.auto_sync_koshien_late_schedule('test-finalize',(SELECT late FROM fixture_schedule_inputs),
   'https://www.jhbf.or.jp/sensyuken/2026/schedule/','2026-08-01T00:00:00Z');
 IF v->>'idempotent' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'late retry changed state: %',v; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.matches WHERE event_id='test-finalize' AND starts_at IS NOT NULL)<>34
 OR EXISTS(SELECT 1 FROM public.matches WHERE event_id='test-finalize' AND starts_at IS NOT NULL AND extract(year FROM starts_at AT TIME ZONE 'Asia/Tokyo')<>2026)
 OR EXISTS(SELECT 1 FROM fixture_schedule_baseline b WHERE b.scores IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(s) ORDER BY event_id,player_id) FROM public.scores s))
 THEN RAISE EXCEPTION 'normal schedule path changed wrong rows or scores'; END IF;
END $$;
-- Prove exact rollback restores original definitions/ACL.
CREATE TEMP TABLE schedule_candidate_acl AS
 SELECT oid,proowner,proacl,prosecdef,proconfig FROM pg_proc WHERE oid IN
 ('public.sync_koshien_official_schedule(text,jsonb,text,timestamptz)'::regprocedure,
 'public.auto_sync_koshien_official_schedule(text,jsonb,text,timestamptz)'::regprocedure,
 'public.auto_sync_koshien_late_schedule(text,jsonb,text,timestamptz)'::regprocedure);
-- @include supabase/release-candidates/koshien-official-integrity/rollback-schedule-year.sql
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM schedule_candidate_acl x JOIN pg_proc p USING(oid)
 WHERE p.proowner IS DISTINCT FROM x.proowner OR p.proacl IS DISTINCT FROM x.proacl
 OR p.prosecdef IS DISTINCT FROM x.prosecdef OR p.proconfig IS DISTINCT FROM x.proconfig)
 THEN RAISE EXCEPTION 'schedule rollback changed privileges or security configuration'; END IF;
END $$;
DO $$ BEGIN
 IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.sync_koshien_official_schedule(text,jsonb,text,timestamptz)'::regprocedure) IS DISTINCT FROM 'f4d88cf0af5dc2ad05dbe9a4112e5c7a'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.auto_sync_koshien_official_schedule(text,jsonb,text,timestamptz)'::regprocedure) IS DISTINCT FROM '83e20d3234af222b63d747cf34230346'
 OR (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.auto_sync_koshien_late_schedule(text,jsonb,text,timestamptz)'::regprocedure) IS DISTINCT FROM '068de18f22a1195cdca346daf5bbf4f5'
 THEN RAISE EXCEPTION 'original RPC bodies not restored'; END IF;
END $$;
SELECT 'PASS: exact schedule rollback restores original bodies and preserves ACL/security';
ROLLBACK;
-- The captured functions are installed by the workflow before this transaction.
-- Candidate body changes, roles, columns and data are rolled back.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='matches' AND column_name='starts_at')
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='fixture_schedule_service')
 OR EXISTS(SELECT 1 FROM public.events WHERE id='test-finalize' AND season IS NOT NULL)
 THEN RAISE EXCEPTION 'schedule year fixture leaked state'; END IF;
END $$;
SELECT 'PASS: reproduced wrong-year write, candidate rejects manual/auto/late mismatches and JST boundary, permission and valid retries preserved';
