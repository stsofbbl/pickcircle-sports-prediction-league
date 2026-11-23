-- PROTOTYPE ONLY: requires result-write permits and event approval-state gates.
-- No new lock here: every permitted child writer already holds the event lock.
CREATE FUNCTION yoso_approval_private.reject_finalized_result_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_event text;
BEGIN
 IF TG_OP='DELETE' THEN v_event := OLD.event_id;
 ELSE v_event := NEW.event_id; END IF;
 IF EXISTS (
  SELECT 1 FROM public.events e WHERE e.id=v_event AND e.preset_type='koshien'
   AND (e.status='finalized' OR e.rules->'resultFlow'->>'status'='finalized')
 ) THEN
  RAISE EXCEPTION 'reopen finalized results before editing' USING ERRCODE='55000';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION yoso_approval_private.reject_finalized_result_write() FROM PUBLIC,authenticated,anon;
CREATE TRIGGER reject_finalized_result_write BEFORE INSERT OR UPDATE OR DELETE ON public.matches
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.reject_finalized_result_write();
CREATE TRIGGER reject_finalized_result_write BEFORE INSERT OR UPDATE OR DELETE ON public.results
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.reject_finalized_result_write();
CREATE TRIGGER reject_finalized_result_write BEFORE INSERT OR UPDATE OR DELETE ON public.scores
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.reject_finalized_result_write();
