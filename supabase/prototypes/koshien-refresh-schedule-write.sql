-- PROTOTYPE ONLY, copied from production catalog 2026-11-18.
-- Member refresh must never issue a results-table write permit.
CREATE OR REPLACE FUNCTION public.refresh_koshien_phase_schedule(p_event_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_league_id uuid;
  v_preset_type text;
  v_revision bigint;
  v_row_count integer;
  v_changed integer := 0;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_member(v_league_id) then
    raise exception 'league membership is required' using errcode = '42501';
  end if;

  -- Event-first serialization, followed by a post-wait authorization recheck.
  select e.league_id, e.preset_type into v_league_id, v_preset_type
  from public.events e where e.id = p_event_id for update;
  if v_league_id is null or not public.is_league_member(v_league_id) then
    raise exception 'league membership is required' using errcode = '42501';
  end if;
  if v_preset_type = 'koshien' then
    v_revision := yoso_approval_private.lock_revision(p_event_id);
  end if;

  update public.koshien_later_rounds
  set status = 'open', updated_at = clock_timestamp(), version = version + 1
  where event_id = p_event_id
    and status = 'ready'
    and start_mode = 'automatic'
    and opens_at <= clock_timestamp()
    and (end_mode = 'manual' or deadline_at > clock_timestamp());
  get diagnostics v_row_count = row_count;
  v_changed := v_changed + v_row_count;

  update public.koshien_later_rounds
  set status = 'locked', locked_at = clock_timestamp(),
      updated_at = clock_timestamp(), version = version + 1
  where event_id = p_event_id
    and status in ('ready', 'open')
    and end_mode = 'automatic'
    and deadline_at <= clock_timestamp()
    and (
      phase_key <> 'revenge'
      or exists (
        select 1 from public.phase2_drafts d
        where d.event_id = p_event_id and d.status in ('completed', 'locked')
      )
    );
  get diagnostics v_row_count = row_count;
  v_changed := v_changed + v_row_count;

  perform set_config('yoso.phase2_rpc', 'manage_schedule', true);
  update public.phase2_drafts d
  set status = 'drafting'
  from public.koshien_later_rounds r
  where d.event_id = p_event_id
    and r.event_id = d.event_id
    and r.phase_key = 'revenge'
    and r.status = 'open'
    and d.status = 'ready';
  get diagnostics v_row_count = row_count;
  v_changed := v_changed + v_row_count;

  update public.phase2_drafts d
  set deadline_at = least(d.deadline_at, clock_timestamp()),
      status = case when d.status = 'completed' then 'locked' else d.status end
  from public.koshien_later_rounds r
  where d.event_id = p_event_id
    and r.event_id = d.event_id
    and r.phase_key = 'revenge'
    and r.status = 'locked'
    and d.status in ('ready', 'drafting', 'completed');
  get diagnostics v_row_count = row_count;
  v_changed := v_changed + v_row_count;

  if v_preset_type = 'koshien' and v_changed > 0 then
    -- Active members can refresh, but cannot edit results: no write permit.
    perform yoso_approval_private.advance_revision(p_event_id, v_revision);
  end if;
end;
$function$;
REVOKE ALL ON FUNCTION public.refresh_koshien_phase_schedule(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.refresh_koshien_phase_schedule(text) TO authenticated,service_role;
