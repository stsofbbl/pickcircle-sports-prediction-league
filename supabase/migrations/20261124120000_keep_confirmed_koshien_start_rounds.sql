-- Once an open Koshien event has confirmed its draw, do not permit changes
-- to either persisted start-round representation. Initial confirmation of
-- legacy open/unconfirmed events is still allowed. Same-value writes, odds,
-- multipliers, match results, and the existing finalization rules are unchanged.
-- Parent row lock uses the same order and NOWAIT behavior as the existing
-- finalized-child guard, so an update racing the opening RPC cannot slip through.
CREATE FUNCTION yoso_admin_finalize_private.keep_confirmed_koshien_start_rounds()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $guard$
DECLARE v_status text; v_confirmed jsonb;
BEGIN
  IF TG_TABLE_NAME='teams' THEN
    IF OLD.start_round IS NOT DISTINCT FROM NEW.start_round THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='event_teams' THEN
    IF OLD.metadata->>'startRound' IS NOT DISTINCT FROM NEW.metadata->>'startRound' THEN
      RETURN NEW;
    END IF;
  ELSE
    RAISE EXCEPTION 'unexpected table for Koshien start-round guard';
  END IF;
  SELECT e.status,e.rules #> '{config,startRoundsConfirmed}' INTO v_status,v_confirmed
    FROM public.events e
    WHERE e.id=OLD.event_id AND e.preset_type='koshien'
    FOR SHARE NOWAIT;
  IF v_status='open' AND v_confirmed='true'::jsonb THEN
    RAISE EXCEPTION 'confirmed Koshien start rounds cannot be changed while open'
      USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END
$guard$;
REVOKE ALL ON FUNCTION yoso_admin_finalize_private.keep_confirmed_koshien_start_rounds()
  FROM PUBLIC,anon,authenticated;
CREATE TRIGGER yoso_keep_confirmed_koshien_team_round
  BEFORE UPDATE OF start_round ON public.teams FOR EACH ROW
  EXECUTE FUNCTION yoso_admin_finalize_private.keep_confirmed_koshien_start_rounds();
CREATE TRIGGER yoso_keep_confirmed_koshien_event_team_round
  BEFORE UPDATE OF metadata ON public.event_teams FOR EACH ROW
  EXECUTE FUNCTION yoso_admin_finalize_private.keep_confirmed_koshien_start_rounds();
