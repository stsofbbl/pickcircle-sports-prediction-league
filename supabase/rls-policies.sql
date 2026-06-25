-- YOSO Supabase RLS policies, phase 1.
-- Paste this file into the Supabase SQL Editor after schema.sql.

create or replace function public.is_league_member(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
  );
$$;

create or replace function public.is_league_admin(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.user_id = (select auth.uid())
      and lm.role = 'admin'
  );
$$;

create or replace function public.is_prediction_open(p_event_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and e.status = 'open'
      and (e.prediction_deadline is null or now() < e.prediction_deadline)
      and public.is_league_member(e.league_id)
  );
$$;

create or replace function public.is_prediction_public(p_event_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.events e
    where e.id = p_event_id
      and public.is_league_member(e.league_id)
      and (
        e.status in ('resultWait', 'finalized', 'archive')
        or (e.prediction_deadline is not null and now() >= e.prediction_deadline)
      )
  );
$$;

create or replace function public.create_league_with_admin(p_name text, p_invite_code text)
returns public.leagues
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_league public.leagues;
begin
  if v_user_id is null then
    raise exception 'login required';
  end if;

  insert into public.profiles (id, display_name)
  values (v_user_id, coalesce(auth.jwt()->>'email', 'YOSO member'))
  on conflict (id) do nothing;

  insert into public.leagues (name, invite_code, created_by)
  values (p_name, p_invite_code, v_user_id)
  on conflict (invite_code) do nothing
  returning * into v_league;

  if v_league.id is null then
    select *
    into v_league
    from public.leagues
    where invite_code = p_invite_code;

    if v_league.created_by <> v_user_id then
      raise exception 'league already exists; join by invite instead';
    end if;
  end if;

  insert into public.league_members (league_id, user_id, role)
  values (v_league.id, v_user_id, 'admin')
  on conflict (league_id, user_id) do update set role = excluded.role;

  return v_league;
end;
$$;

create or replace function public.join_league_by_invite(p_invite_code text)
returns public.leagues
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_league public.leagues;
begin
  if v_user_id is null then
    raise exception 'login required';
  end if;

  select *
  into v_league
  from public.leagues
  where invite_code = p_invite_code;

  if v_league.id is null then
    raise exception 'invite code not found';
  end if;

  insert into public.profiles (id, display_name)
  values (v_user_id, coalesce(auth.jwt()->>'email', 'YOSO member'))
  on conflict (id) do nothing;

  insert into public.league_members (league_id, user_id, role)
  values (v_league.id, v_user_id, 'member')
  on conflict (league_id, user_id) do nothing;

  return v_league;
end;
$$;

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.events enable row level security;
alter table public.event_teams enable row level security;
alter table public.predictions enable row level security;
alter table public.results enable row level security;

drop policy if exists profiles_select_members on public.profiles;
create policy profiles_select_members on public.profiles
for select to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.league_members mine
    join public.league_members peer on peer.league_id = mine.league_id
    where mine.user_id = (select auth.uid())
      and peer.user_id = profiles.id
  )
);

drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
for insert to authenticated
with check (id = (select auth.uid()));

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

drop policy if exists leagues_select_members on public.leagues;
create policy leagues_select_members on public.leagues
for select to authenticated
using (public.is_league_member(id));

drop policy if exists leagues_insert_creator on public.leagues;
create policy leagues_insert_creator on public.leagues
for insert to authenticated
with check (created_by = (select auth.uid()));

drop policy if exists leagues_update_admin on public.leagues;
create policy leagues_update_admin on public.leagues
for update to authenticated
using (public.is_league_admin(id))
with check (public.is_league_admin(id));

drop policy if exists league_members_select_same_league on public.league_members;
create policy league_members_select_same_league on public.league_members
for select to authenticated
using (public.is_league_member(league_id));

drop policy if exists league_members_insert_admin_or_creator on public.league_members;
create policy league_members_insert_admin_or_creator on public.league_members
for insert to authenticated
with check (
  public.is_league_admin(league_id)
  or (
    user_id = (select auth.uid())
    and role = 'admin'
    and exists (
      select 1
      from public.leagues l
      where l.id = league_id
        and l.created_by = (select auth.uid())
    )
  )
);

drop policy if exists league_members_update_admin on public.league_members;
create policy league_members_update_admin on public.league_members
for update to authenticated
using (public.is_league_admin(league_id))
with check (public.is_league_admin(league_id));

drop policy if exists league_members_delete_admin on public.league_members;
create policy league_members_delete_admin on public.league_members
for delete to authenticated
using (public.is_league_admin(league_id));

drop policy if exists events_select_members on public.events;
create policy events_select_members on public.events
for select to authenticated
using (public.is_league_member(league_id));

drop policy if exists events_insert_admin on public.events;
create policy events_insert_admin on public.events
for insert to authenticated
with check (created_by = (select auth.uid()) and public.is_league_admin(league_id));

drop policy if exists events_update_admin on public.events;
create policy events_update_admin on public.events
for update to authenticated
using (public.is_league_admin(league_id))
with check (public.is_league_admin(league_id));

drop policy if exists events_delete_admin on public.events;
create policy events_delete_admin on public.events
for delete to authenticated
using (public.is_league_admin(league_id));

drop policy if exists event_teams_select_members on public.event_teams;
create policy event_teams_select_members on public.event_teams
for select to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = event_id
      and public.is_league_member(e.league_id)
  )
);

drop policy if exists event_teams_insert_admin on public.event_teams;
create policy event_teams_insert_admin on public.event_teams
for insert to authenticated
with check (
  exists (
    select 1 from public.events e
    where e.id = event_id
      and public.is_league_admin(e.league_id)
  )
);

drop policy if exists event_teams_update_admin on public.event_teams;
create policy event_teams_update_admin on public.event_teams
for update to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = event_id
      and public.is_league_admin(e.league_id)
  )
)
with check (
  exists (
    select 1 from public.events e
    where e.id = event_id
      and public.is_league_admin(e.league_id)
  )
);

drop policy if exists event_teams_delete_admin on public.event_teams;
create policy event_teams_delete_admin on public.event_teams
for delete to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = event_id
      and public.is_league_admin(e.league_id)
  )
);

drop policy if exists predictions_select_owner_or_public on public.predictions;
create policy predictions_select_owner_or_public on public.predictions
for select to authenticated
using (
  (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.events e
      where e.id = event_id
        and public.is_league_member(e.league_id)
    )
  )
  or public.is_prediction_public(event_id)
);

drop policy if exists predictions_insert_self_before_deadline on public.predictions;
create policy predictions_insert_self_before_deadline on public.predictions
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and public.is_prediction_open(event_id)
);

drop policy if exists predictions_update_self_before_deadline on public.predictions;
create policy predictions_update_self_before_deadline on public.predictions
for update to authenticated
using (
  user_id = (select auth.uid())
  and public.is_prediction_open(event_id)
)
with check (
  user_id = (select auth.uid())
  and public.is_prediction_open(event_id)
);

drop policy if exists predictions_delete_self_before_deadline on public.predictions;
create policy predictions_delete_self_before_deadline on public.predictions
for delete to authenticated
using (
  user_id = (select auth.uid())
  and public.is_prediction_open(event_id)
);

drop policy if exists results_select_members on public.results;
create policy results_select_members on public.results
for select to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = event_id
      and public.is_league_member(e.league_id)
  )
);

drop policy if exists results_insert_admin on public.results;
create policy results_insert_admin on public.results
for insert to authenticated
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.events e
    where e.id = event_id
      and public.is_league_admin(e.league_id)
  )
);

drop policy if exists results_update_admin on public.results;
create policy results_update_admin on public.results
for update to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = event_id
      and public.is_league_admin(e.league_id)
  )
)
with check (
  updated_by = (select auth.uid())
  and exists (
    select 1 from public.events e
    where e.id = event_id
      and public.is_league_admin(e.league_id)
  )
);

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles,
  public.leagues,
  public.league_members,
  public.events,
  public.event_teams,
  public.predictions,
  public.results
to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.create_league_with_admin(text, text) to authenticated;
grant execute on function public.join_league_by_invite(text) to authenticated;
