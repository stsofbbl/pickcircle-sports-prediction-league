-- PROTOTYPE ONLY: shared result submission, not a migration or deployable RPC.
-- Requires koshien-shared-approval-read.sql and existing revision/permit boundaries.
CREATE FUNCTION public.submit_koshien_shared_results(p_event_id text,p_expected_revision bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v_uid uuid := auth.uid();
 v_event public.events;
 v_league_id uuid;
 v_revision bigint;
 v_policy text;
 v_eligible uuid[];
 v_required integer;
 v_good boolean;
 v_results jsonb;
 v_scores jsonb;
 v_cards jsonb;
 v_teams jsonb;
 v_event_teams jsonb;
 v_event_context jsonb;
 v_scored integer;
 v_existing yoso_approval_private.submissions;
 v_finalized yoso_approval_private.submissions;
 v_approved bigint;
 v_auto_result jsonb;
 v_id uuid;
BEGIN
 IF v_uid IS NULL THEN
   RAISE EXCEPTION 'authentication is required' USING ERRCODE='42501';
 END IF;
 -- delete_club locks league FOR UPDATE before cascading to event rows;
 -- obtain league KEY SHARE before event FOR UPDATE to avoid inversion.
 SELECT e.league_id INTO v_league_id FROM public.events e
 WHERE e.id=p_event_id AND e.preset_type='koshien';
 IF v_league_id IS NULL THEN
   RAISE EXCEPTION 'Koshien event is required' USING ERRCODE='42501';
 END IF;
 PERFORM 1 FROM public.leagues l WHERE l.id=v_league_id FOR KEY SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'approval league not found' USING ERRCODE='23503';
 END IF;
 -- BEFORE ROW triggers on public.teams obtain the same advisory key using
 -- pg_try_advisory_xact_lock (fail-fast). Acquire it before the event row
 -- lock so team -> event lock inversions cannot deadlock final approval.
 PERFORM pg_catalog.pg_advisory_xact_lock(
   yoso_approval_private.team_config_lock_key(p_event_id));
 SELECT e.* INTO v_event FROM public.events e
 WHERE e.id=p_event_id AND e.preset_type='koshien' FOR UPDATE;
 IF v_event.id IS NULL OR v_event.league_id IS DISTINCT FROM v_league_id THEN
   RAISE EXCEPTION 'approval event changed while locking league'
     USING ERRCODE='40001';
 END IF;
 IF NOT public.is_league_admin(v_event.league_id) THEN
   RAISE EXCEPTION 'active league admin permission is required' USING ERRCODE='42501';
 END IF;
 v_revision := yoso_approval_private.lock_revision(p_event_id);
 IF p_expected_revision IS NULL OR p_expected_revision<>v_revision THEN
   RAISE EXCEPTION 'stale approval revision' USING ERRCODE='40001';
 END IF;
 -- Network retries after finalized admin submission must not issue new votes.
 IF v_event.status='finalized'
   AND v_event.rules->'resultFlow'->>'status'='finalized' THEN
   SELECT s.* INTO v_finalized FROM yoso_approval_private.submissions s
   WHERE s.event_id=p_event_id AND s.revision=v_revision
     AND s.status='finalized' AND s.submitted_by=v_uid
   ORDER BY s.submitted_at DESC LIMIT 1;
   IF v_finalized.id IS NOT NULL THEN
     SELECT count(*) INTO v_approved FROM yoso_approval_private.votes
     WHERE submission_id=v_finalized.id;
     RETURN jsonb_build_object('submission_id',v_finalized.id,
       'revision',v_revision,'submission_status','finalized',
       'required_count',v_finalized.required_count,
       'approved_count',v_approved,'idempotent',true);
   END IF;
 END IF;
 IF v_event.status<>'resultWait'
   OR v_event.rules->'resultFlow'->>'status'='finalized' THEN
   RAISE EXCEPTION 'result submission requires resultWait' USING ERRCODE='55000';
 END IF;
 IF v_event.prediction_deadline IS NULL
   OR v_event.prediction_deadline > pg_catalog.clock_timestamp() THEN
   RAISE EXCEPTION 'prediction deadline has not passed' USING ERRCODE='55000';
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
      -- Match FKs reference teams(id) globally; prevent a result card from
      -- silently using a school belonging to a different tournament.
      AND EXISTS (SELECT 1 FROM public.teams t1
        WHERE t1.id=m.team1_id AND t1.event_id=p_event_id)
      AND EXISTS (SELECT 1 FROM public.teams t2
        WHERE t2.id=m.team2_id AND t2.event_id=p_event_id)
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
 -- Match results alone do not prove a knockout bracket: each school must
 -- enter once, all 49 must appear by R2, and every winner must advance.
 IF NOT yoso_approval_private.koshien_bracket_topology_valid(p_event_id) THEN
   RAISE EXCEPTION 'Koshien bracket has repeated schools or invalid advancement'
     USING ERRCODE='55000';
 END IF;
 SELECT r.payload INTO v_results FROM public.results r WHERE r.event_id=p_event_id;
 IF v_results IS NULL OR jsonb_typeof(v_results->'matches')<>'array'
   OR jsonb_array_length(v_results->'matches')<>48 THEN
   RAISE EXCEPTION 'result payload must contain 48 match slots'
     USING ERRCODE='55000';
 END IF;
 -- The persisted payload uses school NAMES in team_a_id/team_b_id and
 -- winner_id/loser_id, whereas matches stores teams.id UUID references.
 -- Match all 48 unique (round,match_no) keys before signing the snapshot.
 -- Compare JSON number values without casts so malformed payloads fail
 -- validation rather than causing a SQL conversion error.
 SELECT count(*)=48
   AND count(DISTINCT pg_catalog.jsonb_build_array(
     j.entry->'round',j.entry->'match_no'))=48
   AND count(*) FILTER (WHERE m.event_id IS NOT NULL
     AND j.entry->>'team_a_id'=t1.name
     AND j.entry->>'team_b_id'=t2.name
     AND j.entry->>'winner_id'=tw.name
     AND j.entry->>'loser_id'=tl.name
     AND j.entry->'score_a'=to_jsonb(m.team1_score)
     AND j.entry->'score_b'=to_jsonb(m.team2_score)
     AND j.entry->>'status'=m.status)=48
 INTO v_good
 FROM pg_catalog.jsonb_array_elements(v_results->'matches') AS j(entry)
 LEFT JOIN public.matches m ON m.event_id=p_event_id
   AND m.round_key=j.entry->>'round'
   AND to_jsonb(m.match_no)=j.entry->'match_no'
 LEFT JOIN public.teams t1 ON t1.id=m.team1_id
 LEFT JOIN public.teams t2 ON t2.id=m.team2_id
 LEFT JOIN public.teams tw ON tw.id=m.winner_team_id
 LEFT JOIN public.teams tl ON tl.id=m.loser_team_id;
 IF NOT coalesce(v_good,false) THEN
   RAISE EXCEPTION 'result payload does not match 48 official match records'
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
 -- Persist the actual scoring definition and team coefficients alongside
 -- the authoritative result rows. Do not treat an identical scores row as
 -- proof that the underlying scoring parameters stayed unchanged.
 v_event_context := jsonb_build_object(
   'rules',coalesce(v_event.rules,'{}'::jsonb) - 'approvalPolicy' - 'resultFlow',
   'rules_config',v_event.rules_config,
   'current_phase',v_event.current_phase,
   'prediction_deadline',v_event.prediction_deadline,
   'sport_type',v_event.sport_type,
   'season',v_event.season
 );
 SELECT coalesce(jsonb_agg(to_jsonb(t) - 'created_at' - 'updated_at'
    ORDER BY t.id),'[]'::jsonb)
 INTO v_teams FROM public.teams t WHERE t.event_id=p_event_id;
 SELECT coalesce(jsonb_agg(to_jsonb(et) - 'created_at' - 'updated_at'
    ORDER BY et.id),'[]'::jsonb)
 INTO v_event_teams FROM public.event_teams et WHERE et.event_id=p_event_id;

 -- Revision changes supersede older submissions, without reusing their votes.
 UPDATE yoso_approval_private.submissions SET status='superseded'
 WHERE event_id=p_event_id AND status='submitted'
   AND (revision<>v_revision OR policy<>v_policy
     OR eligible_user_ids<>v_eligible OR required_count<>v_required);
 SELECT s.* INTO v_existing FROM yoso_approval_private.submissions s
 WHERE s.event_id=p_event_id AND s.status='submitted' FOR UPDATE;
 IF v_existing.id IS NOT NULL THEN
   IF v_existing.revision=v_revision AND v_existing.submitted_by=v_uid
      AND v_existing.policy=v_policy
      AND v_existing.eligible_user_ids=v_eligible
      AND v_existing.required_count=v_required THEN
     SELECT count(*) INTO v_approved FROM yoso_approval_private.votes
     WHERE submission_id=v_existing.id;
     RETURN jsonb_build_object('submission_id',v_existing.id,
       'revision',v_revision,'submission_status','submitted',
       'required_count',v_required,'approved_count',v_approved,'idempotent',true);
   END IF;
   RAISE EXCEPTION 'another active submission already exists' USING ERRCODE='55000';
 END IF;
 INSERT INTO yoso_approval_private.submissions(
    event_id,revision,policy,eligible_user_ids,required_count,
    submitted_by,status,result_snapshot
 ) VALUES(p_event_id,v_revision,v_policy,v_eligible,v_required,v_uid,
  'submitted',jsonb_build_object('matches',v_cards,'results',v_results,
  'scores',v_scores,'event_context',v_event_context,'teams',v_teams,
  'event_teams',v_event_teams)
 ) RETURNING id INTO v_id;
 INSERT INTO yoso_approval_private.votes(submission_id,voter_user_id)
 VALUES(v_id,v_uid);
 -- Preserve legacy admin=1 policy: submission and finalization are atomic.
 IF v_required=1 THEN
   v_auto_result := public.approve_koshien_shared_results(p_event_id,v_id,v_revision);
   RETURN v_auto_result || jsonb_build_object('idempotent',false);
 END IF;
 RETURN jsonb_build_object('submission_id',v_id,'revision',v_revision,
   'submission_status','submitted','required_count',v_required,
   'approved_count',1,'idempotent',false);
END;
$function$;
REVOKE ALL ON FUNCTION public.submit_koshien_shared_results(text,bigint)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.submit_koshien_shared_results(text,bigint)
 TO authenticated;
