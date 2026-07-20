-- Align the production matches table with the Koshien result-save payload.
-- This migration is intentionally additive and rerunnable. It never deletes match rows.

begin;

alter table public.matches add column if not exists loser_team_id uuid;

do $$
declare
  v_loser_attnum smallint;
  v_constraint record;
begin
  select attnum::smallint
  into v_loser_attnum
  from pg_attribute
  where attrelid = 'public.matches'::regclass
    and attname = 'loser_team_id'
    and not attisdropped;

  if v_loser_attnum is null then
    raise exception 'public.matches.loser_team_id was not created';
  end if;

  if (select atttypid from pg_attribute where attrelid = 'public.matches'::regclass and attnum = v_loser_attnum) <> 'uuid'::regtype then
    raise exception 'public.matches.loser_team_id must be uuid before this migration can continue';
  end if;

  if not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.matches'::regclass
      and c.contype = 'f'
      and c.confrelid = 'public.teams'::regclass
      and c.conkey = array[v_loser_attnum]::smallint[]
  ) then
    alter table public.matches
      add constraint matches_loser_team_id_fkey
      foreign key (loser_team_id)
      references public.teams(id)
      on delete set null
      not valid;
  end if;

  if exists (
    select 1
    from public.matches m
    left join public.teams t on t.id = m.loser_team_id
    where m.loser_team_id is not null
      and t.id is null
  ) then
    raise warning 'loser_team_id contains orphan values; the foreign key remains NOT VALID until those rows are reviewed';
  else
    for v_constraint in
      select c.conname
      from pg_constraint c
      where c.conrelid = 'public.matches'::regclass
        and c.contype = 'f'
        and c.confrelid = 'public.teams'::regclass
        and c.conkey = array[v_loser_attnum]::smallint[]
        and not c.convalidated
    loop
      execute format('alter table public.matches validate constraint %I', v_constraint.conname);
    end loop;
  end if;
end $$;

do $$
declare
  v_constraint record;
  v_status_attnum smallint;
  v_unexpected_statuses text;
begin
  select attnum::smallint
  into v_status_attnum
  from pg_attribute
  where attrelid = 'public.matches'::regclass
    and attname = 'status'
    and not attisdropped;

  if v_status_attnum is null then
    raise exception 'public.matches.status does not exist';
  end if;

  select string_agg(status, ', ' order by status)
  into v_unexpected_statuses
  from (
    select distinct status
    from public.matches
    where status not in ('scheduled', 'completed', 'final')
  ) unexpected;

  if v_unexpected_statuses is not null then
    raise exception 'matches contains statuses that need human review: %', v_unexpected_statuses
      using hint = 'Resolve live/canceled rows explicitly before rerunning; this migration will not silently reinterpret them.';
  end if;

  for v_constraint in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.matches'::regclass
      and c.contype = 'c'
      and c.conkey = array[v_status_attnum]::smallint[]
  loop
    execute format('alter table public.matches drop constraint %I', v_constraint.conname);
  end loop;

  -- Drop the old check first because it rejects the replacement value completed.
  update public.matches
  set status = 'completed'
  where status = 'final';

  alter table public.matches
    add constraint matches_status_check
    check (status in ('scheduled', 'completed'))
    not valid;
  alter table public.matches validate constraint matches_status_check;
end $$;

alter table public.matches alter column status set default 'scheduled';

create or replace function public.save_koshien_result_snapshot(
  p_event_id text,
  p_match_rows jsonb,
  p_score_rows jsonb,
  p_results_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_match_count integer := 0;
  v_score_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id;

  if v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_match_rows, 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_score_rows, 'null'::jsonb)) <> 'array'
    or jsonb_typeof(coalesce(p_results_payload, 'null'::jsonb)) <> 'object' then
    raise exception 'match rows and score rows must be arrays and results payload must be an object';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_match_rows) as item
    where item->>'status' = 'completed'
      and (
        jsonb_typeof(item->'team1_score') <> 'number'
        or jsonb_typeof(item->'team2_score') <> 'number'
        or item->>'team1_score' !~ '^[0-9]+$'
        or item->>'team2_score' !~ '^[0-9]+$'
      )
  ) then
    raise exception 'completed match scores must be non-negative integers';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_match_rows) as x(
      event_id text, round_key text, match_no integer, team1_id uuid, team2_id uuid,
      team1_score integer, team2_score integer, winner_team_id uuid, loser_team_id uuid, status text
    )
    left join public.teams t1 on t1.id = x.team1_id and t1.event_id = p_event_id
    left join public.teams t2 on t2.id = x.team2_id and t2.event_id = p_event_id
    left join public.teams tw on tw.id = x.winner_team_id and tw.event_id = p_event_id
    left join public.teams tl on tl.id = x.loser_team_id and tl.event_id = p_event_id
    where x.event_id is distinct from p_event_id
      or x.round_key is null
      or x.match_no is null
      or x.status is null
      or x.status not in ('scheduled', 'completed')
      or t1.id is null
      or t2.id is null
      or x.team1_id = x.team2_id
      or (
        x.status = 'scheduled'
        and (x.team1_score is not null or x.team2_score is not null or x.winner_team_id is not null or x.loser_team_id is not null)
      )
      or (
        x.status = 'completed'
        and (
          x.team1_score is null
          or x.team2_score is null
          or x.team1_score < 0
          or x.team2_score < 0
          or x.team1_score = x.team2_score
          or tw.id is null
          or tl.id is null
          or x.winner_team_id = x.loser_team_id
          or x.winner_team_id not in (x.team1_id, x.team2_id)
          or x.loser_team_id not in (x.team1_id, x.team2_id)
          or (x.team1_score > x.team2_score and (x.winner_team_id <> x.team1_id or x.loser_team_id <> x.team2_id))
          or (x.team2_score > x.team1_score and (x.winner_team_id <> x.team2_id or x.loser_team_id <> x.team1_id))
        )
      )
  ) then
    raise exception 'matches payload contains an invalid event, status, or team reference';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_score_rows) as x(event_id text, player_id uuid)
    left join public.players p on p.id = x.player_id and p.league_id = v_league_id
    where x.event_id is distinct from p_event_id or p.id is null
  ) then
    raise exception 'scores payload contains an invalid event or player reference';
  end if;

  insert into public.matches (
    event_id, round_key, match_no, team1_id, team2_id, team1_score, team2_score,
    winner_team_id, loser_team_id, status, metadata, updated_at
  )
  select
    p_event_id, x.round_key, x.match_no, x.team1_id, x.team2_id, x.team1_score, x.team2_score,
    x.winner_team_id, x.loser_team_id, x.status, coalesce(x.metadata, '{}'::jsonb), now()
  from jsonb_to_recordset(p_match_rows) as x(
    event_id text, round_key text, match_no integer, team1_id uuid, team2_id uuid,
    team1_score integer, team2_score integer, winner_team_id uuid, loser_team_id uuid,
    status text, metadata jsonb
  )
  on conflict (event_id, round_key, match_no) do update set
    team1_id = excluded.team1_id,
    team2_id = excluded.team2_id,
    team1_score = excluded.team1_score,
    team2_score = excluded.team2_score,
    winner_team_id = excluded.winner_team_id,
    loser_team_id = excluded.loser_team_id,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = now();
  get diagnostics v_match_count = row_count;

  insert into public.scores (
    event_id, player_id, phase1_score, phase2_score, phase3_score,
    revenge_score, zombie_score, breakdown, updated_at
  )
  select
    p_event_id, x.player_id, x.phase1_score, x.phase2_score, x.phase3_score,
    x.revenge_score, x.zombie_score, coalesce(x.breakdown, '{}'::jsonb), now()
  from jsonb_to_recordset(p_score_rows) as x(
    event_id text, player_id uuid, phase1_score numeric, phase2_score numeric,
    phase3_score numeric, revenge_score numeric, zombie_score numeric, breakdown jsonb
  )
  on conflict (event_id, player_id) do update set
    phase1_score = excluded.phase1_score,
    phase2_score = excluded.phase2_score,
    phase3_score = excluded.phase3_score,
    revenge_score = excluded.revenge_score,
    zombie_score = excluded.zombie_score,
    breakdown = excluded.breakdown,
    updated_at = now();
  get diagnostics v_score_count = row_count;

  insert into public.results (event_id, payload, updated_by, updated_at)
  values (p_event_id, p_results_payload, auth.uid(), now())
  on conflict (event_id) do update set
    payload = excluded.payload,
    updated_by = excluded.updated_by,
    updated_at = now();

  return jsonb_build_object('matches', v_match_count, 'scores', v_score_count, 'results', 1);
end;
$$;

revoke all on function public.save_koshien_result_snapshot(text, jsonb, jsonb, jsonb) from public;
revoke all on function public.save_koshien_result_snapshot(text, jsonb, jsonb, jsonb) from anon;
grant execute on function public.save_koshien_result_snapshot(text, jsonb, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
