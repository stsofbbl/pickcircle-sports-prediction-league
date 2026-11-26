-- REVIEW PROTOTYPE ONLY. After api.sql, in disposable CI.
-- Draft creation/edit/open/close must use scoped RPCs, not direct DML.
CREATE TABLE ranking_v1_private.management_permits(
 event_id text NOT NULL,actor uuid NOT NULL,txid bigint NOT NULL,action text NOT NULL,
 PRIMARY KEY(event_id,actor,txid,action));
ALTER TABLE ranking_v1_private.management_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ranking_v1_private.management_permits FROM PUBLIC,anon,authenticated;

CREATE FUNCTION ranking_v1_private.guard_management() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE action_needed text;
BEGIN
 IF NEW.preset_type IS DISTINCT FROM 'ranking_v1' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN action_needed:='create';
 ELSIF OLD.status='draft' THEN
  action_needed:=CASE WHEN NEW.status='open' THEN 'open' ELSE 'edit' END;
 ELSIF OLD.status='open' AND NEW.status='resultWait' THEN action_needed:='close';
 END IF;
 IF action_needed IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM ranking_v1_private.management_permits p
  WHERE p.event_id=NEW.id AND p.actor=auth.uid() AND p.txid=txid_current() AND p.action=action_needed)
 THEN RAISE EXCEPTION 'ranking management RPC required' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $f$;
CREATE TRIGGER ranking_v1_management_guard BEFORE INSERT OR UPDATE ON public.events
 FOR EACH ROW EXECUTE FUNCTION ranking_v1_private.guard_management();

-- Revision deliberately excludes status, allowing exact lost-response
-- recovery of a just-opened draft. No caller-controlled score or role.
CREATE FUNCTION ranking_v1_private.draft_revision(e public.events) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $f$
 SELECT md5(jsonb_build_array(e.id,e.league_id,e.created_by,e.name,e.sport_type,
   extract(epoch FROM e.prediction_deadline),e.rules)::text)
$f$;
CREATE FUNCTION ranking_v1_private.management_response(e public.events,p_recovered boolean) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $f$
 SELECT jsonb_build_object('actorId',auth.uid(),'leagueId',e.league_id,'eventId',e.id,
 'name',e.name,'sportType',e.sport_type,'deadline',e.prediction_deadline,'config',e.rules,
 'status',e.status,'revision',ranking_v1_private.draft_revision(e),'recovered',p_recovered)
$f$;
CREATE FUNCTION ranking_v1_private.check_management_actor(p_league_id uuid,p_actor_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $f$
BEGIN
 IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_actor_id
  OR NOT public.is_league_admin(p_league_id)
 THEN RAISE EXCEPTION 'ranking management denied' USING ERRCODE='42501'; END IF;
END $f$;
CREATE FUNCTION ranking_v1_private.lock_management_actor(p_league_id uuid,p_actor_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $f$
BEGIN
 PERFORM ranking_v1_private.check_management_actor(p_league_id,p_actor_id);
 PERFORM 1 FROM public.league_members lm WHERE lm.league_id=p_league_id AND lm.user_id=p_actor_id
  AND lm.membership_status='active' AND lm.role IN('owner','co_owner') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'ranking management denied' USING ERRCODE='42501'; END IF;
END $f$;
CREATE FUNCTION ranking_v1_private.check_draft_input(p_name text,p_sport text,p_deadline timestamptz,p_config jsonb) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $f$
BEGIN
 IF p_name IS NULL OR p_name<>btrim(p_name) OR char_length(p_name) NOT BETWEEN 1 AND 120
  OR p_name ~ '[[:cntrl:]]' OR p_sport IS NULL OR p_sport !~ '^[a-z][a-z0-9_-]{0,31}$'
  OR p_deadline IS NULL OR NOT isfinite(p_deadline) OR NOT ranking_v1_private.valid_config(p_config)
 THEN RAISE EXCEPTION 'ranking draft input invalid' USING ERRCODE='22023'; END IF;
END $f$;

CREATE FUNCTION public.ranking_v1_api_create_draft(p_league_id uuid,p_event_id text,p_actor_id uuid,
 p_name text,p_sport text,p_deadline timestamptz,p_config jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE e public.events%ROWTYPE; created boolean:=false;
BEGIN
 PERFORM ranking_v1_private.check_management_actor(p_league_id,p_actor_id);
 IF p_event_id IS NULL OR p_event_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[48][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 THEN RAISE EXCEPTION 'ranking creation ID invalid' USING ERRCODE='22023'; END IF;
 PERFORM ranking_v1_private.check_draft_input(p_name,p_sport,p_deadline,p_config);
 -- Do not expose another club's event on a primary-key collision.
 SELECT * INTO e FROM public.events WHERE id=p_event_id AND league_id=p_league_id AND preset_type='ranking_v1' FOR UPDATE;
 PERFORM ranking_v1_private.lock_management_actor(p_league_id,p_actor_id);
 IF e.id IS NULL THEN
  IF p_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'ranking deadline must be future' USING ERRCODE='22023'; END IF;
  INSERT INTO ranking_v1_private.management_permits VALUES(p_event_id,p_actor_id,txid_current(),'create');
  INSERT INTO public.events(id,league_id,name,preset_type,status,prediction_deadline,rules,created_by,sport_type)
  VALUES(p_event_id,p_league_id,p_name,'ranking_v1','draft',p_deadline,p_config,p_actor_id,p_sport)
  ON CONFLICT(id) DO NOTHING RETURNING * INTO e;
  created:=FOUND;
  DELETE FROM ranking_v1_private.management_permits WHERE event_id=p_event_id AND actor=p_actor_id
    AND txid=txid_current() AND action='create';
  IF NOT created THEN
   SELECT * INTO e FROM public.events WHERE id=p_event_id AND league_id=p_league_id AND preset_type='ranking_v1' FOR UPDATE;
  END IF;
 END IF;
 IF e.id IS NULL OR e.created_by IS DISTINCT FROM p_actor_id OR e.status IS DISTINCT FROM 'draft'
  OR e.name IS DISTINCT FROM p_name OR e.sport_type IS DISTINCT FROM p_sport
  OR e.prediction_deadline IS DISTINCT FROM p_deadline OR e.rules IS DISTINCT FROM p_config
 THEN RAISE EXCEPTION 'ranking creation conflict' USING ERRCODE='PT409'; END IF;
 RETURN ranking_v1_private.management_response(e,NOT created);
END $f$;

CREATE FUNCTION public.ranking_v1_api_draft_review(p_league_id uuid,p_event_id text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $f$
DECLARE e public.events%ROWTYPE;
BEGIN
 PERFORM ranking_v1_private.check_management_actor(p_league_id,p_actor_id);
 SELECT * INTO e FROM public.events WHERE id=p_event_id AND league_id=p_league_id AND preset_type='ranking_v1' AND status='draft';
 IF NOT FOUND THEN RAISE EXCEPTION 'ranking draft unavailable' USING ERRCODE='42501'; END IF;
 RETURN ranking_v1_private.management_response(e,false);
END $f$;

CREATE FUNCTION public.ranking_v1_api_edit_draft(p_league_id uuid,p_event_id text,p_actor_id uuid,p_revision text,
 p_name text,p_sport text,p_deadline timestamptz,p_config jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE e public.events%ROWTYPE;
BEGIN
 PERFORM ranking_v1_private.check_management_actor(p_league_id,p_actor_id);
 SELECT * INTO e FROM public.events WHERE id=p_event_id AND league_id=p_league_id AND preset_type='ranking_v1' FOR UPDATE;
 IF NOT FOUND OR e.status<>'draft' THEN RAISE EXCEPTION 'ranking draft unavailable' USING ERRCODE='42501'; END IF;
 PERFORM ranking_v1_private.lock_management_actor(p_league_id,p_actor_id);
 PERFORM ranking_v1_private.check_draft_input(p_name,p_sport,p_deadline,p_config);
 IF p_revision IS NULL OR p_revision !~ '^[0-9a-f]{32}$' OR p_revision IS DISTINCT FROM ranking_v1_private.draft_revision(e)
 THEN RAISE EXCEPTION 'ranking draft stale' USING ERRCODE='PT409'; END IF;
 IF p_deadline<=clock_timestamp() THEN RAISE EXCEPTION 'ranking deadline must be future' USING ERRCODE='22023'; END IF;
 INSERT INTO ranking_v1_private.management_permits VALUES(e.id,p_actor_id,txid_current(),'edit');
 UPDATE public.events SET name=p_name,sport_type=p_sport,prediction_deadline=p_deadline,rules=p_config
 WHERE id=e.id RETURNING * INTO e;
 DELETE FROM ranking_v1_private.management_permits WHERE event_id=e.id AND actor=p_actor_id AND txid=txid_current() AND action='edit';
 RETURN ranking_v1_private.management_response(e,false);
END $f$;

CREATE FUNCTION public.ranking_v1_api_open(p_league_id uuid,p_event_id text,p_actor_id uuid,p_revision text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE e public.events%ROWTYPE;
BEGIN
 PERFORM ranking_v1_private.check_management_actor(p_league_id,p_actor_id);
 SELECT * INTO e FROM public.events WHERE id=p_event_id AND league_id=p_league_id AND preset_type='ranking_v1' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ranking event unavailable' USING ERRCODE='42501'; END IF;
 PERFORM ranking_v1_private.lock_management_actor(p_league_id,p_actor_id);
 IF p_revision IS NULL OR p_revision !~ '^[0-9a-f]{32}$' OR p_revision IS DISTINCT FROM ranking_v1_private.draft_revision(e)
 THEN RAISE EXCEPTION 'ranking draft stale' USING ERRCODE='PT409'; END IF;
 IF e.status='open' THEN RETURN ranking_v1_private.management_response(e,true); END IF;
 IF e.status<>'draft' OR e.prediction_deadline IS NULL OR e.prediction_deadline<=clock_timestamp()
  OR EXISTS(SELECT 1 FROM public.predictions WHERE event_id=e.id)
  OR EXISTS(SELECT 1 FROM public.results WHERE event_id=e.id)
  OR EXISTS(SELECT 1 FROM public.scores WHERE event_id=e.id)
 THEN RAISE EXCEPTION 'ranking cannot open' USING ERRCODE='42501'; END IF;
 PERFORM ranking_v1_private.check_draft_input(e.name,e.sport_type,e.prediction_deadline,e.rules);
 INSERT INTO ranking_v1_private.management_permits VALUES(e.id,p_actor_id,txid_current(),'open');
 UPDATE public.events SET status='open' WHERE id=e.id RETURNING * INTO e;
 DELETE FROM ranking_v1_private.management_permits WHERE event_id=e.id AND actor=p_actor_id AND txid=txid_current() AND action='open';
 RETURN ranking_v1_private.management_response(e,false);
END $f$;

CREATE FUNCTION public.ranking_v1_api_close(p_league_id uuid,p_event_id text,p_actor_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $f$
DECLARE e public.events%ROWTYPE;
BEGIN
 PERFORM ranking_v1_private.check_management_actor(p_league_id,p_actor_id);
 SELECT * INTO e FROM public.events WHERE id=p_event_id AND league_id=p_league_id AND preset_type='ranking_v1' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'ranking event unavailable' USING ERRCODE='42501'; END IF;
 PERFORM ranking_v1_private.lock_management_actor(p_league_id,p_actor_id);
 IF e.prediction_deadline IS NULL OR e.prediction_deadline>clock_timestamp()
 THEN RAISE EXCEPTION 'ranking deadline not reached' USING ERRCODE='42501'; END IF;
 IF e.status='resultWait' THEN RETURN ranking_v1_private.management_response(e,true); END IF;
 IF e.status<>'open' THEN RAISE EXCEPTION 'ranking cannot close' USING ERRCODE='42501'; END IF;
 INSERT INTO ranking_v1_private.management_permits VALUES(e.id,p_actor_id,txid_current(),'close');
 UPDATE public.events SET status='resultWait' WHERE id=e.id RETURNING * INTO e;
 DELETE FROM ranking_v1_private.management_permits WHERE event_id=e.id AND actor=p_actor_id AND txid=txid_current() AND action='close';
 RETURN ranking_v1_private.management_response(e,false);
END $f$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ranking_v1_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.ranking_v1_api_create_draft(uuid,text,uuid,text,text,timestamptz,jsonb),
 public.ranking_v1_api_draft_review(uuid,text,uuid),public.ranking_v1_api_edit_draft(uuid,text,uuid,text,text,text,timestamptz,jsonb),
 public.ranking_v1_api_open(uuid,text,uuid,text),public.ranking_v1_api_close(uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ranking_v1_api_create_draft(uuid,text,uuid,text,text,timestamptz,jsonb),
 public.ranking_v1_api_draft_review(uuid,text,uuid),public.ranking_v1_api_edit_draft(uuid,text,uuid,text,text,text,timestamptz,jsonb),
 public.ranking_v1_api_open(uuid,text,uuid,text),public.ranking_v1_api_close(uuid,text,uuid) TO authenticated;
