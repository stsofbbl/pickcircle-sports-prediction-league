-- #56: existing production INSERT RLS semantics against disposable fixture only.
BEGIN;
ALTER TABLE public.events ADD COLUMN name text;
ALTER TABLE public.events ADD COLUMN season text;
ALTER TABLE public.events ADD COLUMN prediction_deadline timestamptz;
ALTER TABLE public.events ADD COLUMN created_by uuid;
ALTER TABLE public.events ADD CONSTRAINT draft_fixture_status_check CHECK (status IN ('draft','open','resultWait','finalized','archive'));
GRANT INSERT ON public.events TO authenticated;
CREATE POLICY events_insert_admin ON public.events FOR INSERT TO authenticated
 WITH CHECK (created_by=(SELECT auth.uid()) AND public.is_league_admin(league_id));
INSERT INTO public.leagues VALUES ('00000000-0000-0000-0000-000000000020');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
INSERT INTO public.events(id,league_id,preset_type,status,rules,name,season,prediction_deadline,created_by)
VALUES ('test-new-draft','00000000-0000-0000-0000-000000000010','koshien','draft',
 '{"approvalPolicy":"admin","resultFlow":{"status":"none"},"config":{"teams":[],"startRoundsConfirmed":false,"externalResults":{"competitionType":"summer","year":2027}}}',
 'New draft','2027',now()+interval '1 year',auth.uid());
DO $check$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.events WHERE id='test-new-draft'
  AND status='draft' AND season='2027' AND rules->>'approvalPolicy'='admin') THEN
  RAISE EXCEPTION 'draft was not created correctly';
 END IF;
 BEGIN
  INSERT INTO public.events(id,league_id,preset_type,status,created_by)
  VALUES ('test-new-draft','00000000-0000-0000-0000-000000000010','koshien','draft',auth.uid());
  RAISE EXCEPTION 'duplicate ID inserted';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.events(id,league_id,preset_type,status,created_by)
  VALUES ('cross-club-draft','00000000-0000-0000-0000-000000000020','koshien','draft',auth.uid());
  RAISE EXCEPTION 'cross-club insert succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.events(id,league_id,preset_type,status,created_by)
  VALUES ('forged-draft','00000000-0000-0000-0000-000000000010','koshien','draft','00000000-0000-0000-0000-000000000002');
  RAISE EXCEPTION 'forged creator succeeded';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $check$;
RESET ROLE;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
DO $member$ BEGIN
 BEGIN
  INSERT INTO public.events(id,league_id,preset_type,status,created_by)
  VALUES ('member-draft','00000000-0000-0000-0000-000000000010','koshien','draft',auth.uid());
  RAISE EXCEPTION 'member inserted draft';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $member$;
RESET ROLE;
DO $data$ BEGIN
 IF (SELECT count(*) FROM public.events WHERE id='test-new-draft')<>1
 OR EXISTS(SELECT 1 FROM public.teams WHERE event_id='test-new-draft')
 OR EXISTS(SELECT 1 FROM public.matches WHERE event_id='test-new-draft')
 OR EXISTS(SELECT 1 FROM public.scores WHERE event_id='test-new-draft')
 OR EXISTS(SELECT 1 FROM public.results WHERE event_id='test-new-draft')
 OR (SELECT count(*) FROM public.matches WHERE event_id='test-finalize')<>48
 THEN RAISE EXCEPTION 'new draft touched existing event or fabricated data'; END IF;
END $data$;
ROLLBACK;
SELECT 'PASS: explicit new draft INSERT, duplicate and RLS denial, existing event unchanged';
