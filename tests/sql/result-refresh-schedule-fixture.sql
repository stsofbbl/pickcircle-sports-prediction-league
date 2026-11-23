-- Production definitions read 2026-11-17. Isolated dependencies only.
ALTER TABLE public.koshien_later_rounds ADD COLUMN locked_at timestamptz;
ALTER TABLE public.phase2_drafts ADD COLUMN deadline_at timestamptz;
CREATE OR REPLACE FUNCTION public.is_league_member(p_league_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
      and lm.membership_status = 'active'
  );
$function$
;
CREATE OR REPLACE FUNCTION public.refresh_koshien_phase_schedule(p_event_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_league_id uuid;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_member(v_league_id) then
    raise exception 'league membership is required' using errcode = '42501';
  end if;

  update public.koshien_later_rounds
  set status = 'open', updated_at = clock_timestamp(), version = version + 1
  where event_id = p_event_id
    and status = 'ready'
    and start_mode = 'automatic'
    and opens_at <= clock_timestamp()
    and (end_mode = 'manual' or deadline_at > clock_timestamp());

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

  perform set_config('yoso.phase2_rpc', 'manage_schedule', true);
  update public.phase2_drafts d
  set status = 'drafting'
  from public.koshien_later_rounds r
  where d.event_id = p_event_id
    and r.event_id = d.event_id
    and r.phase_key = 'revenge'
    and r.status = 'open'
    and d.status = 'ready';

  update public.phase2_drafts d
  set deadline_at = least(d.deadline_at, clock_timestamp()),
      status = case when d.status = 'completed' then 'locked' else d.status end
  from public.koshien_later_rounds r
  where d.event_id = p_event_id
    and r.event_id = d.event_id
    and r.phase_key = 'revenge'
    and r.status = 'locked'
    and d.status in ('ready', 'drafting', 'completed');
end;
$function$
;
REVOKE ALL ON FUNCTION public.refresh_koshien_phase_schedule(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.refresh_koshien_phase_schedule(text) TO authenticated,service_role;
