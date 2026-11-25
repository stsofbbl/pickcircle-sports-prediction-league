-- REVIEW CANDIDATE, disposable CI only until approved and migrated.
-- Apply after the three draft lifecycle migrations. Do not expose the private schema.
CREATE TABLE yoso_admin_finalize_private.draft_open_permits (
 event_id text NOT NULL, actor uuid NOT NULL, txid bigint NOT NULL,
 PRIMARY KEY(event_id,actor,txid)
);
ALTER TABLE yoso_admin_finalize_private.draft_open_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON yoso_admin_finalize_private.draft_open_permits FROM PUBLIC,anon,authenticated;
CREATE FUNCTION yoso_admin_finalize_private.require_koshien_draft_open_permit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $permit$
BEGIN
 IF OLD.preset_type='koshien' AND OLD.status='draft' AND NEW.status='open' THEN
   DELETE FROM yoso_admin_finalize_private.draft_open_permits
    WHERE event_id=OLD.id AND actor=auth.uid() AND txid=txid_current();
   IF NOT FOUND THEN
     RAISE EXCEPTION 'use reviewed Koshien draft opening RPC' USING ERRCODE='42501';
   END IF;
 END IF;
 RETURN NEW;
END $permit$;
REVOKE ALL ON FUNCTION yoso_admin_finalize_private.require_koshien_draft_open_permit() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER yoso_require_koshien_draft_open_permit
 BEFORE UPDATE OF status ON public.events FOR EACH ROW
 EXECUTE FUNCTION yoso_admin_finalize_private.require_koshien_draft_open_permit();

-- Definer is restricted to this exact RPC. Explicit actor, active league admin,
-- locked event, reviewed revision, readiness trigger and one-shot permit.
CREATE OR REPLACE FUNCTION public.open_koshien_draft(p_event_id text,p_expected_revision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $rpc$
DECLARE v_event public.events; v_revision text; v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'authentication required' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_event FROM public.events WHERE id=p_event_id FOR UPDATE;
  IF v_event.id IS NULL OR NOT coalesce(public.is_league_admin(v_event.league_id),false) THEN
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
  INSERT INTO yoso_admin_finalize_private.draft_open_permits(event_id,actor,txid)
  VALUES(p_event_id,v_actor,txid_current());
  -- Trigger validates and consumes the permit in the same transaction.
  UPDATE public.events SET status='open' WHERE id=p_event_id AND status='draft';
  IF NOT FOUND THEN RAISE EXCEPTION 'draft not opened' USING ERRCODE='40001'; END IF;
  IF EXISTS(SELECT 1 FROM yoso_admin_finalize_private.draft_open_permits
    WHERE event_id=p_event_id AND actor=v_actor AND txid=txid_current()) THEN
    RAISE EXCEPTION 'draft opening permit was not consumed';
  END IF;
  RETURN jsonb_build_object('event_id',p_event_id,'status','open');
END
$rpc$;
REVOKE ALL ON FUNCTION public.open_koshien_draft(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.open_koshien_draft(text,text) TO authenticated;
