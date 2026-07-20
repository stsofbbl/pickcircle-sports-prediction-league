-- YOSO Supabase schema, phase 1.
-- Paste this file into the Supabase SQL Editor before rls-policies.sql.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.league_members (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role text not null check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table if not exists public.events (
  id text primary key default gen_random_uuid()::text,
  league_id uuid not null references public.leagues(id) on delete cascade,
  name text not null,
  preset_type text not null,
  status text not null default 'open' check (status in ('draft', 'open', 'resultWait', 'finalized', 'archive')),
  prediction_deadline timestamptz,
  rules jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.events add column if not exists sport_type text;
alter table public.events add column if not exists season text;
alter table public.events add column if not exists current_phase text not null default 'setup';
alter table public.events add column if not exists rules_config jsonb not null default '{}'::jsonb;
alter table public.events add column if not exists archived_at timestamptz;

create table if not exists public.event_teams (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  name text not null,
  seed integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (event_id, name)
);

create table if not exists public.predictions (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);

create table if not exists public.results (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique (event_id)
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  display_name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, profile_id)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  name text not null,
  region text,
  seed integer,
  start_round integer not null default 1 check (start_round in (1, 2)),
  odds numeric(8, 2) not null default 1 check (odds > 0),
  sqrt_odds numeric(10, 4) generated always as (sqrt(odds)) stored,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, name)
);

alter table public.teams add column if not exists team_id text;
alter table public.teams add column if not exists school_name text;
alter table public.teams add column if not exists prefecture text;
alter table public.teams add column if not exists sqrt_odds_capped numeric(10, 4) generated always as (least(sqrt(odds), 50)) stored;

create table if not exists public.matches (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  round_key text not null,
  match_no integer,
  team1_id uuid references public.teams(id) on delete set null,
  team2_id uuid references public.teams(id) on delete set null,
  team1_score integer,
  team2_score integer,
  winner_team_id uuid references public.teams(id) on delete set null,
  loser_team_id uuid references public.teams(id) on delete set null,
  starts_at timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, round_key, match_no)
);

alter table public.matches add column if not exists loser_team_id uuid;

do $$
declare
  v_loser_attnum smallint;
  v_status_attnum smallint;
  v_constraint record;
  v_unexpected_statuses text;
begin
  select attnum::smallint
  into v_loser_attnum
  from pg_attribute
  where attrelid = 'public.matches'::regclass
    and attname = 'loser_team_id'
    and not attisdropped;

  select attnum::smallint
  into v_status_attnum
  from pg_attribute
  where attrelid = 'public.matches'::regclass
    and attname = 'status'
    and not attisdropped;

  if v_status_attnum is null then
    raise exception 'public.matches.status does not exist';
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

  if not exists (
    select 1
    from public.matches m
    left join public.teams t on t.id = m.loser_team_id
    where m.loser_team_id is not null
      and t.id is null
  ) then
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

  select string_agg(status, ', ' order by status)
  into v_unexpected_statuses
  from (
    select distinct status
    from public.matches
    where status not in ('scheduled', 'completed', 'final')
  ) unexpected;
  if v_unexpected_statuses is not null then
    raise exception 'matches contains statuses that need human review: %', v_unexpected_statuses;
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

  update public.matches set status = 'completed' where status = 'final';

  alter table public.matches add constraint matches_status_check
    check (status in ('scheduled', 'completed')) not valid;
  alter table public.matches validate constraint matches_status_check;
end $$;

create table if not exists public.phase1_picks (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  pick_order integer not null check (pick_order >= 1),
  captain boolean not null default false,
  odds_snapshot numeric(8, 2),
  sqrt_odds_snapshot numeric(10, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, player_id, pick_order),
  unique (event_id, player_id, team_id)
);

create table if not exists public.phase2_draft_picks (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  draft_round integer not null check (draft_round >= 1),
  odds_snapshot numeric(8, 2),
  sqrt_odds_snapshot numeric(10, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, player_id, draft_round),
  unique (event_id, team_id)
);

create table if not exists public.final_score_predictions (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  champion_team_id uuid references public.teams(id) on delete set null,
  runner_up_team_id uuid references public.teams(id) on delete set null,
  champion_score integer check (champion_score is null or champion_score >= 0),
  runner_up_score integer check (runner_up_score is null or runner_up_score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, player_id)
);

create table if not exists public.scores (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  phase1_score numeric(12, 3) not null default 0,
  phase2_score numeric(12, 3) not null default 0,
  phase3_score numeric(12, 3) not null default 0,
  revenge_score numeric(12, 3) not null default 0,
  zombie_score numeric(12, 3) not null default 0,
  total_score numeric(12, 3) generated always as (phase1_score + phase2_score + phase3_score + revenge_score + zombie_score) stored,
  breakdown jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (event_id, player_id)
);

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

create table if not exists public.revenge_picks (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  match_id uuid references public.matches(id) on delete cascade,
  target_team_id uuid references public.teams(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.zombie_predictions (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace view public.phase3_predictions
with (security_invoker = true) as
select
  id,
  event_id,
  player_id,
  champion_team_id as team_a_id,
  runner_up_team_id as team_b_id,
  champion_score as predicted_score_a,
  runner_up_score as predicted_score_b,
  created_at,
  updated_at
from public.final_score_predictions;

create or replace view public.zombie_picks
with (security_invoker = true) as
select
  id,
  event_id,
  player_id,
  team_id as target_team_id,
  payload,
  created_at,
  updated_at
from public.zombie_predictions;

create or replace view public.score_snapshots
with (security_invoker = true) as
select
  id,
  event_id,
  player_id,
  phase1_score,
  revenge_score,
  phase2_score,
  zombie_score as zombie_delta,
  phase3_score,
  total_score,
  breakdown,
  updated_at
from public.scores;

create index if not exists profiles_display_name_idx on public.profiles (display_name);
create index if not exists leagues_created_by_idx on public.leagues (created_by);
create index if not exists league_members_user_id_idx on public.league_members (user_id);
create index if not exists league_members_league_role_idx on public.league_members (league_id, role);
create index if not exists events_league_preset_status_idx on public.events (league_id, preset_type, status);
create index if not exists events_prediction_deadline_idx on public.events (prediction_deadline);
create index if not exists event_teams_event_id_idx on public.event_teams (event_id);
create index if not exists predictions_user_id_idx on public.predictions (user_id);
create index if not exists predictions_payload_gin_idx on public.predictions using gin (payload jsonb_path_ops);
create index if not exists results_payload_gin_idx on public.results using gin (payload jsonb_path_ops);
create index if not exists players_league_id_idx on public.players (league_id);
create index if not exists teams_event_id_idx on public.teams (event_id);
create index if not exists teams_event_start_round_idx on public.teams (event_id, start_round);
create index if not exists matches_event_round_idx on public.matches (event_id, round_key, match_no);
create index if not exists phase1_picks_event_player_idx on public.phase1_picks (event_id, player_id);
create index if not exists phase2_draft_picks_event_player_idx on public.phase2_draft_picks (event_id, player_id);
create index if not exists final_score_predictions_event_player_idx on public.final_score_predictions (event_id, player_id);
create index if not exists scores_event_total_idx on public.scores (event_id, total_score desc);
create index if not exists revenge_picks_event_player_idx on public.revenge_picks (event_id, player_id);
create index if not exists zombie_predictions_event_player_idx on public.zombie_predictions (event_id, player_id);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists leagues_set_updated_at on public.leagues;
create trigger leagues_set_updated_at
before update on public.leagues
for each row execute function public.set_updated_at();

drop trigger if exists events_set_updated_at on public.events;
create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

drop trigger if exists predictions_set_updated_at on public.predictions;
create trigger predictions_set_updated_at
before update on public.predictions
for each row execute function public.set_updated_at();

drop trigger if exists players_set_updated_at on public.players;
create trigger players_set_updated_at
before update on public.players
for each row execute function public.set_updated_at();

drop trigger if exists teams_set_updated_at on public.teams;
create trigger teams_set_updated_at
before update on public.teams
for each row execute function public.set_updated_at();

drop trigger if exists matches_set_updated_at on public.matches;
create trigger matches_set_updated_at
before update on public.matches
for each row execute function public.set_updated_at();

drop trigger if exists phase1_picks_set_updated_at on public.phase1_picks;
create trigger phase1_picks_set_updated_at
before update on public.phase1_picks
for each row execute function public.set_updated_at();

drop trigger if exists phase2_draft_picks_set_updated_at on public.phase2_draft_picks;
create trigger phase2_draft_picks_set_updated_at
before update on public.phase2_draft_picks
for each row execute function public.set_updated_at();

drop trigger if exists final_score_predictions_set_updated_at on public.final_score_predictions;
create trigger final_score_predictions_set_updated_at
before update on public.final_score_predictions
for each row execute function public.set_updated_at();

drop trigger if exists scores_set_updated_at on public.scores;
create trigger scores_set_updated_at
before update on public.scores
for each row execute function public.set_updated_at();

drop trigger if exists revenge_picks_set_updated_at on public.revenge_picks;
create trigger revenge_picks_set_updated_at
before update on public.revenge_picks
for each row execute function public.set_updated_at();

drop trigger if exists zombie_predictions_set_updated_at on public.zombie_predictions;
create trigger zombie_predictions_set_updated_at
before update on public.zombie_predictions
for each row execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), split_part(new.email, '@', 1), 'YOSO member')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_yoso_profile on auth.users;
create trigger on_auth_user_created_yoso_profile
after insert on auth.users
for each row execute function public.handle_new_auth_user();
