-- PROTOTYPE ONLY. This is not a migration, do not apply to production alone.
-- A shared approval record is server-owned, never client DML.
CREATE TABLE yoso_approval_private.submissions (
 id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
 event_id text NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
 revision bigint NOT NULL CHECK (revision >= 0),
 policy text NOT NULL CHECK (policy IN ('admin','half','unanimous')),
 eligible_user_ids uuid[] NOT NULL CHECK (cardinality(eligible_user_ids) >= 1),
 required_count integer NOT NULL CHECK (
   required_count >= 1 AND required_count <= cardinality(eligible_user_ids)
 ),
 -- The server-owned record must not drift from the established approval policy.
 CHECK (required_count = CASE policy
    WHEN 'admin' THEN 1
    WHEN 'half' THEN (cardinality(eligible_user_ids)+1)/2
    WHEN 'unanimous' THEN cardinality(eligible_user_ids)
    ELSE NULL END),
 submitted_by uuid NOT NULL,
 status text NOT NULL DEFAULT 'submitted'
   CHECK (status IN ('submitted','finalized','superseded')),
 result_snapshot jsonb NOT NULL,
 submitted_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
 finalized_at timestamptz,
 CHECK (submitted_by = ANY(eligible_user_ids)),
 CHECK ((status = 'finalized') = (finalized_at IS NOT NULL))
);
CREATE UNIQUE INDEX active_koshien_submission_per_event
 ON yoso_approval_private.submissions(event_id) WHERE status='submitted';
CREATE TABLE yoso_approval_private.votes (
 submission_id uuid NOT NULL REFERENCES yoso_approval_private.submissions(id) ON DELETE CASCADE,
 voter_user_id uuid NOT NULL,
 approved_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
 PRIMARY KEY(submission_id,voter_user_id)
);
ALTER TABLE yoso_approval_private.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoso_approval_private.votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON yoso_approval_private.submissions FROM PUBLIC,authenticated,anon,service_role;
REVOKE ALL ON yoso_approval_private.votes FROM PUBLIC,authenticated,anon,service_role;

CREATE FUNCTION public.get_koshien_shared_approval_state(p_event_id text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
 v_event public.events;
 v_revision bigint;
 v_submission yoso_approval_private.submissions;
 v_votes bigint;
 v_uid uuid;
BEGIN
 v_uid := auth.uid();
 IF v_uid IS NULL THEN
   RAISE EXCEPTION 'authentication is required' USING ERRCODE='42501';
 END IF;
 SELECT e.* INTO v_event FROM public.events e
 WHERE e.id=p_event_id AND e.preset_type='koshien';
 IF v_event.id IS NULL OR NOT public.is_league_member(v_event.league_id) THEN
   RAISE EXCEPTION 'active league membership is required' USING ERRCODE='42501';
 END IF;
 -- A read RPC must not call lock_revision: that would create/update rows.
 SELECT r.revision INTO v_revision FROM yoso_approval_private.revisions r
 WHERE r.event_id=p_event_id;
 v_revision := coalesce(v_revision,0);

 SELECT s.* INTO v_submission FROM yoso_approval_private.submissions s
 WHERE s.event_id=p_event_id AND s.revision=v_revision
   AND s.status IN ('submitted','finalized')
 ORDER BY s.submitted_at DESC,s.id DESC LIMIT 1;

 IF v_submission.id IS NULL THEN
   RETURN jsonb_build_object(
     'event_id',p_event_id,'event_status',v_event.status,
     'revision',v_revision,'submission_status','none',
     'approval_policy',v_event.rules->>'approvalPolicy',
     'submission_id',NULL,'required_count',0,'approved_count',0,
     'current_user_eligible',false,'current_user_voted',false
   );
 END IF;
 SELECT count(*) INTO v_votes FROM yoso_approval_private.votes v
 WHERE v.submission_id=v_submission.id;
 RETURN jsonb_build_object(
   'event_id',p_event_id,'event_status',v_event.status,
   'revision',v_revision,'submission_status',v_submission.status,
   'submission_id',v_submission.id,'policy',v_submission.policy,
   'approval_policy',v_event.rules->>'approvalPolicy',
   'required_count',v_submission.required_count,'approved_count',v_votes,
   'eligible_count',cardinality(v_submission.eligible_user_ids),
   'current_user_eligible',v_uid=ANY(v_submission.eligible_user_ids),
   'current_user_voted',EXISTS(
     SELECT 1 FROM yoso_approval_private.votes v
     WHERE v.submission_id=v_submission.id AND v.voter_user_id=v_uid
   ),
   'submitted_at',v_submission.submitted_at,'finalized_at',v_submission.finalized_at
 );
END;
$function$;
REVOKE ALL ON FUNCTION public.get_koshien_shared_approval_state(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_koshien_shared_approval_state(text) TO authenticated;

-- Atomic companion guard: no silent status reset while a vote is pending.
-- Existing approval-state permit still owns the resultWait -> finalized transition.
-- This also rejects newly inserted pre-finalized Koshien events that would
-- otherwise bypass the approval RPC through the ordinary events INSERT policy.
CREATE FUNCTION yoso_approval_private.protect_shared_approval_event_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
BEGIN
 IF TG_OP='INSERT' THEN
   IF NEW.preset_type='koshien' AND
     (NEW.status='finalized' OR NEW.rules->'resultFlow'->>'status'='finalized') THEN
     RAISE EXCEPTION 'Koshien results require shared approval before finalization'
       USING ERRCODE='42501';
   END IF;
   RETURN NEW;
 END IF;
 IF OLD.preset_type='koshien' OR NEW.preset_type='koshien' THEN
   -- Only actual pending submissions block a status rollback. A normal
   -- shared quorum may still change resultWait -> finalized; that transition
   -- is separately protected by the exact one-use transition permit.
   IF NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IS DISTINCT FROM 'finalized'
     AND EXISTS (
       SELECT 1 FROM yoso_approval_private.submissions s
       WHERE s.event_id=OLD.id AND s.status='submitted'
     ) THEN
     RAISE EXCEPTION 'pending result approval blocks changing event status'
       USING ERRCODE='55000';
   END IF;

   -- Do not let ordinary events UPDATE/RLS change a scoring definition
   -- underneath already cast approval votes or a finalized tournament.
   -- The legitimate policy RPC changes only approvalPolicy, and the
   -- finalize/reopen RPCs change only resultFlow/status.
   IF (
       (coalesce(NEW.rules,'{}'::jsonb) - 'approvalPolicy' - 'resultFlow')
         IS DISTINCT FROM
       (coalesce(OLD.rules,'{}'::jsonb) - 'approvalPolicy' - 'resultFlow')
       OR NEW.rules_config IS DISTINCT FROM OLD.rules_config
       OR NEW.current_phase IS DISTINCT FROM OLD.current_phase
       OR NEW.prediction_deadline IS DISTINCT FROM OLD.prediction_deadline
       OR NEW.sport_type IS DISTINCT FROM OLD.sport_type
       OR NEW.season IS DISTINCT FROM OLD.season
     )
     AND (OLD.status='finalized' OR EXISTS (
       SELECT 1 FROM yoso_approval_private.submissions s
       WHERE s.event_id=OLD.id AND s.status='submitted'
     )) THEN
     RAISE EXCEPTION 'approval-sensitive event settings require reopening or resubmission'
       USING ERRCODE='55000';
   END IF;
 END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION yoso_approval_private.protect_shared_approval_event_status()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER yoso_protect_shared_approval_event_status
 BEFORE INSERT OR UPDATE ON public.events
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.protect_shared_approval_event_status();


-- Shared lock domain for team writers and the submit/vote RPCs.
-- Every caller uses the same transaction-scoped, event-specific lock key.
-- The row DML trigger uses TRY rather than WAIT because PostgreSQL has
-- already acquired the team row lock before a BEFORE ROW trigger executes.
-- Waiting here while a vote holds the event row would invert event->team.
CREATE FUNCTION yoso_approval_private.team_config_lock_key(p_event_id text)
RETURNS bigint LANGUAGE sql IMMUTABLE STRICT SET search_path=''
AS $function$
 SELECT pg_catalog.hashtextextended('yoso:koshien:team-config:' || p_event_id,0::bigint)
$function$;
REVOKE ALL ON FUNCTION yoso_approval_private.team_config_lock_key(text)
 FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION yoso_approval_private.protect_koshien_team_configuration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v_ids text[];
 v_event_id text;
 v_event_status text;
 v_preset text;
BEGIN
 IF TG_OP='UPDATE' THEN
   -- The audit excludes timestamps: a pure updated_at refresh is harmless.
   IF (to_jsonb(NEW) - 'created_at' - 'updated_at')
      IS NOT DISTINCT FROM (to_jsonb(OLD) - 'created_at' - 'updated_at') THEN
     RETURN NEW;
   END IF;
   v_ids := ARRAY[OLD.event_id,NEW.event_id];
 ELSIF TG_OP='INSERT' THEN
   v_ids := ARRAY[NEW.event_id];
 ELSE
   v_ids := ARRAY[OLD.event_id];
 END IF;

 -- Lock both old and new event scopes in one deterministic order if a team
 -- row is moved between events. No event/league row lock in this trigger.
 FOR v_event_id IN
   SELECT DISTINCT x.id FROM pg_catalog.unnest(v_ids) AS x(id)
   WHERE x.id IS NOT NULL ORDER BY x.id
 LOOP
   IF NOT pg_catalog.pg_try_advisory_xact_lock(
     yoso_approval_private.team_config_lock_key(v_event_id)
   ) THEN
     RAISE EXCEPTION 'team configuration is being approved; retry the change'
       USING ERRCODE='55P03';
   END IF;

   SELECT e.preset_type,e.status INTO v_preset,v_event_status
   FROM public.events e WHERE e.id=v_event_id;
   IF v_preset='koshien' AND (
     v_event_status='finalized'
     OR EXISTS (
       SELECT 1 FROM yoso_approval_private.submissions s
       WHERE s.event_id=v_event_id AND s.status='submitted'
     )
   ) THEN
     RAISE EXCEPTION 'Koshien team configuration is locked during approval'
       USING ERRCODE='55000';
   END IF;
 END LOOP;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION yoso_approval_private.protect_koshien_team_configuration()
 FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER yoso_protect_koshien_team_configuration
 BEFORE INSERT OR UPDATE OR DELETE ON public.teams
 FOR EACH ROW EXECUTE FUNCTION yoso_approval_private.protect_koshien_team_configuration();
