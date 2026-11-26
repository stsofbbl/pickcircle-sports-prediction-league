-- REVIEW CANDIDATE, not an automated production rollback.
-- Only after confirming the live permit/RPC definitions match the approved
-- release. This restores the original #58 reviewed RPC (INVOKER), not the
-- pre-#58 schema. The original readiness trigger remains in place.
CREATE OR REPLACE FUNCTION public.open_koshien_draft(p_event_id text,p_expected_revision text)
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
    RAISE EXCEPTION 'draft changed; reload before opening' USING ERRCODE='PT409';
  END IF;
  -- Trigger validates the two actual roster tables and readiness under the lock.
  UPDATE public.events SET status='open' WHERE id=p_event_id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'draft not opened' USING ERRCODE='PT409'; END IF;
  RETURN jsonb_build_object('event_id',p_event_id,'status','open');
END
$rpc$;
REVOKE ALL ON FUNCTION public.open_koshien_draft(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.open_koshien_draft(text,text) TO authenticated;
DROP TRIGGER yoso_require_koshien_draft_open_permit ON public.events;
DROP FUNCTION yoso_admin_finalize_private.require_koshien_draft_open_permit();
DROP TABLE yoso_admin_finalize_private.draft_open_permits;
