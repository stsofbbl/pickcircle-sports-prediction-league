-- PROTOTYPE ONLY: shared result submission, not a migration or deployable RPC.
-- Requires koshien-shared-approval-read.sql and existing revision/permit boundaries.
CREATE FUNCTION public.submit_koshien_shared_results(p_event_id text,p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v_uid uuid := auth.uid();
 v_event public.events;
 v_revision bigint;
 v_policy text;
 v_eligible uuid[];
 v_required integer;
 v_good boolean;
 v_results jsonb;
 v_scores jsonb;
 v_cards jsonb;
 v_scored integer;
 v_existing yoso_approval_private.submissions;
 v_id uuid;
BEGIN
 IF v_uid IS NULL THEN
   RAISE EXCEPTION 'authentication is required' USING ERRCODE='42501';
 END IF;
 SELECT e.* INTO v_event FROM public.events e
 WHERE e.id=p_event_id AND e.preset_type='koshien' FOR UPDATE;
 IF v_event.id IS NULL OR NOT public.is_league_admin(v_event.league_id) THEN
   RAISE EXCEPTION 'active league admin permission is required' USING ERRCODE='42501';
 END IF;
 IF v_event.status<>'resultWait'
    OR v_event.rules->'resultFlow'->>'status'='finalized' THEN
   RAISE EXCEPTION 'result submission requires resultWait' USING ERRCODE='55000';
 END IF;
 IF v_event.prediction_deadline IS NULL
    OR v_event.prediction_deadline > pg_catalog.clock_timestamp() THEN
   RAISE EXCEPTION 'prediction deadline has not passed' USING ERRCODE='55000';
 END IF;
 v_revision := yoso_approval_private.lock_revision(p_event_id);
 IF p_expected_revision IS NULL OR p_expected_revision<>v_revision THEN
   RAISE EXCEPTION 'stale approval revision' USING ERRCODE='40001';
 END IF;
 v_policy := v_event.rules->>'approvalPolicy';
 IF v_policy NOT IN ('admin','half','unanimous') OR v_policy IS NULL THEN
   RAISE EXCEPTION 'unsupported result approval policy' USING ERRCODE='55000';
 END IF;
 SELECT array_agg(DISTINCT p.profile_id ORDER BY p.profile_id) INTO v_eligible
 FROM public.players p JOIN public.league_members lm
   ON lm.league_id=p.league_id AND lm.user_id=p.profile_id
 WHERE p.league_id=v_event.league_id AND p.profile_id IS NOT NULL
   AND lm.membership_status='active';
 IF coalesce(cardinality(v_eligible),0)=0 OR NOT v_uid=ANY(v_eligible) THEN
   RAISE EXCEPTION 'submitter must be an active event participant'
     USING ERRCODE='42501';
 END IF;
 v_required := CASE v_policy
   WHEN 'admin' THEN 1
   WHEN 'half' THEN (cardinality(v_eligible)+1)/2
   ELSE cardinality(v_eligible) END;

 -- Do not submit incomplete or ambiguous brackets. Official Koshien has 48
 -- slots: R1=17, R2=16, R3=8, QF=4, SF=2, F=1.
 SELECT count(*)=48
   AND count(*) FILTER (WHERE m.round_key='R1')=17
   AND count(*) FILTER (WHERE m.round_key='R2')=16
   AND count(*) FILTER (WHERE m.round_key='R3')=8
   AND count(*) FILTER (WHERE m.round_key='QF')=4
   AND count(*) FILTER (WHERE m.round_key='SF')=2
   AND count(*) FILTER (WHERE m.round_key='F')=1
   AND count(*) FILTER (WHERE m.status='completed'
      AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
      AND m.team1_id<>m.team2_id
      AND m.team1_score IS NOT NULL AND m.team2_score IS NOT NULL
      AND m.team1_score>=0 AND m.team2_score>=0
      AND m.team1_score<>m.team2_score
      AND m.winner_team_id=(CASE WHEN m.team1_score>m.team2_score
        THEN m.team1_id ELSE m.team2_id END)
      AND m.loser_team_id=(CASE WHEN m.team1_score>m.team2_score
        THEN m.team2_id ELSE m.team1_id END))=48
 INTO v_good FROM public.matches m WHERE m.event_id=p_event_id;
 IF NOT coalesce(v_good,false) THEN
   RAISE EXCEPTION 'all 48 official matches must be valid and completed'
     USING ERRCODE='55000';
 END IF;
 SELECT r.payload INTO v_results FROM public.results r WHERE r.event_id=p_event_id;
 IF v_results IS NULL OR jsonb_typeof(v_results->'matches')<>'array'
   OR jsonb_array_length(v_results->'matches')<>48 THEN
   RAISE EXCEPTION 'result payload must contain 48 match slots'
     USING ERRCODE='55000';
 END IF;
 SELECT count(DISTINCT s.player_id),
   coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.player_id),'[]'::jsonb)
 INTO v_scored,v_scores
 FROM public.scores s JOIN public.players p ON p.id=s.player_id
 WHERE s.event_id=p_event_id AND p.league_id=v_event.league_id
   AND p.profile_id=ANY(v_eligible);
 IF v_scored<>cardinality(v_eligible) THEN
   RAISE EXCEPTION 'scores for all active participants are required'
     USING ERRCODE='55000';
 END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.round_key,m.match_no),'[]'::jsonb)
 INTO v_cards FROM public.matches m WHERE m.event_id=p_event_id;

 -- Revision changes supersede older submissions, without reusing their votes.
 UPDATE yoso_approval_private.submissions SET status='superseded'
 WHERE event_id=p_event_id AND status='submitted' AND revision<>v_revision;
 SELECT s.* INTO v_existing FROM yoso_approval_private.submissions s
 WHERE s.event_id=p_event_id AND s.status='submitted' FOR UPDATE;
 IF v_existing.id IS NOT NULL THEN
   IF v_existing.revision=v_revision AND v_existing.submitted_by=v_uid
      AND v_existing.policy=v_policy
      AND v_existing.eligible_user_ids=v_eligible
      AND v_existing.required_count=v_required THEN
     RETURN jsonb_build_object('submission_id',v_existing.id,
       'revision',v_revision,'submission_status','submitted',
       'required_count',v_required,'approved_count',1,'idempotent',true);
   END IF;
   RAISE EXCEPTION 'another active submission already exists' USING ERRCODE='55000';
 END IF;
 INSERT INTO yoso_approval_private.submissions(
    event_id,revision,policy,eligible_user_ids,required_count,
    submitted_by,status,result_snapshot
 ) VALUES(p_event_id,v_revision,v_policy,v_eligible,v_required,v_uid,
  'submitted',jsonb_build_object('matches',v_cards,'results',v_results,
  'scores',v_scores)) RETURNING id INTO v_id;
 INSERT INTO yoso_approval_private.votes(submission_id,voter_user_id)
 VALUES(v_id,v_uid);
 RETURN jsonb_build_object('submission_id',v_id,'revision',v_revision,
   'submission_status','submitted','required_count',v_required,
   'approved_count',1,'idempotent',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_koshien_shared_results(text,bigint)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_koshien_shared_results(text,bigint)
 TO authenticated;
