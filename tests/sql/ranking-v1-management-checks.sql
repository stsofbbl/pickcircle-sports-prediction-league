-- Management layer installed after earlier direct-DML baseline tests.
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $f$ DECLARE club uuid:='00000000-0000-0000-0000-000000000010'; me uuid:=auth.uid();
 v_id text:='a0000000-0000-4000-8000-000000000001'; deadline timestamptz:=now()+interval '2 days';
 c jsonb:=(SELECT config FROM inputs); a jsonb; rev text; edited_rev text;
BEGIN
 a:=public.ranking_v1_api_create_draft(club,v_id,me,'New Cup','baseball',deadline,c);
 rev:=a->>'revision';
 IF a->>'status'<>'draft' OR a->'recovered'<>'false'::jsonb OR rev !~ '^[0-9a-f]{32}$' THEN RAISE EXCEPTION 'create failed'; END IF;
 a:=public.ranking_v1_api_create_draft(club,v_id,me,'New Cup','baseball',deadline,c);
 IF a->'recovered'<>'true'::jsonb OR a->>'revision'<>rev THEN RAISE EXCEPTION 'create recovery failed'; END IF;
 BEGIN PERFORM public.ranking_v1_api_create_draft(club,v_id,me,'Different','baseball',deadline,c); RAISE EXCEPTION 'create overwrite accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN PERFORM public.ranking_v1_api_create_draft(club,'a0000000-0000-4000-8000-000000000002',me,'New Cup','baseball',now()-interval '1 day',c); RAISE EXCEPTION 'past deadline accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN INSERT INTO public.events(id,league_id,name,preset_type,status,prediction_deadline,rules,created_by,sport_type)
 VALUES('direct-insert',club,'Direct','ranking_v1','draft',deadline,c,me,'baseball'); RAISE EXCEPTION 'direct create accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.events SET name='Direct' WHERE events.id=v_id; RAISE EXCEPTION 'direct draft edit accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.events SET status='open' WHERE events.id=v_id; RAISE EXCEPTION 'direct open accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO ranking_v1_private.management_permits VALUES(v_id,me,txid_current(),'open'); RAISE EXCEPTION 'forged permit';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 a:=public.ranking_v1_api_draft_review(club,v_id,me);
 IF a->>'revision'<>rev THEN RAISE EXCEPTION 'review mismatch'; END IF;
 a:=public.ranking_v1_api_edit_draft(club,v_id,me,rev,'Updated Cup','soccer',deadline,c);
 edited_rev:=a->>'revision';
 IF edited_rev=rev OR a->>'name'<>'Updated Cup' OR a->>'sportType'<>'soccer' THEN RAISE EXCEPTION 'draft edit failed'; END IF;
 BEGIN PERFORM public.ranking_v1_api_open(club,v_id,me,rev); RAISE EXCEPTION 'stale open accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 BEGIN PERFORM public.ranking_v1_api_edit_draft(club,v_id,me,rev,'Stale','baseball',deadline,c); RAISE EXCEPTION 'stale edit accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
 a:=public.ranking_v1_api_open(club,v_id,me,edited_rev);
 IF a->>'status'<>'open' OR a->'recovered'<>'false'::jsonb THEN RAISE EXCEPTION 'open failed'; END IF;
 a:=public.ranking_v1_api_open(club,v_id,me,edited_rev);
 IF a->'recovered'<>'true'::jsonb THEN RAISE EXCEPTION 'open retry failed'; END IF;
 BEGIN UPDATE public.events SET name='Direct after open' WHERE events.id=v_id; RAISE EXCEPTION 'opened name edit accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.events SET rules_config='{"changed":true}' WHERE events.id=v_id; RAISE EXCEPTION 'opened rules_config edit accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.events SET season='2030',current_phase='results',archived_at=now() WHERE events.id=v_id; RAISE EXCEPTION 'opened metadata edit accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 a:=public.ranking_v1_api_open(club,v_id,me,edited_rev);
 IF a->'recovered'<>'true'::jsonb OR a->>'name'<>'Updated Cup' THEN RAISE EXCEPTION 'opened revision changed'; END IF;
 BEGIN PERFORM public.ranking_v1_api_close(club,v_id,me); RAISE EXCEPTION 'early close accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ranking_v1_api_edit_draft(club,v_id,me,edited_rev,'Changed','baseball',deadline,c); RAISE EXCEPTION 'opened edit accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.events SET status='resultWait' WHERE events.id='management-expired'; RAISE EXCEPTION 'direct closed transition accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 a:=public.ranking_v1_api_close(club,'management-expired',me);
 IF a->>'status'<>'resultWait' OR a->'recovered'<>'false'::jsonb THEN RAISE EXCEPTION 'close failed'; END IF;
 a:=public.ranking_v1_api_close(club,'management-expired',me);
 IF a->'recovered'<>'true'::jsonb THEN RAISE EXCEPTION 'close retry failed'; END IF;
 BEGIN UPDATE public.events SET name='Direct after close' WHERE events.id='management-expired'; RAISE EXCEPTION 'closed name edit accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.events SET name='Direct after finalize' WHERE events.id='expired'; RAISE EXCEPTION 'finalized name edit accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT name FROM public.events WHERE id='management-expired')<>'expired'
 OR (SELECT status FROM public.events WHERE id='expired')<>'finalized' THEN RAISE EXCEPTION 'metadata guard changed existing data'; END IF;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
DO $f$ DECLARE club uuid:='00000000-0000-0000-0000-000000000010'; me uuid:=auth.uid(); v_id text:='a0000000-0000-4000-8000-000000000001';
BEGIN
 BEGIN PERFORM public.ranking_v1_api_create_draft(club,v_id,me,'New Cup','baseball',now()+interval '2 days',(SELECT config FROM inputs)); RAISE EXCEPTION 'member create accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ranking_v1_api_open(club,v_id,me,repeat('a',32)); RAISE EXCEPTION 'member open accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM public.ranking_v1_api_save(club,v_id,me,(SELECT pick FROM inputs));
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
DO $f$ BEGIN
 BEGIN PERFORM public.ranking_v1_api_close('00000000-0000-0000-0000-000000000010','expired',auth.uid()); RAISE EXCEPTION 'outsider close accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.ranking_v1_api_create_draft('00000000-0000-0000-0000-000000000020','a0000000-0000-4000-8000-000000000001',auth.uid(),'New Cup','baseball',now()+interval '2 days',(SELECT config FROM inputs)); RAISE EXCEPTION 'cross-club collision accepted';
 EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END $f$;
RESET ROLE;
DO $f$ BEGIN
 IF EXISTS(SELECT 1 FROM ranking_v1_private.management_permits) OR
 (SELECT count(*) FROM public.events WHERE id='a0000000-0000-4000-8000-000000000001')<>1 OR
 (SELECT count(*) FROM public.predictions WHERE event_id='a0000000-0000-4000-8000-000000000001')<>1 OR
 has_function_privilege('anon','public.ranking_v1_api_open(uuid,text,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'management isolation failed'; END IF;
END $f$;
SELECT 'PASS: management create/retry, revision edit/open, direct DML denial, early close denial, scoped member submission';
