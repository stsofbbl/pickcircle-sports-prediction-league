-- PROTOTYPE ONLY: production definition 2026-11-19. No production mutation.
-- Direct admin preparation: event -> revision -> round/eligibility -> state read.
CREATE OR REPLACE FUNCTION public.prepare_koshien_zombie_phase(p_event_id text, p_opens_at timestamp with time zone, p_deadline_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_league_id uuid;
  v_approval_revision bigint;
begin
  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id for update;

  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;

  -- Event already locked. Prepare creates a round and eligibility as one transaction.
  v_approval_revision := yoso_approval_private.lock_revision(p_event_id);
  perform public.prepare_koshien_zombie_phase_internal(p_event_id, p_opens_at, p_deadline_at);
  perform yoso_approval_private.advance_revision(p_event_id, v_approval_revision);
  return public.get_koshien_later_phase_state(p_event_id);
end;
$function$;
REVOKE ALL ON FUNCTION public.prepare_koshien_zombie_phase(text,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_koshien_zombie_phase(text,timestamptz,timestamptz) TO authenticated,service_role;
