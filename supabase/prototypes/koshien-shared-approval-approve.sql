-- PROTOTYPE ONLY. No production migration or UI activation.
-- Full quorum approval and exact one-time event transition in one transaction.
CREATE FUNCTION public.approve_koshien_shared_results(
 p_event_id text,p_submission_id uuid,p_expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v_uid uuid := auth.uid();
 v_event public.events;
 v_revision bigint;
 v_submission yoso_approval_private.submissions;
 v_current_eligible uuid[];
 v_votes bigint;
 v_inserted integer;
 v_cards jsonb;
 v_results jsonb;
 v_scores jsonb;
 v_flow jsonb;
 v_finalized_at timestamptz;
BEGIN
 IF v_uid IS NULL THEN
   RAISE EXCEPTION 'authentication is required' USING ERRCODE='42501';
 END IF;
 SELECT e.* INTO v_event FROM public.events e
 WHERE e.id=p_event_id AND e.preset_type='koshien' FOR UPDATE;
 IF v_event.id IS NULL THEN
   RAISE EXCEPTION 'Koshien event is required' USING ERRCODE='42501';
 END IF;
 -- Match the league row locked by membership/player INSERT/UPDATE/DELETE
 -- BEFORE triggers, so even a previously absent roster row cannot appear
 -- between eligibility selection and submission/finalization.
 PERFORM 1 FROM public.leagues l WHERE l.id=v_event.league_id FOR SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'approval league not found' USING ERRCODE='23503';
 END IF;
 IF NOT public.is_league_member(v_event.league_id) THEN
   RAISE EXCEPTION 'active league membership is required' USING ERRCODE='42501';
 END IF;
 v_revision := yoso_approval_private.lock_revision(p_event_id);
 IF p_expected_revision IS NULL OR p_expected_revision<>v_revision THEN
   RAISE EXCEPTION 'stale approval revision' USING ERRCODE='40001';
 END IF;
 SELECT s.* INTO v_submission FROM yoso_approval_private.submissions s
 WHERE s.id=p_submission_id AND s.event_id=p_event_id
   AND s.revision=v_revision AND s.status IN ('submitted','finalized')
 FOR UPDATE;
 IF v_submission.id IS NULL THEN
   RAISE EXCEPTION 'stale or missing submission' USING ERRCODE='40001';
 END IF;
 IF v_submission.status='finalized' THEN
   IF v_event.status<>'finalized' THEN
     RAISE EXCEPTION 'approval/event mismatch' USING ERRCODE='55000';
   END IF;
   SELECT count(*) INTO v_votes FROM yoso_approval_private.votes
   WHERE submission_id=v_submission.id;
   RETURN jsonb_build_object('submission_id',v_submission.id,'revision',v_revision,
     'submission_status','finalized','approved_count',v_votes,
     'required_count',v_submission.required_count,'idempotent',true);
 END IF;
 IF v_event.status<>'resultWait' THEN
   RAISE EXCEPTION 'event is not awaiting result approval' USING ERRCODE='55000';
 END IF;
 -- Re-evaluate current active voter roster and approval policy on every vote.
 SELECT array_agg(DISTINCT p.profile_id ORDER BY p.profile_id)
 INTO v_current_eligible
 FROM public.players p JOIN public.league_members lm
   ON lm.league_id=p.league_id AND lm.user_id=p.profile_id
 WHERE p.league_id=v_event.league_id AND p.profile_id IS NOT NULL
   AND lm.membership_status='active';
 IF v_current_eligible IS DISTINCT FROM v_submission.eligible_user_ids
    OR v_event.rules->>'approvalPolicy' IS DISTINCT FROM v_submission.policy THEN
   UPDATE yoso_approval_private.submissions SET status='superseded'
   WHERE id=v_submission.id;
   RETURN jsonb_build_object('submission_status','stale',
     'requires_resubmission',true,'revision',v_revision);
 END IF;
 IF NOT v_uid=ANY(v_submission.eligible_user_ids) THEN
   RAISE EXCEPTION 'voter is not eligible' USING ERRCODE='42501';
 END IF;
 INSERT INTO yoso_approval_private.votes(submission_id,voter_user_id)
 VALUES(v_submission.id,v_uid) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS v_inserted=ROW_COUNT;
 SELECT count(*) INTO v_votes FROM yoso_approval_private.votes
 WHERE submission_id=v_submission.id;
 IF v_votes<v_submission.required_count THEN
   RETURN jsonb_build_object('submission_id',v_submission.id,
     'revision',v_revision,'submission_status','submitted',
     'required_count',v_submission.required_count,'approved_count',v_votes,
     'idempotent',v_inserted=0);
 END IF;
 -- Compare the private audit snapshot before granting finalization.
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.round_key,m.match_no),
   '[]'::jsonb) INTO v_cards FROM public.matches m WHERE m.event_id=p_event_id;
 SELECT r.payload INTO v_results FROM public.results r WHERE r.event_id=p_event_id;
 SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.player_id),'[]'::jsonb)
 INTO v_scores FROM public.scores s JOIN public.players p ON p.id=s.player_id
 WHERE s.event_id=p_event_id AND p.league_id=v_event.league_id
   AND p.profile_id=ANY(v_submission.eligible_user_ids);
 IF jsonb_build_object('matches',v_cards,'results',v_results,
      'scores',v_scores) IS DISTINCT FROM v_submission.result_snapshot THEN
   UPDATE yoso_approval_private.submissions SET status='superseded'
   WHERE id=v_submission.id;
   RETURN jsonb_build_object('submission_status','stale',
     'requires_resubmission',true,'revision',v_revision);
 END IF;
 v_finalized_at := pg_catalog.clock_timestamp();
 v_flow := jsonb_build_object('status','finalized',
    'submittedBy',v_submission.submitted_by::text,
    'submittedAt',v_submission.submitted_at::text,
    'approvals',jsonb_build_object('count',v_votes),
    'finalizedAt',v_finalized_at::text);
 INSERT INTO yoso_approval_private.transition_permits(
    event_id,transaction_id,actor_id,old_status,new_status,old_flow,new_flow
 ) VALUES(p_event_id,pg_catalog.txid_current(),v_uid,v_event.status,
    'finalized',v_event.rules->'resultFlow',v_flow);
 UPDATE public.events SET status='finalized',
    rules=jsonb_set(coalesce(rules,'{}'::jsonb),'{resultFlow}',v_flow,true),
    updated_at=pg_catalog.now()
 WHERE id=p_event_id;
 UPDATE yoso_approval_private.submissions SET status='finalized',
    finalized_at=v_finalized_at WHERE id=v_submission.id;
 RETURN jsonb_build_object('submission_id',v_submission.id,'revision',v_revision,
   'submission_status','finalized','required_count',v_submission.required_count,
   'approved_count',v_votes,'idempotent',v_inserted=0);
END;
$function$;
REVOKE ALL ON FUNCTION public.approve_koshien_shared_results(text,uuid,bigint)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.approve_koshien_shared_results(text,uuid,bigint)
 TO authenticated;
