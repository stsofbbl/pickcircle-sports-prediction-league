-- Disposable PostgreSQL ONLY. All additions and test records roll back.
BEGIN;
ALTER TABLE public.events ADD COLUMN season text;
ALTER TABLE public.events ADD COLUMN prediction_deadline timestamptz;
ALTER TABLE public.teams ADD COLUMN name text;
ALTER TABLE public.teams ADD COLUMN start_round integer;
ALTER TABLE public.teams ADD COLUMN metadata jsonb;
ALTER TABLE public.event_teams ADD COLUMN name text;
ALTER TABLE public.event_teams ADD COLUMN metadata jsonb;
\i supabase/migrations/20261124100000_guard_koshien_draft_open.sql

INSERT INTO public.events(id,league_id,preset_type,status,rules,season,prediction_deadline)
VALUES ('test-open-draft','00000000-0000-0000-0000-000000000010','koshien','draft',
 '{"approvalPolicy":"admin","resultFlow":{"status":"none"},"config":{"teams":[],"startRoundsConfirmed":false,"externalResults":{"competitionType":"summer","year":2027}}}',
 '2027',now()+interval '1 year');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $empty$ BEGIN
 BEGIN
   PERFORM public.open_koshien_draft('test-open-draft',public.koshien_admin_result_revision('test-open-draft'));
   RAISE EXCEPTION 'empty draft opened';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
   UPDATE public.events SET status='open' WHERE id='test-open-draft';
   RAISE EXCEPTION 'direct update bypassed roster validation';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
   UPDATE public.events SET status='resultWait' WHERE id='test-open-draft';
   RAISE EXCEPTION 'draft skipped opening';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $empty$;
RESET ROLE;
WITH districts AS (
 SELECT district, ordinal::integer n
 FROM unnest(ARRAY[
    '北北海道','南北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉',
    '千葉','東東京','西東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡',
    '愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島',
    '山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'
 ]) WITH ORDINALITY d(district,ordinal)
)
INSERT INTO public.teams(event_id,name,start_round,metadata)
SELECT 'test-open-draft','Fixture school '||n,CASE WHEN n<=34 THEN 1 ELSE 2 END,
 jsonb_build_object('district',district,'representative_key','fixture:'||n,'source','jhbf','source_year',2027)
FROM districts;
INSERT INTO public.event_teams(event_id,name,metadata)
SELECT event_id,name,metadata||jsonb_build_object('startRound',start_round)
FROM public.teams WHERE event_id='test-open-draft';
UPDATE public.events SET rules=jsonb_set(rules,'{config}',
 jsonb_build_object('teams',(SELECT jsonb_agg(name ORDER BY name) FROM public.teams WHERE event_id='test-open-draft'),
 'startRoundsConfirmed',true,'externalResults',jsonb_build_object('competitionType','summer','year',2027)))
 WHERE id='test-open-draft';
SET LOCAL ROLE authenticated;
DO $stale$ BEGIN
 BEGIN
  PERFORM public.open_koshien_draft('test-open-draft',repeat('0',32));
  RAISE EXCEPTION 'stale revision accepted';
 EXCEPTION WHEN serialization_failure THEN NULL; END;
END $stale$;
RESET ROLE;
UPDATE public.teams SET metadata=jsonb_set(metadata,'{source_year}','2026') WHERE event_id='test-open-draft' AND name='Fixture school 1';
SET LOCAL ROLE authenticated;
DO $year$ BEGIN
 BEGIN
  PERFORM public.open_koshien_draft('test-open-draft',public.koshien_admin_result_revision('test-open-draft'));
  RAISE EXCEPTION 'wrong roster year accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $year$;
RESET ROLE;
UPDATE public.teams SET metadata=jsonb_set(metadata,'{source_year}','2027') WHERE event_id='test-open-draft' AND name='Fixture school 1';
UPDATE public.event_teams SET metadata=jsonb_set(metadata,'{startRound}','2') WHERE event_id='test-open-draft' AND name='Fixture school 1';
SET LOCAL ROLE authenticated;
DO $mismatch$ BEGIN
 BEGIN
  PERFORM public.open_koshien_draft('test-open-draft',public.koshien_admin_result_revision('test-open-draft'));
  RAISE EXCEPTION 'mismatching start rounds accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $mismatch$;
RESET ROLE;
UPDATE public.event_teams SET metadata=jsonb_set(metadata,'{startRound}','1') WHERE event_id='test-open-draft' AND name='Fixture school 1';
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
DO $member$ BEGIN
 BEGIN
  PERFORM public.open_koshien_draft('test-open-draft',public.koshien_admin_result_revision('test-open-draft'));
  RAISE EXCEPTION 'member opened draft';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $member$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.open_koshien_draft('test-open-draft',public.koshien_admin_result_revision('test-open-draft'));
DO $opened$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id='test-open-draft' AND status='open')
   OR (SELECT count(*) FROM public.teams WHERE event_id='test-open-draft')<>49
   OR (SELECT count(*) FROM public.event_teams WHERE event_id='test-open-draft')<>49
   OR (SELECT count(*) FROM public.matches WHERE event_id='test-finalize')<>48
   OR EXISTS(SELECT 1 FROM public.scores WHERE event_id='test-open-draft')
   OR EXISTS(SELECT 1 FROM public.results WHERE event_id='test-open-draft')
 THEN RAISE EXCEPTION 'open transition changed unintended data'; END IF;
 BEGIN
  PERFORM public.open_koshien_draft('test-open-draft',public.koshien_admin_result_revision('test-open-draft'));
  RAISE EXCEPTION 'second open accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
END $opened$;
RESET ROLE;
DO $grants$ BEGIN
 IF has_function_privilege('anon','public.open_koshien_draft(text,text)','EXECUTE')
 OR NOT has_function_privilege('authenticated','public.open_koshien_draft(text,text)','EXECUTE')
 THEN RAISE EXCEPTION 'RPC grants mismatch'; END IF;
END $grants$;
ROLLBACK;
SELECT 'PASS: guarded draft open, wrong year, stale revision, wrong roster and role rejected';
