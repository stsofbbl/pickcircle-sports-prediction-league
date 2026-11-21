-- PROTOTYPE ONLY: immutable Koshien identity; not a full event-state gate.
CREATE FUNCTION yoso_approval_private.protect_koshien_event_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.preset_type='koshien' OR NEW.preset_type='koshien' THEN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.preset_type IS DISTINCT FROM OLD.preset_type
     OR NEW.league_id IS DISTINCT FROM OLD.league_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
   RAISE EXCEPTION 'Koshien event identity cannot be reassigned' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION yoso_approval_private.protect_koshien_event_identity() FROM PUBLIC,authenticated,anon;
CREATE TRIGGER protect_koshien_event_identity BEFORE UPDATE ON public.events
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.protect_koshien_event_identity();
