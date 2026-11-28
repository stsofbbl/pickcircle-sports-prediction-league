-- #56: A roster re-import after opening may clear start-round confirmation.
-- Reject that change atomically while predictions are open; legacy finalized events are untouched.
CREATE FUNCTION yoso_admin_finalize_private.keep_open_koshien_rounds_confirmed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $guard$
BEGIN
  IF OLD.preset_type = 'koshien'
     AND OLD.status = 'open'
     AND NEW.status = 'open'
     AND OLD.rules #> '{config,startRoundsConfirmed}' = 'true'::jsonb
     AND NEW.rules #> '{config,startRoundsConfirmed}' IS DISTINCT FROM 'true'::jsonb THEN
    RAISE EXCEPTION 'open Koshien roster and start rounds cannot be reset'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION yoso_admin_finalize_private.keep_open_koshien_rounds_confirmed()
  FROM PUBLIC, anon, authenticated;
CREATE TRIGGER yoso_keep_open_koshien_rounds_confirmed
  BEFORE UPDATE OF rules ON public.events FOR EACH ROW
  EXECUTE FUNCTION yoso_admin_finalize_private.keep_open_koshien_rounds_confirmed();
