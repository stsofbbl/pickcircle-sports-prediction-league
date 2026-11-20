-- PROTOTYPE ONLY. Bundled with the complete shared-approval migration, never deploy alone.
-- The policy is persisted server-side; any previous submission/vote is made stale.
CREATE FUNCTION public.set_koshien_shared_approval_policy(
 p_event_id text, p_policy text, p_expected_revision bigint
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $function$
DECLARE
 v_uid uuid := auth.uid();
 v_event public.events;
 v_league_id uuid;
 v_revision bigint;
BEGIN
 IF v_uid IS NULL THEN
   RAISE EXCEPTION 'authentication is required' USING ERRCODE='42501';
 END IF;
 IF p_policy IS NULL OR p_policy NOT IN ('admin','half','unanimous') THEN
   RAISE EXCEPTION 'invalid shared approval policy' USING ERRCODE='22023';
 END IF;
 IF p_expected_revision IS NULL OR p_expected_revision < 0 THEN
   RAISE EXCEPTION 'expected revision is required' USING ERRCODE='22023';
 END IF;

 -- Match the delete_club / submit / approve lock order: league then event.
 SELECT e.league_id INTO v_league_id FROM public.events e
 WHERE e.id=p_event_id AND e.preset_type='koshien';
 IF v_league_id IS NULL THEN
   RAISE EXCEPTION 'Koshien event is required' USING ERRCODE='P0002';
 END IF;
 PERFORM 1 FROM public.leagues l WHERE l.id=v_league_id FOR KEY SHARE;
 IF NOT FOUND THEN
   RAISE EXCEPTION 'approval league not found' USING ERRCODE='23503';
 END IF;
 SELECT e.* INTO v_event FROM public.events e
 WHERE e.id=p_event_id AND e.preset_type='koshien' FOR UPDATE;
 IF v_event.id IS NULL OR v_event.league_id IS DISTINCT FROM v_league_id THEN
   RAISE EXCEPTION 'approval event changed while locking league'
     USING ERRCODE='40001';
 END IF;
 IF NOT public.is_league_admin(v_league_id) THEN
   RAISE EXCEPTION 'active league admin permission is required' USING ERRCODE='42501';
 END IF;
 IF v_event.status NOT IN ('open','resultWait')
   OR v_event.rules->'resultFlow'->>'status'='finalized' THEN
   RAISE EXCEPTION 'approval policy is locked after finalization'
     USING ERRCODE='55000';
 END IF;

 v_revision := yoso_approval_private.lock_revision(p_event_id);
 IF p_expected_revision <> v_revision THEN
   RAISE EXCEPTION 'stale approval revision' USING ERRCODE='40001';
 END IF;
 IF v_event.rules->>'approvalPolicy' IS NOT DISTINCT FROM p_policy THEN
   RETURN jsonb_build_object('event_id',p_event_id,'policy',p_policy,
     'revision',v_revision,'changed',false);
 END IF;

 -- All changes are atomic: neither an outdated vote nor an old resubmission
 -- can finalize under a different quorum.
 UPDATE public.events SET
   rules=pg_catalog.jsonb_set(coalesce(v_event.rules,'{}'::jsonb),
     '{approvalPolicy}',pg_catalog.to_jsonb(p_policy),true),
   updated_at=pg_catalog.now()
 WHERE id=p_event_id;
 UPDATE yoso_approval_private.submissions SET status='superseded'
 WHERE event_id=p_event_id AND status='submitted';
 UPDATE yoso_approval_private.revisions SET revision=revision+1
 WHERE event_id=p_event_id RETURNING revision INTO v_revision;
 RETURN jsonb_build_object('event_id',p_event_id,'policy',p_policy,
   'revision',v_revision,'changed',true,'requires_resubmission',true);
END;
$function$;
REVOKE ALL ON FUNCTION public.set_koshien_shared_approval_policy(text,text,bigint)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_koshien_shared_approval_policy(text,text,bigint)
 TO authenticated;
