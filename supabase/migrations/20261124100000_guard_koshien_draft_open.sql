-- #56: validate readiness before an existing Koshien draft becomes open.
-- New draft-only transition; legacy open-event creation is not changed here.
-- The existing child-table guard takes FOR SHARE on the event row, so
-- a concurrent roster write cannot race the RPC's FOR UPDATE lock.
CREATE FUNCTION yoso_admin_finalize_private.guard_koshien_draft_open()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $guard$
DECLARE
  v_districts text[] := ARRAY[
    '北北海道','南北海道','青森','岩手','宮城','秋田','山形','福島','茨城','栃木','群馬','埼玉',
    '千葉','東東京','西東京','神奈川','新潟','富山','石川','福井','山梨','長野','岐阜','静岡',
    '愛知','三重','滋賀','京都','大阪','兵庫','奈良','和歌山','鳥取','島根','岡山','広島',
    '山口','徳島','香川','愛媛','高知','福岡','佐賀','長崎','熊本','大分','宮崎','鹿児島','沖縄'
  ];
  v_config jsonb;
  v_team_count integer;
  v_first_count integer;
  v_second_count integer;
BEGIN
  IF OLD.preset_type IS DISTINCT FROM 'koshien' OR OLD.status IS DISTINCT FROM 'draft'
    OR NEW.status IS NOT DISTINCT FROM OLD.status THEN RETURN NEW; END IF;
  IF NEW.status IS DISTINCT FROM 'open'
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.league_id IS DISTINCT FROM OLD.league_id
    OR NEW.preset_type IS DISTINCT FROM OLD.preset_type OR NEW.rules IS DISTINCT FROM OLD.rules
    OR NEW.season IS DISTINCT FROM OLD.season OR NEW.prediction_deadline IS DISTINCT FROM OLD.prediction_deadline
    OR NEW.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Koshien draft must be opened without changing its identity or rules' USING ERRCODE='22023';
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_league_admin(OLD.league_id) THEN
    RAISE EXCEPTION 'league admin is required' USING ERRCODE='42501';
  END IF;
  IF NEW.season IS NULL OR NEW.season !~ '^20[0-9]{2}$'
    OR NEW.prediction_deadline IS NULL OR NEW.prediction_deadline <= clock_timestamp()
    OR NEW.rules->>'approvalPolicy' IS DISTINCT FROM 'admin'
    OR NEW.rules->'resultFlow'->>'status' IS DISTINCT FROM 'none' THEN
    RAISE EXCEPTION 'valid season, future deadline and admin approval required' USING ERRCODE='22023';
  END IF;
  v_config := NEW.rules->'config';
  IF v_config->'startRoundsConfirmed' IS DISTINCT FROM 'true'::jsonb
    OR v_config->'externalResults'->>'competitionType' IS DISTINCT FROM 'summer'
    OR v_config->'externalResults'->>'year' IS DISTINCT FROM NEW.season
    OR jsonb_typeof(v_config->'teams') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'confirm the official roster and start rounds for this season' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(v_config->'teams') <> 49 THEN
    RAISE EXCEPTION '49 configured teams required' USING ERRCODE='22023';
  END IF;
  SELECT count(*), count(*) FILTER (WHERE t.start_round=1), count(*) FILTER (WHERE t.start_round=2)
  INTO v_team_count,v_first_count,v_second_count FROM public.teams t WHERE t.event_id=NEW.id;
  IF v_team_count<>49 OR v_first_count<>34 OR v_second_count<>15
    OR (SELECT count(*) FROM public.event_teams et WHERE et.event_id=NEW.id)<>49
    OR (SELECT count(DISTINCT t.metadata->>'representative_key') FROM public.teams t WHERE t.event_id=NEW.id)<>49
    OR (SELECT count(DISTINCT t.metadata->>'district') FROM public.teams t WHERE t.event_id=NEW.id)<>49
    OR (SELECT count(DISTINCT et.metadata->>'representative_key') FROM public.event_teams et WHERE et.event_id=NEW.id)<>49
    OR (SELECT count(DISTINCT item) FROM jsonb_array_elements_text(v_config->'teams') x(item))<>49
    OR EXISTS (
      SELECT 1 FROM public.teams t WHERE t.event_id=NEW.id AND (
        nullif(btrim(t.name),'') IS NULL OR nullif(t.metadata->>'representative_key','') IS NULL
        OR t.metadata->>'source' IS DISTINCT FROM 'jhbf'
        OR t.metadata->>'source_year' IS DISTINCT FROM NEW.season
        OR NOT coalesce(t.metadata->>'district'=ANY(v_districts),false)
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v_config->'teams') x(item) WHERE x.item=t.name)
        OR NOT EXISTS (
          SELECT 1 FROM public.event_teams et WHERE et.event_id=NEW.id
            AND et.name=t.name
            AND et.metadata->>'representative_key'=t.metadata->>'representative_key'
            AND et.metadata->>'district'=t.metadata->>'district'
            AND et.metadata->>'source'='jhbf' AND et.metadata->>'source_year'=NEW.season
            AND et.metadata->>'startRound'=t.start_round::text
        )
      )
    ) THEN
    RAISE EXCEPTION '49 matching representatives and 34/15 confirmed start rounds required' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION yoso_admin_finalize_private.guard_koshien_draft_open() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER yoso_guard_koshien_draft_open
  BEFORE UPDATE OF status ON public.events FOR EACH ROW
  EXECUTE FUNCTION yoso_admin_finalize_private.guard_koshien_draft_open();

CREATE FUNCTION public.open_koshien_draft(p_event_id text,p_expected_revision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $rpc$
DECLARE v_event public.events; v_revision text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF v_event.id IS NULL OR NOT public.is_league_admin(v_event.league_id) THEN
    RAISE EXCEPTION 'league admin is required' USING ERRCODE='42501';
  END IF;
  IF v_event.preset_type IS DISTINCT FROM 'koshien' OR v_event.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Koshien draft required' USING ERRCODE='22023';
  END IF;
  IF p_expected_revision IS NULL OR p_expected_revision !~ '^[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'reviewed draft revision required' USING ERRCODE='22023';
  END IF;
  v_revision := public.koshien_admin_result_revision(p_event_id);
  IF v_revision IS DISTINCT FROM p_expected_revision THEN
    RAISE EXCEPTION 'draft changed; reload before opening' USING ERRCODE='40001';
  END IF;
  -- Trigger validates the two actual roster tables and readiness under the lock.
  UPDATE public.events SET status='open' WHERE id=p_event_id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'draft not opened' USING ERRCODE='40001'; END IF;
  RETURN jsonb_build_object('event_id',p_event_id,'status','open');
END
$rpc$;
REVOKE ALL ON FUNCTION public.open_koshien_draft(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.open_koshien_draft(text,text) TO authenticated;
