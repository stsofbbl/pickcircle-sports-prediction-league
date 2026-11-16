-- PROTOTYPE ONLY: not a migration. Production body plus approval writer boundary.
CREATE OR REPLACE FUNCTION public.auto_sync_koshien_official_schedule(p_event_id text, p_rows jsonb, p_source_url text, p_fetched_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_approval_revision bigint;
  v_write_started boolean := false;
begin
  select e.* into v_event
  from public.events e
  where e.id = p_event_id and e.preset_type = 'koshien'
  for update;
  if v_event.id is null then
    raise exception 'koshien event not found';
  end if;

  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_rows) <> 33 then
    raise exception 'exactly 33 R1/R2 schedule rows are required';
  end if;
  if coalesce(p_source_url, '') !~ '^https://(www\.)?jhbf\.or\.jp/sensyuken/[0-9]{4}/schedule/?$' then
    raise exception 'source URL is outside the JHBF allowlist';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where item->>'round_key' not in ('R1', 'R2')
      or coalesce(item->>'match_no', '') !~ '^[0-9]+$'
      or coalesce(item->>'tournament_day_no', '') !~ '^[0-9]+$'
      or coalesce(item->>'daily_match_no', '') !~ '^[0-9]+$'
      or coalesce(item->>'starts_at', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(Z|[+-][0-9]{2}:[0-9]{2})$'
  ) then
    raise exception 'invalid official schedule payload';
  end if;
  if (select count(*) from jsonb_array_elements(p_rows) item where item->>'round_key' = 'R1') <> 17
     or (select count(*) from jsonb_array_elements(p_rows) item where item->>'round_key' = 'R2') <> 16 then
    raise exception 'schedule must contain R1=17 and R2=16';
  end if;
  if (select count(distinct (item->>'round_key') || ':' || (item->>'match_no')) from jsonb_array_elements(p_rows) item) <> 33 then
    raise exception 'R1/R2 schedule keys must be unique';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where (item->>'match_no')::integer < 1
      or ((item->>'round_key') = 'R1' and (item->>'match_no')::integer > 17)
      or ((item->>'round_key') = 'R2' and (item->>'match_no')::integer > 16)
      or (item->>'tournament_day_no')::integer < 1
      or (item->>'daily_match_no')::integer not between 1 and 4
  ) then
    raise exception 'official schedule slot is out of range';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_rows) item
    where not exists (
      select 1 from public.matches m
      where m.event_id = p_event_id
        and m.round_key = item->>'round_key'
        and m.match_no = (item->>'match_no')::integer
    )
  ) then
    raise exception 'official R1/R2 matches are incomplete';
  end if;

  v_approval_revision := yoso_approval_private.lock_revision(p_event_id);

  select r.* into v_result
  from public.results r
  where r.event_id = p_event_id
  for update;
  if v_result.id is null
     or jsonb_typeof(v_result.payload) <> 'object'
     or jsonb_typeof(v_result.payload->'matches') <> 'array' then
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

    v_effective_starts_at := case
      when v_match.status = 'completed' and v_match.starts_at is not null then v_match.starts_at
      else v_starts_at
    end;

    if v_match.starts_at is distinct from v_effective_starts_at
       or coalesce(v_match.metadata->>'tournament_day_no', '') is distinct from v_tournament_day_no::text
       or coalesce(v_match.metadata->>'daily_match_no', '') is distinct from v_daily_match_no::text
       or coalesce(v_match.metadata->>'schedule_source_url', '') is distinct from coalesce(p_source_url, '') then
      if not v_write_started then
        perform yoso_approval_private.advance_revision(p_event_id, v_approval_revision);
        perform yoso_approval_private.issue_write_permit(p_event_id);
        v_write_started := true;
      end if;
      update public.matches
      set starts_at = v_effective_starts_at,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'tournament_day_no', v_tournament_day_no,
            'daily_match_no', v_daily_match_no,
            'schedule_source_url', p_source_url,
            'schedule_fetched_at', coalesce(p_fetched_at, clock_timestamp()),
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
      raise exception 'results payload schedule slot mismatch';
    end if;

    v_new_slot := coalesce(v_slot, '{}'::jsonb) || jsonb_build_object(
      'starts_at', v_effective_starts_at,
      'metadata', coalesce(v_slot->'metadata', '{}'::jsonb) || jsonb_build_object(
        'tournament_day_no', v_tournament_day_no,
        'daily_match_no', v_daily_match_no,
        'schedule_source_url', p_source_url,
        'schedule_fetched_at', coalesce(p_fetched_at, clock_timestamp()),
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
    -- Results-only metadata changes also invalidate pending approvals.
    if not v_write_started then
      perform yoso_approval_private.advance_revision(p_event_id, v_approval_revision);
      perform yoso_approval_private.issue_write_permit(p_event_id);
      v_write_started := true;
    end if;

    update public.results
    set payload = v_payload,
        updated_by = v_event.created_by,
        updated_at = now()
    where event_id = p_event_id;
  end if;

  return jsonb_build_object('ok', true, 'count', 33, 'changed', v_changed,
    'idempotent', v_changed = 0 and not v_payload_changed);
end;
$function$;
REVOKE ALL ON FUNCTION public.auto_sync_koshien_official_schedule(text,jsonb,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auto_sync_koshien_official_schedule(text,jsonb,text,timestamptz) TO service_role;
