-- PROTOTYPE ONLY: catalog read 2026-11-19, not a migration.
CREATE OR REPLACE FUNCTION public.set_koshien_later_phase_status(p_event_id text, p_phase_key text, p_action text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_league_id uuid;
  v_round_key text := case when p_phase_key = 'best16' then 'revenge' else p_phase_key end;
  v_round public.koshien_later_rounds;
  v_approval_revision bigint;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id for update;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if p_phase_key not in ('best16', 'zombie', 'phase3') or p_action not in ('open', 'lock') then
    raise exception 'unsupported later phase action';
  end if;

  v_approval_revision := yoso_approval_private.lock_revision(p_event_id);
  select r.* into v_round
  from public.koshien_later_rounds r
  where r.event_id = p_event_id and r.phase_key = v_round_key
  for update;

  if v_round.id is null then
    raise exception 'later phase is not prepared' using errcode = '55000';
  end if;

  if p_action = 'open' then
    if v_round.status <> 'ready' then
      raise exception 'later phase is not waiting to open' using errcode = '55000';
    end if;
    if v_round.end_mode = 'automatic' and clock_timestamp() >= v_round.deadline_at then
      raise exception 'later phase deadline has passed' using errcode = '55000';
    end if;

    update public.koshien_later_rounds
    set status = 'open', start_mode = 'manual', opens_at = clock_timestamp(),
        updated_at = clock_timestamp(), version = version + 1
    where id = v_round.id;

    if p_phase_key = 'best16' then
      perform set_config('yoso.phase2_rpc', 'manage_schedule', true);
      update public.phase2_drafts
      set starts_at = '-infinity'::timestamptz, status = 'drafting'
      where event_id = p_event_id and status = 'ready';
    end if;
  else
    if v_round.status not in ('ready', 'open') then
      raise exception 'later phase is already closed' using errcode = '55000';
    end if;
    if p_phase_key = 'best16' and not exists (
      select 1 from public.phase2_drafts d
      where d.event_id = p_event_id and d.status in ('completed', 'locked')
    ) then
      raise exception 'formal phase 2 draft must be completed before lock' using errcode = '55000';
    end if;

    update public.koshien_later_rounds
    set status = 'locked', end_mode = 'manual', deadline_at = clock_timestamp(),
        locked_at = clock_timestamp(), updated_at = clock_timestamp(), version = version + 1
    where id = v_round.id;

    if p_phase_key = 'best16' then
      perform set_config('yoso.phase2_rpc', 'manage_schedule', true);
      update public.phase2_drafts
      set deadline_at = clock_timestamp(),
          status = case when status = 'completed' then 'locked' else status end
      where event_id = p_event_id and status in ('ready', 'drafting', 'completed');
    end if;
  end if;

  perform yoso_approval_private.advance_revision(p_event_id,v_approval_revision);
  return public.get_koshien_later_phase_state(p_event_id);
end;
$function$;
REVOKE ALL ON FUNCTION public.set_koshien_later_phase_status(text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.set_koshien_later_phase_status(text,text,text) TO authenticated,service_role;
