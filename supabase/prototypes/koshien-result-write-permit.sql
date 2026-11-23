-- PROTOTYPE ONLY: load after koshien-result-write.sql in an isolated transaction.
-- Not a migration. Save/cancel/auto are fixture-tested; full deferred writers are not.
CREATE TABLE yoso_approval_private.write_permits (
 event_id text PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
 transaction_id bigint NOT NULL,
 actor_id uuid
);
ALTER TABLE yoso_approval_private.write_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON yoso_approval_private.write_permits FROM PUBLIC,authenticated,anon;

-- Trusted entry only. Acquires event/revision locks before any child-row write.
CREATE FUNCTION yoso_approval_private.issue_write_permit(p_event_id text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 PERFORM yoso_approval_private.lock_revision(p_event_id);
 INSERT INTO yoso_approval_private.write_permits(event_id,transaction_id,actor_id)
 VALUES(p_event_id,pg_catalog.txid_current(),auth.uid())
 ON CONFLICT(event_id) DO UPDATE
 SET transaction_id=EXCLUDED.transaction_id,actor_id=EXCLUDED.actor_id;
END;
$$;
REVOKE ALL ON FUNCTION yoso_approval_private.issue_write_permit(text) FROM PUBLIC,authenticated,anon;

CREATE OR REPLACE FUNCTION yoso_approval_private.begin_result_write(p_event_id text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_league uuid; v_revision bigint;
BEGIN
 IF auth.uid() IS NULL THEN
  RAISE EXCEPTION 'authentication is required' USING ERRCODE='42501';
 END IF;
 SELECT league_id INTO v_league FROM public.events WHERE id=p_event_id;
 IF v_league IS NULL OR NOT public.is_league_admin(v_league) THEN
  RAISE EXCEPTION 'league admin permission is required' USING ERRCODE='42501';
 END IF;
 v_revision := yoso_approval_private.lock_revision(p_event_id);
 -- Read current ownership again after waiting; do not authorize an old league.
 SELECT league_id INTO v_league FROM public.events WHERE id=p_event_id;
 IF v_league IS NULL OR NOT public.is_league_admin(v_league) THEN
  RAISE EXCEPTION 'league admin permission is required' USING ERRCODE='42501';
 END IF;
 v_revision := yoso_approval_private.advance_revision(p_event_id,v_revision);
 PERFORM yoso_approval_private.issue_write_permit(p_event_id);
 RETURN v_revision;
END;
$$;

-- Only verifies the permit: never locks the event after locking a child row.
CREATE FUNCTION yoso_approval_private.require_result_write_permit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event text; v_old_event text; v_preset text;
BEGIN
 IF TG_OP='DELETE' THEN v_event := OLD.event_id;
 ELSE v_event := NEW.event_id; END IF;
 IF TG_OP='UPDATE' THEN
  v_old_event := OLD.event_id;
  IF v_old_event IS DISTINCT FROM v_event THEN
   RAISE EXCEPTION 'result event reassignment is not supported' USING ERRCODE='42501';
  END IF;
 END IF;
 SELECT preset_type INTO v_preset FROM public.events WHERE id=v_event;
 IF NOT FOUND THEN
  RAISE EXCEPTION 'result event is required' USING ERRCODE='42501';
 END IF;
 IF v_preset='koshien' AND NOT EXISTS(
  SELECT 1 FROM yoso_approval_private.write_permits p
  WHERE p.event_id=v_event AND p.transaction_id=pg_catalog.txid_current()
   AND p.actor_id IS NOT DISTINCT FROM auth.uid()
 ) THEN
  RAISE EXCEPTION 'authorized result write entry is required' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION yoso_approval_private.require_result_write_permit() FROM PUBLIC,authenticated,anon;
CREATE TRIGGER require_result_write_permit BEFORE INSERT OR UPDATE OR DELETE ON public.matches
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.require_result_write_permit();
CREATE TRIGGER require_result_write_permit BEFORE INSERT OR UPDATE OR DELETE ON public.results
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.require_result_write_permit();
CREATE TRIGGER require_result_write_permit BEFORE INSERT OR UPDATE OR DELETE ON public.scores
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.require_result_write_permit();
