-- PROTOTYPE ONLY. Production wrapper definition 2026-11-19.
-- Retain nested RPC behavior; lock event before invoking children/state refresh.
CREATE OR REPLACE FUNCTION public.prepare_koshien_later_phase(p_event_id text, p_phase_key text, p_opens_at timestamp with time zone, p_deadline_at timestamp with time zone, p_start_mode text, p_end_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_league_id uuid;
  v_round_key text;
  v_approval_revision bigint;
  v_current_revision bigint;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id for update;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if p_phase_key not in ('best16', 'zombie', 'phase3')
    or p_start_mode not in ('manual', 'automatic')
    or p_end_mode not in ('manual', 'automatic') then
    raise exception 'unsupported later phase schedule';
  end if;
  if p_opens_at is null or p_deadline_at is null or p_opens_at >= p_deadline_at then
    raise exception 'valid opens_at and deadline_at are required';
  end if;

  -- Outer event lock protects all nested prepare RPCs, including state refresh.
  v_approval_revision := yoso_approval_private.lock_revision(p_event_id);
  if p_phase_key = 'best16' then
    perform public.prepare_koshien_best16_phases(p_event_id, p_opens_at, p_deadline_at);
    v_round_key := 'revenge';
  elsif p_phase_key = 'zombie' then
    perform public.prepare_koshien_zombie_phase(p_event_id, p_opens_at, p_deadline_at);
    v_round_key := 'zombie';
  else
    perform public.prepare_koshien_phase3(p_event_id, p_opens_at, p_deadline_at);
    v_round_key := 'phase3';
  end if;

  update public.koshien_later_rounds
  set start_mode = p_start_mode,
      end_mode = p_end_mode,
      updated_at = clock_timestamp(),
      version = version + 1
  where event_id = p_event_id and phase_key = v_round_key;

  if p_phase_key = 'best16' then
    perform set_config('yoso.phase2_rpc', 'manage_schedule', true);
    update public.phase2_drafts
    set starts_at = case when p_start_mode = 'manual' then '-infinity'::timestamptz else p_opens_at end,
        deadline_at = case when p_end_mode = 'manual' then 'infinity'::timestamptz else p_deadline_at end
    where event_id = p_event_id and status = 'ready';
  end if;

  -- Direct zombie preparation already advanced the revision; other inner
  -- preparers have not yet been wired. Advance once per successful wrapper RPC.
  v_current_revision := yoso_approval_private.lock_revision(p_event_id);
  if v_current_revision = v_approval_revision then
    perform yoso_approval_private.advance_revision(p_event_id, v_approval_revision);
  end if;
  return public.get_koshien_later_phase_state(p_event_id);
end;
$function$;
REVOKE ALL ON FUNCTION public.prepare_koshien_later_phase(text,text,timestamptz,timestamptz,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_koshien_later_phase(text,text,timestamptz,timestamptz,text,text) TO authenticated,service_role;
