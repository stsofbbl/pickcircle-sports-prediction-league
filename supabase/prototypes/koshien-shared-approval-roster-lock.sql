-- PROTOTYPE ONLY. NOT A PRODUCTION MIGRATION.
-- Only eligibility/identity-changing writes acquire a common league lock:
-- all INSERT/DELETE and UPDATE of membership role/status or player identity.
-- This serializes absent rows and relevant UPDATE/DELETE with
-- Koshien submissions and votes. Install all triggers and RPC changes together.
CREATE FUNCTION yoso_approval_private.lock_shared_approval_roster_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v_old_league uuid;
 v_new_league uuid;
 v_league uuid;
BEGIN
 IF TG_OP='INSERT' THEN
   v_new_league := NEW.league_id;
 ELSIF TG_OP='DELETE' THEN
   v_old_league := OLD.league_id;
 ELSE
   v_old_league := OLD.league_id;
   v_new_league := NEW.league_id;
 END IF;
 -- Lock in UUID order for cross-league moves, including both source and target.
 FOR v_league IN
   SELECT DISTINCT x.league_id
   FROM unnest(ARRAY[v_old_league,v_new_league]) AS x(league_id)
   WHERE x.league_id IS NOT NULL ORDER BY x.league_id
 LOOP
   PERFORM 1 FROM public.leagues l WHERE l.id=v_league FOR UPDATE;
   IF NOT FOUND THEN
     -- During a parent league's ON DELETE CASCADE, child DELETE may no
     -- longer see the parent; do not block the valid club deletion.
     IF TG_OP='DELETE' THEN CONTINUE; END IF;
     RAISE EXCEPTION 'league must exist for shared approval roster write'
       USING ERRCODE='23503';
   END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION yoso_approval_private.lock_shared_approval_roster_write()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER yoso_lock_shared_approval_membership
 BEFORE INSERT OR DELETE OR UPDATE OF league_id,user_id,role,membership_status ON public.league_members
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.lock_shared_approval_roster_write();
CREATE TRIGGER yoso_lock_shared_approval_player
 BEFORE INSERT OR DELETE OR UPDATE OF id,league_id,profile_id ON public.players
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.lock_shared_approval_roster_write();
