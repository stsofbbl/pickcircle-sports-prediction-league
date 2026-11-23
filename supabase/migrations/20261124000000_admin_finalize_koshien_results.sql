-- Admin-only online finalization MVP. Do not apply without production approval.
-- The standard shared-vote (half/unanimous) path remains separate.
CREATE SCHEMA IF NOT EXISTS yoso_admin_finalize_private;
REVOKE ALL ON SCHEMA yoso_admin_finalize_private FROM PUBLIC, anon, authenticated;

CREATE TABLE yoso_admin_finalize_private.permits (
  event_id text PRIMARY KEY,
  txid bigint NOT NULL,
  actor uuid NOT NULL
);
REVOKE ALL ON yoso_admin_finalize_private.permits FROM PUBLIC, anon, authenticated;

CREATE FUNCTION yoso_admin_finalize_private.guard_event_finalization()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_old_final boolean;
  v_identity_same boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.preset_type = 'koshien' AND (
      NEW.status = 'finalized' OR NEW.rules->'resultFlow'->>'status' = 'finalized'
    ) THEN
      RAISE EXCEPTION 'Koshien result finalization requires server validation'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.preset_type = 'koshien' AND (
    (NEW.status = 'finalized' AND OLD.status IS DISTINCT FROM 'finalized')
    OR (NEW.rules->'resultFlow'->>'status' = 'finalized'
      AND NEW.rules->'resultFlow' IS DISTINCT FROM OLD.rules->'resultFlow')
  ) AND NOT EXISTS (
    SELECT 1 FROM yoso_admin_finalize_private.permits p
    WHERE p.event_id = NEW.id AND p.txid = txid_current() AND p.actor = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Koshien result finalization requires server validation'
      USING ERRCODE = '42501';
  END IF;
  -- Existing production reopen_koshien_results() records an audit row
  -- BEFORE it updates events. Require that specific insert in this transaction.
  -- Authenticated clients cannot insert audit rows (RLS has SELECT only).
  v_old_final := OLD.preset_type = 'koshien'
    AND (OLD.status = 'finalized'
      OR OLD.rules->'resultFlow'->>'status' = 'finalized');
  v_identity_same := NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.preset_type IS NOT DISTINCT FROM OLD.preset_type
    AND NEW.league_id IS NOT DISTINCT FROM OLD.league_id;
  IF v_old_final AND (
    OLD.status IS DISTINCT FROM NEW.status
    OR OLD.rules IS DISTINCT FROM NEW.rules
    OR NOT v_identity_same
  ) AND NOT (
    v_identity_same
    AND OLD.status = 'finalized' AND NEW.status = 'archive'
    AND NEW.rules IS NOT DISTINCT FROM OLD.rules
  ) AND NOT (
    v_identity_same AND NEW.status = 'resultWait'
    AND NEW.rules->'resultFlow'->>'status' = 'none'
    AND EXISTS (
      SELECT 1 FROM public.koshien_result_reopens a
      WHERE a.event_id = OLD.id
        AND a.reopened_by = auth.uid()
        AND a.previous_event = to_jsonb(OLD)
        AND a.xmin::text::bigint = (txid_current() % 4294967296::bigint)
    )
  ) THEN
    RAISE EXCEPTION 'finalized Koshien result requires audited reopen'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER yoso_guard_admin_result_finalization
BEFORE INSERT OR UPDATE ON public.events
FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_event_finalization();

-- A result writer must obtain an event share-lock before mutating related
-- rows. NOWAIT prevents a child-row -> parent-row deadlock with finalization.
CREATE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_event_id text;
  v_status text;
  v_flow_status text;
BEGIN
  FOR v_event_id IN
    SELECT DISTINCT id
    FROM unnest(ARRAY[
      CASE WHEN TG_OP <> 'INSERT' THEN OLD.event_id ELSE NULL END,
      CASE WHEN TG_OP <> 'DELETE' THEN NEW.event_id ELSE NULL END
    ]) AS ids(id)
    WHERE id IS NOT NULL
    ORDER BY id
  LOOP
    v_status := NULL;
    v_flow_status := NULL;
    SELECT e.status, e.rules->'resultFlow'->>'status' INTO v_status, v_flow_status
    FROM public.events e
    WHERE e.id = v_event_id AND e.preset_type = 'koshien'
    FOR SHARE NOWAIT;
    IF v_status = 'finalized' OR v_flow_status = 'finalized' THEN
      RAISE EXCEPTION 'reopen finalized Koshien results before editing'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER yoso_guard_finalized_matches
BEFORE INSERT OR UPDATE OR DELETE ON public.matches
FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();
CREATE TRIGGER yoso_guard_finalized_scores
BEFORE INSERT OR UPDATE OR DELETE ON public.scores
FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();
CREATE TRIGGER yoso_guard_finalized_results
BEFORE INSERT OR UPDATE OR DELETE ON public.results
FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();

CREATE TRIGGER yoso_guard_finalized_teams
BEFORE INSERT OR UPDATE OR DELETE ON public.teams
FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();
CREATE TRIGGER yoso_guard_finalized_event_teams
BEFORE INSERT OR UPDATE OR DELETE ON public.event_teams
FOR EACH ROW EXECUTE FUNCTION yoso_admin_finalize_private.guard_finalized_result_write();


-- Stable, read-only snapshot fingerprint including subsecond and score-only edits.
-- The legacy koshien_result_version function is not modified.
CREATE FUNCTION public.koshien_admin_result_revision(p_event_id text)
RETURNS text LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_event public.events;
  v_revision text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id AND preset_type='koshien';
  IF v_event.id IS NULL OR NOT public.is_league_member(v_event.league_id) THEN
    RAISE EXCEPTION 'league membership required' USING ERRCODE = '42501';
  END IF;
  SELECT md5(jsonb_build_object(
    'event',to_jsonb(v_event),
    'matches',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.round_key,m.match_no),'[]'::jsonb) FROM public.matches m WHERE m.event_id=p_event_id),
    'teams',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.teams t WHERE t.event_id=p_event_id),
    'event_teams',(SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'::jsonb) FROM public.event_teams t WHERE t.event_id=p_event_id),
    'scores',(SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.player_id),'[]'::jsonb) FROM public.scores x WHERE x.event_id=p_event_id),
    'results',(SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.event_id),'[]'::jsonb) FROM public.results r WHERE r.event_id=p_event_id)
  )::text) INTO v_revision;
  RETURN v_revision;
END
$fn$;
REVOKE ALL ON FUNCTION public.koshien_admin_result_revision(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.koshien_admin_result_revision(text) TO authenticated;

CREATE FUNCTION public.finalize_koshien_admin_results(
  p_event_id text, p_expected_revision text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_event public.events;
  v_revision text;
  v_total integer;
  v_valid integer;
  v_rounds jsonb;
  v_now text := to_char(clock_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_event FROM public.events WHERE id = p_event_id FOR UPDATE;
  IF v_event.id IS NULL OR NOT public.is_league_admin(v_event.league_id) THEN
    RAISE EXCEPTION 'club admin permission required' USING ERRCODE = '42501';
  END IF;
  IF v_event.preset_type <> 'koshien' OR v_event.status <> 'resultWait'
    OR v_event.rules->>'approvalPolicy' IS DISTINCT FROM 'admin'
    OR coalesce(v_event.rules->'resultFlow'->>'status', 'none') NOT IN ('none','submitted') THEN
    RAISE EXCEPTION 'event is not awaiting admin-only result approval'
      USING ERRCODE = '22023';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'expected result revision required' USING ERRCODE = '22023';
  END IF;

  -- Read-lock the 48 source rows while checking the version and stored scores.
  PERFORM 1 FROM public.matches m WHERE m.event_id = p_event_id
    ORDER BY m.round_key, m.match_no FOR SHARE;
  v_revision := public.koshien_admin_result_revision(p_event_id);
  IF v_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'reviewed scoreboard changed; refresh before finalizing'
      USING ERRCODE = '40001';
  END IF;
  IF (SELECT count(*) FROM public.teams WHERE event_id = p_event_id) <> 49 THEN
    RAISE EXCEPTION '49 representatives required' USING ERRCODE = '22023';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE status = 'completed'
    AND team1_id IS NOT NULL AND team2_id IS NOT NULL
    AND team1_id <> team2_id AND winner_team_id IS NOT NULL
    AND loser_team_id IS NOT NULL AND winner_team_id <> loser_team_id
    AND team1_score IS NOT NULL AND team2_score IS NOT NULL
    AND team1_score >= 0 AND team2_score >= 0 AND team1_score <> team2_score
    AND ((team1_score > team2_score AND winner_team_id = team1_id AND loser_team_id = team2_id)
      OR (team2_score > team1_score AND winner_team_id = team2_id AND loser_team_id = team1_id)))
  INTO v_total,v_valid FROM public.matches WHERE event_id = p_event_id;
  IF v_total <> 48 OR v_valid <> 48 THEN
    RAISE EXCEPTION 'all 48 valid matches must be completed' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_object_agg(round_key, n), '{}'::jsonb) INTO v_rounds
  FROM (SELECT round_key,count(*) n FROM public.matches
    WHERE event_id = p_event_id GROUP BY round_key) r;
  IF v_rounds <> '{"R1":17,"R2":16,"R3":8,"QF":4,"SF":2,"F":1}'::jsonb THEN
    RAISE EXCEPTION 'Koshien round counts are inconsistent' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.results r WHERE r.event_id = p_event_id
    AND jsonb_typeof(r.payload) = 'object') THEN
    RAISE EXCEPTION 'stored result snapshot required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.players p JOIN public.league_members lm
      ON lm.league_id = p.league_id AND lm.user_id = p.profile_id
    WHERE p.league_id = v_event.league_id AND lm.membership_status = 'active'
      AND NOT EXISTS (SELECT 1 FROM public.scores s
        WHERE s.event_id = p_event_id AND s.player_id = p.id)
  ) THEN
    RAISE EXCEPTION 'scores missing for an active participant' USING ERRCODE = '22023';
  END IF;

  INSERT INTO yoso_admin_finalize_private.permits(event_id,txid,actor)
  VALUES(p_event_id,txid_current(),auth.uid());
  UPDATE public.events SET status = 'finalized',
    rules = jsonb_set(coalesce(rules,'{}'::jsonb), '{resultFlow}',
      jsonb_build_object('status','finalized','submittedBy',auth.uid()::text,
        'submittedAt',v_now,'approvals',jsonb_build_object(auth.uid()::text,v_now),
        'finalizedAt',v_now),true)
  WHERE id = p_event_id;
  DELETE FROM yoso_admin_finalize_private.permits WHERE event_id = p_event_id;
  RETURN jsonb_build_object('event_status','finalized','reviewed_revision',v_revision);
END
$fn$;

REVOKE ALL ON FUNCTION public.finalize_koshien_admin_results(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_koshien_admin_results(text,text) TO authenticated;
REVOKE ALL ON FUNCTION yoso_admin_finalize_private.guard_event_finalization()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION yoso_admin_finalize_private.guard_finalized_result_write()
  FROM PUBLIC,anon,authenticated;
