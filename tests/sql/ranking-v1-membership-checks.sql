-- Synthetic account removal and historical identity tests.
CREATE TEMP TABLE history_before AS SELECT jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.predictions p WHERE event_id IN('new','finalize-case')),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY player_id) FROM public.scores s WHERE event_id='finalize-case'),
 (SELECT to_jsonb(r) FROM public.results r WHERE event_id='finalize-case'),
 (SELECT to_jsonb(r) FROM ranking_v1_private.finalize_receipts r WHERE event_id='finalize-case')) AS state;
DO $f$ BEGIN
 BEGIN
  UPDATE public.players SET profile_id=NULL WHERE id='00000000-0000-0000-0000-000000000012';
  RAISE EXCEPTION 'historical player reassigned';
 EXCEPTION WHEN restrict_violation OR foreign_key_violation THEN NULL; END;
 BEGIN
  DELETE FROM public.players WHERE id='00000000-0000-0000-0000-000000000012';
  RAISE EXCEPTION 'historical player removed';
 EXCEPTION WHEN restrict_violation OR foreign_key_violation THEN NULL; END;
 BEGIN
  DELETE FROM auth.users WHERE id='00000000-0000-0000-0000-000000000001';
  RAISE EXCEPTION 'owner account deletion accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.remove_club_member('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000002');
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
DO $f$ DECLARE n integer; BEGIN
 IF EXISTS(SELECT 1 FROM public.predictions) OR EXISTS(SELECT 1 FROM public.scores) OR EXISTS(SELECT 1 FROM public.events) THEN RAISE EXCEPTION 'removed member still has access'; END IF;
 UPDATE public.predictions SET payload=(SELECT pick FROM inputs) WHERE event_id='new';
 GET DIAGNOSTICS n=ROW_COUNT;
 IF n<>0 THEN RAISE EXCEPTION 'removed member modified prediction'; END IF;
END $f$;
RESET ROLE;
DELETE FROM auth.users WHERE id='00000000-0000-0000-0000-000000000002';
DO $f$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id='00000000-0000-0000-0000-000000000002' AND auth_user_id IS NULL AND deleted_at IS NOT NULL AND display_name LIKE '退会済みメンバー-%')
 OR NOT EXISTS(SELECT 1 FROM public.players WHERE profile_id='00000000-0000-0000-0000-000000000002' AND display_name LIKE '退会済みメンバー-%')
 OR (SELECT state FROM history_before) IS DISTINCT FROM jsonb_build_array(
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.predictions p WHERE event_id IN('new','finalize-case')),
 (SELECT jsonb_agg(to_jsonb(s) ORDER BY player_id) FROM public.scores s WHERE event_id='finalize-case'),
 (SELECT to_jsonb(r) FROM public.results r WHERE event_id='finalize-case'),
 (SELECT to_jsonb(r) FROM ranking_v1_private.finalize_receipts r WHERE event_id='finalize-case')) THEN RAISE EXCEPTION 'account archive lost historical data'; END IF;
END $f$;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
DO $f$ BEGIN
 BEGIN PERFORM public.delete_club('00000000-0000-0000-0000-000000000010','Fixture Club');
  RAISE EXCEPTION 'prototype club deletion accepted';
 EXCEPTION WHEN insufficient_privilege OR foreign_key_violation OR restrict_violation THEN NULL; END;
END $f$;
RESET ROLE;
DO $f$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.leagues WHERE id='00000000-0000-0000-0000-000000000010')
 OR (SELECT count(*) FROM public.scores WHERE event_id='finalize-case')<>2 THEN RAISE EXCEPTION 'club deletion partially succeeded'; END IF;
END $f$;
ROLLBACK;
SELECT 'PASS: removed member access revoked, production account archive preserves prediction and score history, player identity protected, club deletion blocked atomically';
