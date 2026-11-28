-- REVIEW PROTOTYPE ONLY. Outside migrations; never apply to production.
-- Uses existing event/prediction tables. No result publication or scoring write path yet.
CREATE SCHEMA ranking_v1_private;
REVOKE ALL ON SCHEMA ranking_v1_private FROM PUBLIC,anon,authenticated;

CREATE FUNCTION ranking_v1_private.valid_config(c jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $f$
DECLARE item jsonb; candidate_id text; label text; ids text[]:='{}'; labels text[]:='{}'; multiplier numeric;
BEGIN
 IF jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF NOT (c ?& ARRAY['version','candidates']) OR (SELECT count(*) FROM jsonb_object_keys(c))<>2
  OR c->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(c->'candidates') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(c->'candidates') NOT BETWEEN 4 AND 128 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(c->'candidates') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF NOT (item ?& ARRAY['id','label','multiplierTenths']) OR (SELECT count(*) FROM jsonb_object_keys(item))<>3
   OR jsonb_typeof(item->'id') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'label') IS DISTINCT FROM 'string'
   OR jsonb_typeof(item->'multiplierTenths') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
  candidate_id:=item->>'id'; label:=item->>'label'; multiplier:=(item->>'multiplierTenths')::numeric;
  -- JS contract measures UTF-16 units; each supplementary code point adds one.
  IF candidate_id !~ '^[A-Za-z0-9_-]{1,64}$' OR candidate_id=ANY(ids)
   OR length(label)+length(regexp_replace(label,U&'[^\+010000-\+10FFFF]','','g')) NOT BETWEEN 1 AND 100
   OR label IS DISTINCT FROM btrim(label,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
   OR normalize(label,NFC)=ANY(labels)
   OR multiplier NOT BETWEEN 1 AND 1000 OR trunc(multiplier)<>multiplier THEN RETURN false; END IF;
  ids:=array_append(ids,candidate_id); labels:=array_append(labels,normalize(label,NFC));
 END LOOP;
 RETURN true;
END $f$;

CREATE FUNCTION ranking_v1_private.valid_order(p jsonb,c jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $f$
DECLARE item jsonb; ids text[]:='{}'; candidate_id text;
BEGIN
 IF NOT ranking_v1_private.valid_config(c) OR jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN false; END IF;
 IF NOT (p ?& ARRAY['version','candidateIds']) OR (SELECT count(*) FROM jsonb_object_keys(p))<>2
  OR p->'version' IS DISTINCT FROM '1'::jsonb OR jsonb_typeof(p->'candidateIds') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
 IF jsonb_array_length(p->'candidateIds')<>4 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p->'candidateIds') LOOP
  IF jsonb_typeof(item) IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  candidate_id:=item #>> '{}';
  IF candidate_id=ANY(ids) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c->'candidates') x WHERE x->>'id'=candidate_id) THEN RETURN false; END IF;
  ids:=array_append(ids,candidate_id);
 END LOOP;
 RETURN true;
END $f$;

CREATE FUNCTION ranking_v1_private.guard_event() RETURNS trigger
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
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (OLD.status='open' AND NEW.status='resultWait' AND clock_timestamp()>=OLD.prediction_deadline) THEN
   RAISE EXCEPTION 'ranking transition denied' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER ranking_v1_event_guard BEFORE INSERT OR UPDATE OR DELETE ON public.events
 FOR EACH ROW EXECUTE FUNCTION ranking_v1_private.guard_event();

CREATE FUNCTION ranking_v1_private.guard_prediction() RETURNS trigger
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
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NOT ranking_v1_private.valid_order(NEW.payload,e.rules) THEN RAISE EXCEPTION 'ranking prediction invalid' USING ERRCODE='22023'; END IF;
 NEW.submitted_at:=CASE WHEN TG_OP='UPDATE' THEN OLD.submitted_at ELSE clock_timestamp() END;
 NEW.updated_at:=clock_timestamp();
 RETURN NEW;
END $f$;
CREATE TRIGGER ranking_v1_prediction_guard BEFORE INSERT OR UPDATE OR DELETE ON public.predictions
 FOR EACH ROW EXECUTE FUNCTION ranking_v1_private.guard_prediction();

-- Existing policy still requires a member and ownership/publication. This
-- restrictive policy additionally prevents early publication for ranking_v1.
CREATE POLICY ranking_v1_prediction_visibility ON public.predictions AS RESTRICTIVE FOR SELECT TO authenticated
 USING (NOT EXISTS(SELECT 1 FROM public.events e WHERE e.id=predictions.event_id AND e.preset_type='ranking_v1')
 OR (user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.events e WHERE e.id=predictions.event_id AND e.preset_type='ranking_v1' AND public.is_league_member(e.league_id)))
 OR EXISTS(SELECT 1 FROM public.events e WHERE e.id=predictions.event_id AND e.preset_type='ranking_v1'
   AND public.is_league_member(e.league_id) AND e.status IN('open','resultWait')
   AND e.prediction_deadline IS NOT NULL AND clock_timestamp()>=e.prediction_deadline));

-- Deny every result/score DML for the prototype, even to an admin. A later
-- atomic finalized-result RPC will need its own narrowly scoped permission.
CREATE FUNCTION ranking_v1_private.block_unimplemented_result() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
BEGIN
 IF EXISTS(SELECT 1 FROM public.events e WHERE e.preset_type='ranking_v1' AND
  (e.id=CASE WHEN TG_OP<>'INSERT' THEN OLD.event_id ELSE NULL END
   OR e.id=CASE WHEN TG_OP<>'DELETE' THEN NEW.event_id ELSE NULL END)) THEN
  RAISE EXCEPTION 'ranking result write not implemented' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER ranking_v1_result_guard BEFORE INSERT OR UPDATE OR DELETE ON public.results
 FOR EACH ROW EXECUTE FUNCTION ranking_v1_private.block_unimplemented_result();
CREATE TRIGGER ranking_v1_score_guard BEFORE INSERT OR UPDATE OR DELETE ON public.scores
 FOR EACH ROW EXECUTE FUNCTION ranking_v1_private.block_unimplemented_result();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ranking_v1_private FROM PUBLIC,anon,authenticated;
