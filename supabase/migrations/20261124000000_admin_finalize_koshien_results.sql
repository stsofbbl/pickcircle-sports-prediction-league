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
      AND OLD.rules->'resultFlow'->>'status' IS DISTINCT FROM 'finalized')
  ) AND NOT EXISTS (
    SELECT 1 FROM yoso_admin_finalize_private.permits p
    WHERE p.event_id = NEW.id AND p.txid = txid_current() AND p.actor = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Koshien result finalization requires server validation'
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

CREATE FUNCTION public.finalize_koshien_admin_results(
  p_event_id text, p_expected_version bigint
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $fn$
DECLARE
  v_event public.events;
  v_version bigint;
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
  IF p_expected_version IS NULL OR p_expected_version < 0 THEN
    RAISE EXCEPTION 'expected result version required' USING ERRCODE = '22023';
  END IF;

  -- Read-lock the 48 source rows while checking the version and stored scores.
  PERFORM 1 FROM public.matches m WHERE m.event_id = p_event_id
    ORDER BY m.round_key, m.match_no FOR SHARE;
  v_version := public.koshien_result_version(p_event_id);
  IF v_version IS DISTINCT FROM p_expected_version THEN
    RAISE EXCEPTION 'match results changed; refresh before finalizing'
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
  RETURN jsonb_build_object('event_status','finalized','result_version',v_version);
END
$fn$;

REVOKE ALL ON FUNCTION public.finalize_koshien_admin_results(text,bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_koshien_admin_results(text,bigint) TO authenticated;
REVOKE ALL ON FUNCTION yoso_admin_finalize_private.guard_event_finalization()
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION yoso_admin_finalize_private.guard_finalized_result_write()
  FROM PUBLIC,anon,authenticated;
