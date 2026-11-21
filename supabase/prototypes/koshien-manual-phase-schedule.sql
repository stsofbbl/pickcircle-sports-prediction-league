-- PROTOTYPE ONLY: catalog read 2026-11-19, not a migration.
CREATE OR REPLACE FUNCTION public.update_koshien_later_phase_schedule(p_event_id text, p_phase_key text, p_opens_at timestamp with time zone, p_deadline_at timestamp with time zone, p_start_mode text, p_end_mode text)
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
  if p_phase_key not in ('best16', 'zombie', 'phase3')
    or p_start_mode not in ('manual', 'automatic')
    or p_end_mode not in ('manual', 'automatic') then
    raise exception 'unsupported later phase schedule';
  end if;
  if p_opens_at is null or p_deadline_at is null or p_opens_at >= p_deadline_at then
    raise exception 'valid opens_at and deadline_at are required';
  end if;

  v_approval_revision := yoso_approval_private.lock_revision(p_event_id);
  select r.* into v_round
  from public.koshien_later_rounds r
  where r.event_id = p_event_id and r.phase_key = v_round_key
  for update;

  if v_round.id is null or v_round.status not in ('ready', 'open') then
    raise exception 'later phase schedule cannot be changed now' using errcode = '55000';
  end if;
  if v_round.status = 'open'
    and (
      p_opens_at is distinct from v_round.opens_at
      or p_start_mode is distinct from v_round.start_mode
      or p_end_mode is distinct from v_round.end_mode
    ) then
    raise exception 'only the deadline can be changed while reception is open' using errcode = '55000';
  end if;

  update public.koshien_later_rounds
  set opens_at = p_opens_at,
      deadline_at = p_deadline_at,
      start_mode = p_start_mode,
      end_mode = p_end_mode,
      status = case
        when p_end_mode = 'automatic'
          and p_deadline_at <= clock_timestamp()
          and (
            p_phase_key <> 'best16'
            or exists (
              select 1 from public.phase2_drafts d
              where d.event_id = p_event_id and d.status in ('completed', 'locked')
            )
          ) then 'locked'
        else status
      end,
      locked_at = case
        when p_end_mode = 'automatic'
          and p_deadline_at <= clock_timestamp()
          and (
            p_phase_key <> 'best16'
            or exists (
              select 1 from public.phase2_drafts d
              where d.event_id = p_event_id and d.status in ('completed', 'locked')
            )
          ) then clock_timestamp()
        else locked_at
      end,
      updated_at = clock_timestamp(),
      version = version + 1
  where id = v_round.id;

  if p_phase_key = 'best16' then
    perform set_config('yoso.phase2_rpc', 'manage_schedule', true);
    update public.phase2_drafts
    set starts_at = case
          when status = 'ready' and p_start_mode = 'manual' then '-infinity'::timestamptz
          when status = 'ready' then p_opens_at
          else starts_at
        end,
        deadline_at = case when p_end_mode = 'manual' then 'infinity'::timestamptz else p_deadline_at end,
        status = case when status = 'completed' and p_end_mode = 'automatic'
          and p_deadline_at <= clock_timestamp() then 'locked' else status end
    where event_id = p_event_id and status in ('ready', 'drafting', 'completed');
  end if;

  perform yoso_approval_private.advance_revision(p_event_id,v_approval_revision);
  return public.get_koshien_later_phase_state(p_event_id);
end;
$function$;
REVOKE ALL ON FUNCTION public.update_koshien_later_phase_schedule(text,text,timestamptz,timestamptz,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_koshien_later_phase_schedule(text,text,timestamptz,timestamptz,text,text) TO authenticated,service_role;
