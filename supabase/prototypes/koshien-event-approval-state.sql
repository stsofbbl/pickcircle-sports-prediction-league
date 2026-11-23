-- PROTOTYPE ONLY. No authorized finalization/reopen path yet: never deploy alone.
-- A result-write permit is deliberately NOT an approval-state permit.
CREATE FUNCTION yoso_approval_private.protect_koshien_approval_state()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
 IF OLD.preset_type='koshien' OR NEW.preset_type='koshien' THEN
  IF ((OLD.status='finalized' OR NEW.status='finalized')
       AND NEW.status IS DISTINCT FROM OLD.status)
     OR (NEW.rules->'resultFlow') IS DISTINCT FROM (OLD.rules->'resultFlow') THEN
   RAISE EXCEPTION 'approval state requires an authorized transition' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION yoso_approval_private.protect_koshien_approval_state() FROM PUBLIC,authenticated,anon;
CREATE TRIGGER protect_koshien_approval_state BEFORE UPDATE ON public.events
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.protect_koshien_approval_state();
