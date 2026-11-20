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
