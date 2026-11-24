-- #52: Reopening archived Koshien must also clear the archive timestamp.
-- Existing audit insertion and role checks remain unchanged.
DO $preflight$
BEGIN
  IF md5(pg_get_functiondef('public.reopen_koshien_results(text)'::regprocedure))
      <> '5ec4ce9202c5b53dd8b925175f871dec' THEN
    RAISE EXCEPTION 'reopen_koshien_results differs from reviewed production definition';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.reopen_koshien_results(p_event_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
  v_result_flow jsonb := jsonb_build_object(
    'status', 'none',
    'submittedBy', '',
    'submittedAt', '',
    'approvals', '{}'::jsonb,
    'finalizedAt', ''
  );
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if p_event_id is null then
    raise exception 'event is required' using errcode = '22023';
  end if;

  select e.*
  into v_event
  from public.events e
  where e.id = p_event_id
    and e.preset_type = 'koshien'
  for update;

  if v_event.id is null then
    raise exception 'Koshien event was not found' using errcode = 'P0002';
  end if;
  if not public.is_league_admin(v_event.league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if v_event.status <> 'finalized'
    and v_event.rules->'resultFlow'->>'status' is distinct from 'finalized' then
    raise exception 'only finalized results can be reopened' using errcode = '55000';
  end if;

  insert into public.koshien_result_reopens (
    event_id, previous_event, reopened_by
  )
  values (
    p_event_id, to_jsonb(v_event), auth.uid()
  );

  update public.events
  set status = 'resultWait',
      archived_at = NULL,
      rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{resultFlow}', v_result_flow, true),
      updated_at = now()
  where id = p_event_id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'status', 'resultWait',
    'result_flow', v_result_flow
  );
end;
$function$;
