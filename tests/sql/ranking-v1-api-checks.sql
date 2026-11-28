-- After finalization checks and before account removal, in same CI transaction.
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
SET LOCAL ROLE authenticated;
DO $f$ DECLARE club uuid:='00000000-0000-0000-0000-000000000010'; me uuid:=auth.uid(); a jsonb; p jsonb;
BEGIN
 a:=public.ranking_v1_api_list(club,me);
 IF a->>'actorId'<>me::text OR a->>'leagueId'<>club::text OR a->'truncated'<>'false'::jsonb
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(a->'events') x WHERE x->>'id'='legacy')
  OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'events') x WHERE x->>'id'='new')
 THEN RAISE EXCEPTION 'catalog scope mismatch'; END IF;
 a:=public.ranking_v1_api_snapshot(club,'new',me);
 IF a->'canSubmit'<>'true'::jsonb OR a->'canManage'<>'false'::jsonb OR a->'predictionsPublic'<>'false'::jsonb
  OR a->'publishedPredictions'<>'[]'::jsonb OR a->'ranking'<>'[]'::jsonb OR a->'result'<>'null'::jsonb
  OR a->'ownPrediction'->'candidateIds'->>0<>'b' THEN RAISE EXCEPTION 'private snapshot mismatch %',a; END IF;
 p:=a->'ownPrediction';
 a:=public.ranking_v1_api_save(club,'new',me,p);
 IF a->'prediction' IS DISTINCT FROM p OR a->>'eventId'<>'new' THEN RAISE EXCEPTION 'save response mismatch'; END IF;
 a:=public.ranking_v1_api_snapshot(club,'finalize-case',me);
 IF a->'predictionsPublic'<>'true'::jsonb OR a->'canSubmit'<>'false'::jsonb
  OR jsonb_array_length(a->'publishedPredictions')<>2 OR jsonb_array_length(a->'ranking')<>2
  OR (a->'ranking'->0->>'score')::numeric<>32.8 OR (a->'ranking'->1->>'score')::numeric<>11.6
  OR (a->'ranking'->0->>'rank')::integer<>1 OR (a->'ranking'->1->>'rank')::integer<>2
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(a->'publishedPredictions') x WHERE x ? 'userId')
 THEN RAISE EXCEPTION 'published snapshot mismatch %',a; END IF;
 BEGIN PERFORM public.ranking_v1_api_snapshot(club,'legacy',me); RAISE EXCEPTION 'legacy exposed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ranking_v1_api_save(club,'new','00000000-0000-0000-0000-000000000001',p); RAISE EXCEPTION 'actor mismatch accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ranking_v1_api_save(club,'expired',me,p); RAISE EXCEPTION 'late API save accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ranking_v1_api_review(club,'expired',me); RAISE EXCEPTION 'member review accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
DO $f$ DECLARE club uuid:='00000000-0000-0000-0000-000000000010'; me uuid:=auth.uid();
BEGIN
 BEGIN PERFORM public.ranking_v1_api_list(club,me); RAISE EXCEPTION 'outsider listed events';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ranking_v1_api_snapshot(club,'finalize-case',me); RAISE EXCEPTION 'outsider read snapshot';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ranking_v1_api_finalize(club,'expired',me,repeat('0',32),(SELECT pick FROM inputs)); RAISE EXCEPTION 'outsider finalized';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
DO $f$ DECLARE club uuid:='00000000-0000-0000-0000-000000000010'; me uuid:=auth.uid(); a jsonb; rev text; p jsonb;
BEGIN
 p:=(SELECT pick FROM inputs);
 a:=public.ranking_v1_api_review(club,'expired',me); rev:=a->>'revision';
 a:=public.ranking_v1_api_finalize(club,'expired',me,rev,p);
 IF a->>'eventId'<>'expired' OR a->>'status'<>'finalized' OR a->'recovered'<>'false'::jsonb THEN RAISE EXCEPTION 'API finalize mismatch'; END IF;
 a:=public.ranking_v1_api_finalize(club,'expired',me,rev,p);
 IF a->'recovered'<>'true'::jsonb THEN RAISE EXCEPTION 'API retry mismatch'; END IF;
END $f$;
RESET ROLE;
DO $f$ BEGIN
 IF has_function_privilege('anon','public.ranking_v1_api_snapshot(uuid,text,uuid)','EXECUTE')
 OR has_function_privilege('anon','public.ranking_v1_api_save(uuid,text,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'anon RPC granted'; END IF;
END $f$;
SELECT 'PASS: scoped ranking API list, own save, private/public snapshots, server ranking, review/finalize, retry and denied access';
