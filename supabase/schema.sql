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
