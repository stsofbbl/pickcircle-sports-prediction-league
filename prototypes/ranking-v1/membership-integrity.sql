-- REVIEW PROTOTYPE ONLY. After finalize.sql, disposable CI only.
-- A foreign key, not a mutable display name or snapshot lookup, protects
-- each submitted prediction's historical player identity.
ALTER TABLE public.players ADD CONSTRAINT ranking_v1_player_identity_unique UNIQUE(id,league_id,profile_id);
CREATE TABLE ranking_v1_private.prediction_players(
 event_id text NOT NULL,user_id uuid NOT NULL,league_id uuid NOT NULL,player_id uuid NOT NULL,
 PRIMARY KEY(event_id,user_id),
 FOREIGN KEY(event_id,user_id) REFERENCES public.predictions(event_id,user_id) ON DELETE CASCADE ON UPDATE RESTRICT,
 FOREIGN KEY(player_id,league_id,user_id) REFERENCES public.players(id,league_id,profile_id) ON DELETE RESTRICT ON UPDATE RESTRICT
);
ALTER TABLE ranking_v1_private.prediction_players ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ranking_v1_private.prediction_players FROM PUBLIC,anon,authenticated;
CREATE INDEX ranking_v1_prediction_player_idx ON ranking_v1_private.prediction_players(player_id,league_id,user_id);
CREATE OR REPLACE FUNCTION ranking_v1_private.guard_prediction() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE e public.events%ROWTYPE; old_preset text; event_id text; owner_id uuid;
BEGIN
 IF TG_OP='UPDATE' THEN
  SELECT preset_type INTO old_preset FROM public.events WHERE id=OLD.event_id;
 END IF;
 IF TG_OP='DELETE' THEN event_id:=OLD.event_id; owner_id:=OLD.user_id;
 ELSE event_id:=NEW.event_id; owner_id:=NEW.user_id; END IF;
 SELECT * INTO e FROM public.events WHERE id=event_id;
 IF TG_OP='UPDATE' AND (old_preset='ranking_v1' OR e.preset_type='ranking_v1')
  AND (NEW.event_id IS DISTINCT FROM OLD.event_id OR NEW.user_id IS DISTINCT FROM OLD.user_id OR NEW.id IS DISTINCT FROM OLD.id) THEN
  RAISE EXCEPTION 'ranking prediction identity immutable' USING ERRCODE='42501';
 END IF;
 IF e.preset_type IS DISTINCT FROM 'ranking_v1' THEN
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
 END IF;
 -- Lock the parent before accepting any prediction. NOWAIT avoids a deadlock
 -- with an event transition; retry the complete request after lock conflict.
 SELECT * INTO e FROM public.events WHERE id=event_id FOR SHARE NOWAIT;
 IF auth.uid() IS NULL OR owner_id IS DISTINCT FROM auth.uid() OR NOT public.is_league_member(e.league_id)
  OR e.status<>'open' OR e.prediction_deadline IS NULL OR clock_timestamp()>=e.prediction_deadline THEN
  RAISE EXCEPTION 'ranking prediction closed or unauthorized' USING ERRCODE='42501';
 END IF;
 -- A concurrent removal must either wait for this save or win first.
 PERFORM 1 FROM public.league_members lm WHERE lm.league_id=e.league_id AND lm.user_id=owner_id
  AND lm.membership_status='active' FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'ranking active membership required' USING ERRCODE='42501'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 PERFORM 1 FROM public.players pl WHERE pl.league_id=e.league_id AND pl.profile_id=owner_id FOR KEY SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'ranking historical player required' USING ERRCODE='22023'; END IF;
 IF NOT ranking_v1_private.valid_order(NEW.payload,e.rules) THEN RAISE EXCEPTION 'ranking prediction invalid' USING ERRCODE='22023'; END IF;
 NEW.submitted_at:=CASE WHEN TG_OP='UPDATE' THEN OLD.submitted_at ELSE clock_timestamp() END;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $f$;

CREATE OR REPLACE FUNCTION ranking_v1_private.guard_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.preset_type='ranking_v1' THEN RAISE EXCEPTION 'prototype deletion disabled' USING ERRCODE='42501'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.preset_type IS DISTINCT FROM NEW.preset_type
  AND 'ranking_v1' IN(OLD.preset_type,NEW.preset_type) THEN
  RAISE EXCEPTION 'ranking preset identity immutable' USING ERRCODE='42501';
 END IF;
 IF NEW.preset_type<>'ranking_v1' THEN RETURN NEW; END IF;
 IF auth.uid() IS NULL OR NOT public.is_league_admin(NEW.league_id) THEN RAISE EXCEPTION 'ranking admin required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.league_members lm WHERE lm.league_id=NEW.league_id AND lm.user_id=auth.uid()
  AND lm.membership_status='active' AND lm.role IN('owner','co_owner') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'ranking admin required' USING ERRCODE='42501'; END IF;
 IF NEW.prediction_deadline IS NULL OR NOT ranking_v1_private.valid_config(NEW.rules) THEN
  RAISE EXCEPTION 'ranking config or deadline invalid' USING ERRCODE='22023';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' OR NEW.created_by IS DISTINCT FROM auth.uid() OR NEW.prediction_deadline<=clock_timestamp() THEN
   RAISE EXCEPTION 'ranking must start as draft with future deadline' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.league_id IS DISTINCT FROM OLD.league_id
  OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN RAISE EXCEPTION 'ranking event identity immutable' USING ERRCODE='42501'; END IF;
 IF OLD.status='draft' THEN
  IF NEW.status NOT IN('draft','open') OR NEW.prediction_deadline<=clock_timestamp() THEN
   RAISE EXCEPTION 'ranking invalid draft transition' USING ERRCODE='42501';
  END IF;
  IF NEW.status='open' AND (NEW.rules IS DISTINCT FROM OLD.rules OR NEW.prediction_deadline IS DISTINCT FROM OLD.prediction_deadline) THEN
   RAISE EXCEPTION 'review draft config before opening' USING ERRCODE='42501';
  END IF;
 ELSE
  IF NEW.rules IS DISTINCT FROM OLD.rules OR NEW.prediction_deadline IS DISTINCT FROM OLD.prediction_deadline
   OR NEW.sport_type IS DISTINCT FROM OLD.sport_type THEN RAISE EXCEPTION 'ranking opened rules immutable' USING ERRCODE='42501'; END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
   (OLD.status='open' AND NEW.status='resultWait' AND clock_timestamp()>=OLD.prediction_deadline)
   OR (OLD.status='resultWait' AND NEW.status='finalized' AND EXISTS(
     SELECT 1 FROM ranking_v1_private.finalize_permits p
     WHERE p.event_id=OLD.id AND p.actor=auth.uid() AND p.txid=txid_current()))
  ) THEN
   RAISE EXCEPTION 'ranking transition denied' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $f$;

CREATE FUNCTION ranking_v1_private.bind_prediction_player() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE e public.events%ROWTYPE; v_player uuid;
BEGIN
 SELECT * INTO e FROM public.events WHERE id=NEW.event_id;
 IF e.preset_type IS DISTINCT FROM 'ranking_v1' THEN RETURN NEW; END IF;
 SELECT id INTO v_player FROM public.players WHERE league_id=e.league_id AND profile_id=NEW.user_id FOR KEY SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'ranking historical player required' USING ERRCODE='22023'; END IF;
 INSERT INTO ranking_v1_private.prediction_players VALUES(e.id,NEW.user_id,e.league_id,v_player)
 ON CONFLICT(event_id,user_id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM ranking_v1_private.prediction_players b
  WHERE b.event_id=e.id AND b.user_id=NEW.user_id AND b.league_id=e.league_id AND b.player_id=v_player) THEN
  RAISE EXCEPTION 'ranking historical player mismatch' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER ranking_v1_bind_prediction AFTER INSERT OR UPDATE ON public.predictions
 FOR EACH ROW EXECUTE FUNCTION ranking_v1_private.bind_prediction_player();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ranking_v1_private FROM PUBLIC,anon,authenticated;
