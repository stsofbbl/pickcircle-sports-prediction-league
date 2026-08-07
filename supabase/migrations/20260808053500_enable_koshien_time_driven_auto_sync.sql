begin;

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create table if not exists public.koshien_automation_secret (
  id smallint primary key default 1 check (id = 1),
  token text not null check (length(token) >= 32),
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);
alter table public.koshien_automation_secret enable row level security;
revoke all on public.koshien_automation_secret from public, anon, authenticated;
grant select on public.koshien_automation_secret to service_role;
insert into public.koshien_automation_secret (id, token)
values (1, encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

create table if not exists public.koshien_automation_state (
  event_id text primary key references public.events(id) on delete cascade,
  last_schedule_attempt_at timestamptz,
  last_schedule_success_at timestamptz,
  last_schedule_reason text,
  schedule_morning_date date,
  schedule_pregame_date date,
  last_result_attempt_at timestamptz,
  last_result_success_at timestamptz,
  last_error text,
  last_action text,
  updated_at timestamptz not null default now()
);
alter table public.koshien_automation_state enable row level security;
revoke all on public.koshien_automation_state from public, anon, authenticated;
grant select, insert, update, delete on public.koshien_automation_state to service_role;

create or replace function public.auto_sync_koshien_official_schedule(
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
    update public.results
    set payload = v_payload,
        updated_by = v_event.created_by,
        updated_at = now()
    where event_id = p_event_id;
  end if;

  return jsonb_build_object('ok', true, 'count', 33, 'changed', v_changed,
    'idempotent', v_changed = 0 and not v_payload_changed);
end;
$$;
revoke all on function public.auto_sync_koshien_official_schedule(text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.auto_sync_koshien_official_schedule(text, jsonb, text, timestamptz) to service_role;

create or replace function public.auto_apply_koshien_official_results(
  p_event_id text,
  p_rows jsonb
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
  v_existing public.external_match_imports;
  v_round text;
  v_match_no integer;
  v_team1_id uuid;
  v_team2_id uuid;
  v_winner_id uuid;
  v_loser_id uuid;
  v_team1_score integer;
  v_team2_score integer;
  v_team1_name text;
  v_team2_name text;
  v_winner_name text;
  v_loser_name text;
  v_external_key text;
  v_source_url text;
  v_fetched_at timestamptz;
  v_normalized jsonb;
  v_slot_index integer;
  v_slot jsonb;
  v_new_slot jsonb;
  v_changed integer := 0;
  v_skipped integer := 0;
  v_blocked integer := 0;
begin
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'result rows must be an array';
  end if;
  if jsonb_array_length(p_rows) > 8 then
    raise exception 'too many automatic result rows';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id and e.preset_type = 'koshien'
  for update;
  if v_event.id is null or v_event.created_by is null then
    raise exception 'koshien event not found';
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
    v_round := v_item->>'roundKey';
    v_match_no := nullif(v_item->>'matchNo', '')::integer;
    v_team1_id := nullif(v_item->>'team1Id', '')::uuid;
    v_team2_id := nullif(v_item->>'team2Id', '')::uuid;
    v_team1_score := nullif(v_item->>'team1Score', '')::integer;
    v_team2_score := nullif(v_item->>'team2Score', '')::integer;
    v_winner_id := nullif(v_item->>'winnerTeamId', '')::uuid;
    v_loser_id := nullif(v_item->>'loserTeamId', '')::uuid;
    v_external_key := v_item->>'externalKey';
    v_source_url := v_item->>'sourceUrl';
    v_fetched_at := coalesce(nullif(v_item->>'fetchedAt', '')::timestamptz, now());
    v_normalized := v_item->'normalizedPayload';

    if v_round not in ('R1','R2','R3','QF','SF','F')
       or v_match_no is null
       or v_team1_id is null or v_team2_id is null or v_team1_id = v_team2_id
       or v_team1_score is null or v_team2_score is null or v_team1_score < 0 or v_team2_score < 0 or v_team1_score = v_team2_score
       or v_winner_id not in (v_team1_id, v_team2_id)
       or v_loser_id not in (v_team1_id, v_team2_id)
       or v_winner_id = v_loser_id
       or (v_team1_score > v_team2_score and (v_winner_id <> v_team1_id or v_loser_id <> v_team2_id))
       or (v_team2_score > v_team1_score and (v_winner_id <> v_team2_id or v_loser_id <> v_team1_id)) then
      raise exception 'invalid automatic result payload';
    end if;
    if coalesce(v_external_key, '') !~ '^jhbf:(summer|senbatsu):[0-9]{4}:[0-9]{4}-[0-9]{2}-[0-9]{2}:[1-9][0-9]*$' then
      raise exception 'invalid external match key';
    end if;
    if coalesce(v_source_url, '') !~ '^https://(www\.)?jhbf\.or\.jp/(sensyuken|senbatsu)/[0-9]{4}/schedule/schedule_[0-9]{8}\.html$' then
      raise exception 'source URL is outside the JHBF allowlist';
    end if;
    if jsonb_typeof(coalesce(v_normalized, 'null'::jsonb)) <> 'object'
       or v_normalized->>'source' <> 'jhbf'
       or v_normalized->>'externalKey' is distinct from v_external_key
       or v_normalized->>'roundKey' is distinct from v_round
       or v_normalized->>'team1Id' is distinct from v_team1_id::text
       or v_normalized->>'team2Id' is distinct from v_team2_id::text
       or (v_normalized->>'team1Score')::integer is distinct from v_team1_score
       or (v_normalized->>'team2Score')::integer is distinct from v_team2_score
       or v_normalized->>'winnerTeamId' is distinct from v_winner_id::text
       or v_normalized->>'loserTeamId' is distinct from v_loser_id::text then
      raise exception 'normalized automatic result payload is invalid';
    end if;

    select i.* into v_existing
    from public.external_match_imports i
    where i.event_id = p_event_id and i.source = 'jhbf' and i.external_key = v_external_key
    for update;
    if v_existing.id is not null and v_existing.status = 'canceled' then
      v_blocked := v_blocked + 1;
      continue;
    end if;
    if v_existing.id is not null and (
      v_existing.normalized_payload is distinct from v_normalized
      or v_existing.imported_match_id is distinct from nullif(v_item->>'matchId', '')::uuid
    ) then
      raise exception 'external import payload conflict' using errcode = '23505';
    end if;

    select m.* into v_match
    from public.matches m
    where m.event_id = p_event_id and m.round_key = v_round and m.match_no = v_match_no
    for update;
    if v_match.id is null
       or v_match.id is distinct from nullif(v_item->>'matchId', '')::uuid
       or v_match.team1_id is distinct from v_team1_id
       or v_match.team2_id is distinct from v_team2_id then
      raise exception 'automatic result does not match the saved tournament card';
    end if;
    if v_match.status = 'completed' then
      if v_match.team1_score is distinct from v_team1_score
         or v_match.team2_score is distinct from v_team2_score
         or v_match.winner_team_id is distinct from v_winner_id
         or v_match.loser_team_id is distinct from v_loser_id then
        raise exception 'saved result conflicts with official result' using errcode = '23505';
      end if;
      v_skipped := v_skipped + 1;
      continue;
    end if;
    if v_match.status <> 'scheduled' then
      raise exception 'automatic result target is not scheduled';
    end if;

    select t.name into v_team1_name from public.teams t where t.id = v_team1_id and t.event_id = p_event_id;
    select t.name into v_team2_name from public.teams t where t.id = v_team2_id and t.event_id = p_event_id;
    select t.name into v_winner_name from public.teams t where t.id = v_winner_id and t.event_id = p_event_id;
    select t.name into v_loser_name from public.teams t where t.id = v_loser_id and t.event_id = p_event_id;
    if v_team1_name is null or v_team2_name is null or v_winner_name is null or v_loser_name is null then
      raise exception 'automatic result contains an unknown team';
    end if;

    update public.matches
    set team1_score = v_team1_score,
        team2_score = v_team2_score,
        winner_team_id = v_winner_id,
        loser_team_id = v_loser_id,
        status = 'completed',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'official_result_source', 'jhbf',
          'official_result_source_url', v_source_url,
          'official_result_fetched_at', v_fetched_at,
          'official_result_auto_applied', true
        ),
        updated_at = now()
    where id = v_match.id;

    select (slot.ordinality - 1)::integer, slot.value
    into v_slot_index, v_slot
    from jsonb_array_elements(v_payload->'matches') with ordinality slot(value, ordinality)
    where slot.value->>'round' = v_round
      and nullif(slot.value->>'match_no', '')::integer = v_match_no
    limit 1;
    if v_slot_index is null then
      raise exception 'results payload result slot mismatch';
    end if;

    v_new_slot := coalesce(v_slot, '{}'::jsonb) || jsonb_build_object(
      'team_a_id', v_team1_name,
      'team_b_id', v_team2_name,
      'score_a', v_team1_score,
      'score_b', v_team2_score,
      'winner_id', v_winner_name,
      'loser_id', v_loser_name,
      'status', 'completed',
      'metadata', coalesce(v_slot->'metadata', '{}'::jsonb) || jsonb_build_object(
        'winner_name', v_winner_name,
        'loser_name', v_loser_name,
        'official_result_source', 'jhbf',
        'official_result_source_url', v_source_url,
        'official_result_fetched_at', v_fetched_at,
        'official_result_auto_applied', true
      )
    );
    v_payload := jsonb_set(v_payload, array['matches', v_slot_index::text], v_new_slot, false);
    v_slot_index := null;

    insert into public.external_match_imports (
      event_id, source, external_key, source_url, normalized_payload, raw_payload,
      imported_match_id, fetched_at, confirmed_by, status, confirmed_at
    ) values (
      p_event_id, 'jhbf', v_external_key, v_source_url, v_normalized,
      coalesce(v_item->'rawPayload', '{}'::jsonb), v_match.id, v_fetched_at,
      v_event.created_by, 'confirmed', now()
    )
    on conflict (event_id, source, external_key) do nothing;

    v_changed := v_changed + 1;
  end loop;

  if v_changed > 0 then
    update public.results
    set payload = v_payload,
        updated_by = v_event.created_by,
        updated_at = now()
    where event_id = p_event_id;

    insert into public.scores (
      event_id, player_id, phase1_score, phase2_score, phase3_score,
      revenge_score, zombie_score, breakdown, updated_at
    )
    select p_event_id, p.id, 0, 0, 0, 0, 0, '{}'::jsonb, now()
    from public.players p
    where p.league_id = v_event.league_id
    on conflict (event_id, player_id) do update set updated_at = excluded.updated_at;
  end if;

  return jsonb_build_object('ok', true, 'changed', v_changed, 'skipped', v_skipped, 'blocked', v_blocked);
end;
$$;
revoke all on function public.auto_apply_koshien_official_results(text, jsonb) from public, anon, authenticated;
grant execute on function public.auto_apply_koshien_official_results(text, jsonb) to service_role;

select cron.unschedule(jobid)
from cron.job
where jobname = 'yoso-koshien-auto-sync';

select cron.schedule(
  'yoso-koshien-auto-sync',
  '*/15 * * * *',
  $cron$
  select net.http_post(
    url := 'https://gubsrwaxpifhvwommpos.supabase.co/functions/v1/koshien-auto-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-yoso-automation-token', (select token from public.koshien_automation_secret where id = 1)
    ),
    body := jsonb_build_object('trigger', 'pg_cron'),
    timeout_milliseconds := 20000
  );
  $cron$
);

notify pgrst, 'reload schema';

commit;
