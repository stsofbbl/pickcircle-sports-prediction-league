-- PROTOTYPE ONLY: catalog read 2026-11-19, not a migration.
CREATE OR REPLACE FUNCTION public.prepare_koshien_phase3(p_event_id text, p_opens_at timestamp with time zone, p_deadline_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_league_id uuid; v_team_a_id uuid; v_team_b_id uuid; v_approval_revision bigint;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id for update;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if p_opens_at is null or p_deadline_at is null or p_opens_at >= p_deadline_at then raise exception 'valid schedule is required'; end if;
  v_approval_revision := yoso_approval_private.lock_revision(p_event_id);
  if exists (select 1 from public.koshien_later_rounds r where r.event_id = p_event_id and r.phase_key = 'phase3') then
    raise exception 'phase 3 is already prepared' using errcode = '55000';
  end if;
  select m.team1_id, m.team2_id into v_team_a_id, v_team_b_id
  from public.matches m where m.event_id = p_event_id and m.round_key = 'F' order by m.match_no limit 1;
  if v_team_a_id is null or v_team_b_id is null or v_team_a_id = v_team_b_id then raise exception 'official finalists are required'; end if;
  insert into public.koshien_later_rounds (
    event_id, phase_key, status, opens_at, deadline_at, source_results_version, snapshot, team_a_id, team_b_id
  ) values (
    p_event_id, 'phase3', 'ready', p_opens_at, p_deadline_at, public.koshien_result_version(p_event_id),
    jsonb_build_object('team_a_id', v_team_a_id, 'team_b_id', v_team_b_id), v_team_a_id, v_team_b_id
  );
  perform yoso_approval_private.advance_revision(p_event_id,v_approval_revision);
  return public.get_koshien_later_phase_state(p_event_id);
end;
$function$;
REVOKE ALL ON FUNCTION public.prepare_koshien_phase3(text,timestamptz,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.prepare_koshien_phase3(text,timestamptz,timestamptz) TO authenticated,service_role;
