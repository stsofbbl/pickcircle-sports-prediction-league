-- Same disposable transaction as the fixture/prototype.
DO $f$ BEGIN
 IF NOT ranking_v1_private.valid_config((SELECT config FROM inputs))
 OR NOT ranking_v1_private.valid_order((SELECT pick FROM inputs),(SELECT config FROM inputs))
 OR ranking_v1_private.valid_config(jsonb_set((SELECT config FROM inputs),'{candidates,0,multiplierTenths}','0'))
 OR ranking_v1_private.valid_config(jsonb_set((SELECT config FROM inputs),'{candidates,0,label}','" A"'))
 OR ranking_v1_private.valid_config(jsonb_set((SELECT config FROM inputs),'{candidates,0,label}',to_jsonb(repeat('😀',51))))
 OR ranking_v1_private.valid_order('{"version":1,"candidateIds":["a","a","b","c"]}',(SELECT config FROM inputs)) THEN
  RAISE EXCEPTION 'contract validator mismatch';
 END IF;
END $f$;
SET LOCAL ROLE authenticated;
INSERT INTO public.events VALUES ('new','00000000-0000-0000-0000-000000000010','Ranking','ranking_v1','draft',now()+interval '1 day',(SELECT config FROM inputs),'00000000-0000-0000-0000-000000000001','baseball');
DO $f$ BEGIN
 BEGIN
  INSERT INTO public.events VALUES ('bad','00000000-0000-0000-0000-000000000010','Ranking','ranking_v1','open',now()+interval '1 day',(SELECT config FROM inputs),'00000000-0000-0000-0000-000000000001','baseball');
  RAISE EXCEPTION 'open insert accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.predictions(event_id,user_id,payload) VALUES('new',auth.uid(),(SELECT pick FROM inputs));
  RAISE EXCEPTION 'draft prediction accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $f$;
UPDATE public.events SET status='open' WHERE id='new';
INSERT INTO public.predictions(event_id,user_id,payload,submitted_at,updated_at) VALUES('new',auth.uid(),(SELECT pick FROM inputs),'2000-01-01','2000-01-01');
DO $f$ BEGIN
 IF (SELECT submitted_at FROM public.predictions WHERE event_id='new')<'2020-01-01' THEN RAISE EXCEPTION 'forged timestamp accepted'; END IF;
 BEGIN
  UPDATE public.events SET status='resultWait' WHERE id='new'; RAISE EXCEPTION 'early publication accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.events SET prediction_deadline=now()-interval '1 second' WHERE id='new'; RAISE EXCEPTION 'deadline changed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.events SET rules=jsonb_set(rules,'{candidates,0,multiplierTenths}','1000') WHERE id='new'; RAISE EXCEPTION 'multiplier changed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.events SET preset_type='ranking_v1' WHERE id='legacy'; RAISE EXCEPTION 'reclassified legacy';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.results VALUES('new','{}',auth.uid()); RAISE EXCEPTION 'unvalidated result accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.scores VALUES('new',auth.uid(),999); RAISE EXCEPTION 'forged score accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.predictions SET event_id='legacy' WHERE event_id='new'; RAISE EXCEPTION 'prediction moved';
 EXCEPTION WHEN insufficient_privilege OR unique_violation THEN NULL; END;
 BEGIN
  DELETE FROM public.events WHERE id='new'; RAISE EXCEPTION 'prototype deletion accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
DO $f$ DECLARE n integer; BEGIN
 IF EXISTS(SELECT 1 FROM public.predictions WHERE event_id IN('new','legacy','expired-draft')) THEN RAISE EXCEPTION 'predeadline or draft leak'; END IF;
 IF (SELECT count(*) FROM public.predictions WHERE event_id='expired')<>1 THEN RAISE EXCEPTION 'closed predictions not published'; END IF;
 BEGIN
  INSERT INTO public.predictions(event_id,user_id,payload) VALUES('new',auth.uid(),'{"version":1,"candidateIds":["a","b","c","x"]}');
  RAISE EXCEPTION 'unknown candidate accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  INSERT INTO public.predictions(event_id,user_id,payload) VALUES('new',auth.uid(),(SELECT pick FROM inputs)||'{"score":999}');
  RAISE EXCEPTION 'score injection accepted';
 EXCEPTION WHEN invalid_parameter_value THEN NULL; END;
 BEGIN
  INSERT INTO public.predictions(event_id,user_id,payload) VALUES('expired',auth.uid(),(SELECT pick FROM inputs));
  RAISE EXCEPTION 'late submission accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 UPDATE public.predictions SET payload=(SELECT pick FROM inputs) WHERE event_id='new';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'other prediction changed'; END IF;
END $f$;
INSERT INTO public.predictions(event_id,user_id,payload) VALUES('new',auth.uid(),(SELECT pick FROM inputs));
UPDATE public.predictions SET payload='{"version":1,"candidateIds":["b","a","d","c"]}' WHERE event_id='new' AND user_id=auth.uid();
DO $f$ BEGIN
 IF (SELECT count(*) FROM public.predictions WHERE event_id='new')<>1 OR
 (SELECT payload->'candidateIds'->>0 FROM public.predictions WHERE event_id='new')<>'b' THEN RAISE EXCEPTION 'self update or privacy failure'; END IF;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
DO $f$ BEGIN
 IF EXISTS(SELECT 1 FROM public.predictions) OR EXISTS(SELECT 1 FROM public.events) THEN RAISE EXCEPTION 'cross-club leak'; END IF;
 BEGIN
  INSERT INTO public.predictions(event_id,user_id,payload) VALUES('new',auth.uid(),(SELECT pick FROM inputs));
  RAISE EXCEPTION 'cross-club submission accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
UPDATE public.events SET status='resultWait' WHERE id='expired';
DO $f$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.events WHERE id='expired' AND status='resultWait') THEN RAISE EXCEPTION 'valid close failed'; END IF;
 BEGIN
  UPDATE public.events SET status='open' WHERE id='expired'; RAISE EXCEPTION 'reopen accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $f$;
RESET ROLE;
DO $f$ BEGIN
 IF (SELECT count(*) FROM public.predictions WHERE event_id='new')<>2 THEN RAISE EXCEPTION 'two participant saves expected'; END IF;
 IF EXISTS(SELECT 1 FROM public.results WHERE event_id='new') OR EXISTS(SELECT 1 FROM public.scores WHERE event_id='new') THEN RAISE EXCEPTION 'result leakage'; END IF;
 IF (SELECT state FROM legacy_snapshot) IS DISTINCT FROM jsonb_build_array(
 (SELECT to_jsonb(e) FROM public.events e WHERE id='legacy'),
 (SELECT to_jsonb(p) FROM public.predictions p WHERE event_id='legacy'),
 (SELECT to_jsonb(r) FROM public.results r WHERE event_id='legacy'),
 (SELECT to_jsonb(s) FROM public.scores s WHERE event_id='legacy')) THEN RAISE EXCEPTION 'legacy data changed'; END IF;
END $f$;
ROLLBACK;
SELECT 'PASS: draft/open, two own saves, predeadline and cross-club privacy, immutable config/deadline, blocked direct result/score, legacy unchanged';
