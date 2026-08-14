create or replace function public.auto_sync_koshien_late_schedule(
  p_event_id text,
  p_rows jsonb,
  p_source_url text,
  p_fetched_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event public.events;
  v_result public.results;
  v_payload jsonb;
  v_item jsonb;
  v_match public.matches;
  v_round text;
  v_match_no integer;
  v_starts_at timestamptz;
  v_effective_starts_at timestamptz;
  v_tournament_day_no integer;
  v_daily_match_no integer;
  v_slot_index integer;
  v_slot jsonb;
  v_new_slot jsonb;
  v_changed integer := 0;
  v_payload_changed boolean := false;
begin
  select e.* into v_event
  from public.events e
  where e.id = p_event_id and e.preset_type = 'koshien'
  for update;
  if v_event.id is null then
    raise exception 'koshien event not found';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_rows) > 15 then
    raise exception 'late schedule rows must be an array of at most 15 matches';
  end if;
  if coalesce(p_source_url, '') !~ '^https://(www\.)?jhbf\.or\.jp/sensyuken/[0-9]{4}/schedule/?$' then
    raise exception 'source URL is outside the JHBF allowlist';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where item->>'round_key' not in ('R3', 'QF', 'SF', 'F')
      or coalesce(item->>'match_no', '') !~ '^[0-9]+$'
      or coalesce(item->>'tournament_day_no', '') !~ '^[0-9]+$'
      or coalesce(item->>'daily_match_no', '') !~ '^[0-9]+$'
      or coalesce(item->>'starts_at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})$'
  ) then
    raise exception 'invalid late official schedule payload';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where (item->>'match_no')::integer < 1
      or ((item->>'round_key') = 'R3' and (item->>'match_no')::integer > 8)
      or ((item->>'round_key') = 'QF' and (item->>'match_no')::integer > 4)
      or ((item->>'round_key') = 'SF' and (item->>'match_no')::integer > 2)
      or ((item->>'round_key') = 'F' and (item->>'match_no')::integer > 1)
      or (item->>'tournament_day_no')::integer < 1
      or (item->>'daily_match_no')::integer not between 1 and 4
  ) then
    raise exception 'late official schedule slot is out of range';
  end if;
  if (select count(distinct (item->>'round_key') || ':' || (item->>'match_no')) from jsonb_array_elements(p_rows) item)
     <> jsonb_array_length(p_rows) then
    raise exception 'late official schedule keys must be unique';
  end if;

  select r.* into v_result
  from public.results r
  where r.event_id = p_event_id
  for update;
  if v_result.id is null or jsonb_typeof(v_result.payload->'matches') <> 'array' then
    raise exception 'results payload does not contain tournament match slots';
  end if;
  v_payload := v_result.payload;

  for v_item in select value from jsonb_array_elements(p_rows) loop
    v_round := v_item->>'round_key';
    v_match_no := (v_item->>'match_no')::integer;
    v_starts_at := (v_item->>'starts_at')::timestamptz;
    v_tournament_day_no := (v_item->>'tournament_day_no')::integer;
    v_daily_match_no := (v_item->>'daily_match_no')::integer;

    select m.* into v_match
    from public.matches m
    where m.event_id = p_event_id and m.round_key = v_round and m.match_no = v_match_no
    for update;
    if v_match.id is null then
      raise exception 'late official schedule target match does not exist';
    end if;
    v_effective_starts_at := case
      when v_match.status = 'completed' and v_match.starts_at is not null then v_match.starts_at
      else v_starts_at
    end;

    if v_match.starts_at is distinct from v_effective_starts_at
       or coalesce(v_match.metadata->>'tournament_day_no', '') is distinct from v_tournament_day_no::text
       or coalesce(v_match.metadata->>'daily_match_no', '') is distinct from v_daily_match_no::text
       or coalesce(v_match.metadata->>'schedule_source_url', '') is distinct from coalesce(p_source_url, '') then
      update public.matches
      set starts_at = v_effective_starts_at,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'tournament_day_no', v_tournament_day_no,
            'daily_match_no', v_daily_match_no,
            'schedule_source_url', p_source_url,
            'schedule_fetched_at', coalesce(p_fetched_at, now()),
            'schedule_auto_synced', true
          ),
          updated_at = now()
      where id = v_match.id;
      v_changed := v_changed + 1;
    end if;

    select (slot.ordinality - 1)::integer, slot.value
    into v_slot_index, v_slot
    from jsonb_array_elements(v_payload->'matches') with ordinality slot(value, ordinality)
    where slot.value->>'round' = v_round
      and nullif(slot.value->>'match_no', '')::integer = v_match_no
    limit 1;
    if v_slot_index is null then
      raise exception 'results payload late schedule slot mismatch';
    end if;
    v_new_slot := coalesce(v_slot, '{}'::jsonb) || jsonb_build_object(
      'starts_at', v_effective_starts_at,
      'metadata', coalesce(v_slot->'metadata', '{}'::jsonb) || jsonb_build_object(
        'tournament_day_no', v_tournament_day_no,
        'daily_match_no', v_daily_match_no,
        'schedule_source_url', p_source_url,
        'schedule_fetched_at', coalesce(p_fetched_at, now()),
        'schedule_auto_synced', true
      )
    );
    if v_new_slot is distinct from v_slot then
      v_payload := jsonb_set(v_payload, array['matches', v_slot_index::text], v_new_slot, false);
      v_payload_changed := true;
    end if;
    v_slot_index := null;
  end loop;

  if v_payload_changed then
    update public.results
    set payload = v_payload,
        updated_by = v_event.created_by,
        updated_at = now()
    where event_id = p_event_id;
  end if;

  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_rows), 'changed', v_changed,
    'idempotent', v_changed = 0 and not v_payload_changed);
end;
$$;

revoke all on function public.auto_sync_koshien_late_schedule(text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.auto_sync_koshien_late_schedule(text, jsonb, text, timestamptz) to service_role;


-- Run the independent bracket/schedule synchronizer at the same low frequency
-- as the existing result synchronizer. It uses the same server-side secret.
do $$
declare
  v_jobid bigint;
begin
  select jobid into v_jobid from cron.job where jobname = 'yoso-koshien-bracket-sync' limit 1;
  if v_jobid is not null then
    perform cron.unschedule(v_jobid);
  end if;
end;
$$;

select cron.schedule(
  'yoso-koshien-bracket-sync',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://gubsrwaxpifhvwommpos.supabase.co/functions/v1/koshien-bracket-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-yoso-automation-token', (select token from public.koshien_automation_secret where id = 1)
    ),
    body := jsonb_build_object('trigger', 'pg_cron'),
    timeout_milliseconds := 20000
  );
  $cron$
);
