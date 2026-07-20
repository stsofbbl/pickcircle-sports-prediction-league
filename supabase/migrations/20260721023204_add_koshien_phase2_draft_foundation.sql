begin;

create or replace function public.uuid_array_is_unique(p_values uuid[])
returns boolean
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select count(*) = count(distinct value)
  from unnest(p_values) as value;
$$;

create or replace function public.koshien_phase2_ranking_snapshot_is_valid(
  p_snapshot jsonb,
  p_ordered_player_ids uuid[]
)
returns boolean
language plpgsql
immutable
strict
parallel safe
set search_path = ''
as $$
declare
  v_players_valid boolean;
  v_has_ties boolean;
  v_rank_mismatch boolean;
begin
  if jsonb_typeof(p_snapshot) <> 'object'
    or jsonb_typeof(p_snapshot -> 'players') <> 'array'
    or jsonb_array_length(p_snapshot -> 'players') <> 4
    or jsonb_typeof(p_snapshot -> 'tie_draws') <> 'array'
    or p_snapshot -> 'resolved_order_player_ids' is distinct from to_jsonb(p_ordered_player_ids)
  then
    return false;
  end if;

  select count(*) = 4
      and count(distinct item ->> 'player_id') = 4
      and bool_and(coalesce((item ->> 'player_id') = any (p_ordered_player_ids::text[]), false))
      and bool_and(case
        when jsonb_typeof(item -> 'phase1_score') = 'number'
          then (item ->> 'phase1_score')::numeric >= 0
        else false
      end)
      and array_agg(distinct item ->> 'resolved_rank' order by item ->> 'resolved_rank')
        = array['1', '2', '3', '4']::text[]
  into v_players_valid
  from jsonb_array_elements(p_snapshot -> 'players') as item;

  if v_players_valid is not true then
    return false;
  end if;

  select exists (
    select 1
    from jsonb_array_elements(p_snapshot -> 'players') as item
    group by item ->> 'phase1_score'
    having count(*) > 1
  ) into v_has_ties;

  if v_has_ties and jsonb_array_length(p_snapshot -> 'tie_draws') = 0 then
    return false;
  end if;

  select exists (
    select 1
    from unnest(p_ordered_player_ids) with ordinality as ordered(player_id, ordinality)
    left join jsonb_array_elements(p_snapshot -> 'players') as item
      on item ->> 'player_id' = ordered.player_id::text
    where item ->> 'resolved_rank' <> (5 - ordered.ordinality)::text
  ) into v_rank_mismatch;

  return coalesce(not v_rank_mismatch, false);
end;
$$;

create table if not exists public.phase2_drafts (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  status text not null default 'not_ready'
    check (status in ('not_ready', 'ready', 'drafting', 'completed', 'locked')),
  ordered_player_ids uuid[] not null default '{}'::uuid[],
  eligible_team_ids uuid[] not null default '{}'::uuid[],
  ranking_snapshot jsonb not null default '{}'::jsonb,
  current_pick_no integer not null default 1 check (current_pick_no between 1 and 16),
  starts_at timestamptz,
  deadline_at timestamptz,
  version bigint not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id),
  unique (id, event_id),
  constraint phase2_drafts_player_count_check check (
    (status = 'not_ready' and cardinality(ordered_player_ids) in (0, 4))
    or (status <> 'not_ready' and cardinality(ordered_player_ids) = 4)
  ),
  constraint phase2_drafts_team_count_check check (
    (status = 'not_ready' and cardinality(eligible_team_ids) in (0, 16))
    or (status <> 'not_ready' and cardinality(eligible_team_ids) = 16)
  ),
  constraint phase2_drafts_unique_players_check check (public.uuid_array_is_unique(ordered_player_ids)),
  constraint phase2_drafts_unique_teams_check check (public.uuid_array_is_unique(eligible_team_ids)),
  constraint phase2_drafts_schedule_check check (
    status = 'not_ready'
    or (starts_at is not null and deadline_at is not null and starts_at < deadline_at)
  )
);

create or replace function public.validate_koshien_phase2_draft_setup()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_player_count integer;
  v_team_count integer;
  v_pick_count integer;
begin
  if tg_op = 'INSERT' and new.status <> 'not_ready' then
    raise exception 'phase 2 draft must be inserted as not_ready';
  end if;

  select count(*) into v_pick_count
  from public.phase2_draft_picks dp
  where dp.draft_id = new.id;

  if new.status <> 'not_ready' then
    select e.league_id into v_league_id
    from public.events e
    where e.id = new.event_id;

    if v_league_id is null then
      raise exception 'phase 2 draft event is not found';
    end if;

    select count(*) into v_player_count
    from public.players p
    where p.league_id = v_league_id
      and p.id = any (new.ordered_player_ids)
      and p.profile_id is not null;

    select count(*) into v_team_count
    from public.teams t
    where t.event_id = new.event_id
      and t.id = any (new.eligible_team_ids);

    if v_player_count <> 4 then
      raise exception 'ordered_player_ids must reference four authenticated players in the event league';
    end if;
    if v_team_count <> 16 then
      raise exception 'eligible_team_ids must reference sixteen teams in the draft event';
    end if;
    if public.koshien_phase2_ranking_snapshot_is_valid(new.ranking_snapshot, new.ordered_player_ids) is not true then
      raise exception 'ranking_snapshot must contain four scored players, resolved ranks, tie draws, and the fixed order';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.version := old.version + 1;

    if old.status is distinct from new.status and not (
      (old.status = 'not_ready' and new.status = 'ready')
      or (old.status = 'ready' and new.status = 'drafting')
      or (old.status = 'drafting' and new.status = 'completed')
      or (old.status = 'completed' and new.status = 'locked')
    ) then
      raise exception 'invalid phase 2 draft status transition from % to %', old.status, new.status;
    end if;

    if old.status = 'ready' and new.status = 'drafting' and clock_timestamp() < new.starts_at then
      raise exception 'phase 2 draft cannot start before starts_at';
    end if;

    if old.status <> 'not_ready' and (
      old.event_id is distinct from new.event_id
      or old.ordered_player_ids is distinct from new.ordered_player_ids
      or old.ranking_snapshot is distinct from new.ranking_snapshot
      or old.eligible_team_ids is distinct from new.eligible_team_ids
      or old.starts_at is distinct from new.starts_at
      or old.deadline_at is distinct from new.deadline_at
    ) then
      raise exception 'cannot change fixed phase 2 draft setup after ready';
    end if;
  end if;

  if new.status in ('not_ready', 'ready') and (v_pick_count <> 0 or new.current_pick_no <> 1) then
    raise exception 'not_ready or ready phase 2 draft cannot contain picks';
  end if;
  if new.status = 'drafting' and (
    v_pick_count not between 0 and 15
    or new.current_pick_no <> v_pick_count + 1
  ) then
    raise exception 'drafting phase 2 draft current_pick_no must follow persisted picks';
  end if;
  if new.status in ('completed', 'locked') and (v_pick_count <> 16 or new.current_pick_no <> 16) then
    raise exception 'completed phase 2 draft requires exactly sixteen picks';
  end if;

  return new;
end;
$$;

drop trigger if exists phase2_drafts_validate_setup on public.phase2_drafts;
create trigger phase2_drafts_validate_setup
before insert or update on public.phase2_drafts
for each row execute function public.validate_koshien_phase2_draft_setup();

alter table public.phase2_draft_picks add column if not exists draft_id uuid;
alter table public.phase2_draft_picks add column if not exists pick_no integer;
alter table public.phase2_draft_picks add column if not exists request_id uuid;

do $$
begin
  if exists (
    select 1
    from public.phase2_draft_picks
    where draft_id is null or pick_no is null or request_id is null
  ) then
    raise exception 'phase2_draft_picks contains existing rows that require a reviewed conversion migration';
  end if;
end $$;

alter table public.phase2_draft_picks alter column draft_id set not null;
alter table public.phase2_draft_picks alter column pick_no set not null;
alter table public.phase2_draft_picks alter column request_id set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'phase2_draft_picks_draft_id_fkey') then
    alter table public.phase2_draft_picks
      add constraint phase2_draft_picks_draft_id_fkey
      foreign key (draft_id) references public.phase2_drafts(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase2_draft_picks_draft_event_fkey') then
    alter table public.phase2_draft_picks
      add constraint phase2_draft_picks_draft_event_fkey
      foreign key (draft_id, event_id) references public.phase2_drafts(id, event_id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase2_draft_picks_event_id_fkey') then
    alter table public.phase2_draft_picks
      add constraint phase2_draft_picks_event_id_fkey
      foreign key (event_id) references public.events(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase2_draft_picks_player_id_fkey') then
    alter table public.phase2_draft_picks
      add constraint phase2_draft_picks_player_id_fkey
      foreign key (player_id) references public.players(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase2_draft_picks_team_id_fkey') then
    alter table public.phase2_draft_picks
      add constraint phase2_draft_picks_team_id_fkey
      foreign key (team_id) references public.teams(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase2_draft_picks_pick_no_check') then
    alter table public.phase2_draft_picks
      add constraint phase2_draft_picks_pick_no_check check (pick_no between 1 and 16);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase2_draft_picks_round_check') then
    alter table public.phase2_draft_picks
      add constraint phase2_draft_picks_round_check check (draft_round between 1 and 4);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase2_draft_picks_draft_pick_key') then
    alter table public.phase2_draft_picks
      add constraint phase2_draft_picks_draft_pick_key unique (draft_id, pick_no);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase2_draft_picks_draft_team_key') then
    alter table public.phase2_draft_picks
      add constraint phase2_draft_picks_draft_team_key unique (draft_id, team_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase2_draft_picks_draft_player_round_key') then
    alter table public.phase2_draft_picks
      add constraint phase2_draft_picks_draft_player_round_key unique (draft_id, player_id, draft_round);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'phase2_draft_picks_draft_player_request_key') then
    alter table public.phase2_draft_picks
      add constraint phase2_draft_picks_draft_player_request_key unique (draft_id, player_id, request_id);
  end if;
end $$;

create index if not exists phase2_drafts_event_status_idx
  on public.phase2_drafts (event_id, status);
create index if not exists phase2_draft_picks_draft_player_idx
  on public.phase2_draft_picks (draft_id, player_id);
create index if not exists phase2_draft_picks_draft_team_idx
  on public.phase2_draft_picks (draft_id, team_id);

drop trigger if exists phase2_drafts_set_updated_at on public.phase2_drafts;
create trigger phase2_drafts_set_updated_at
before update on public.phase2_drafts
for each row execute function public.set_updated_at();

alter table public.phase2_drafts enable row level security;
alter table public.phase2_draft_picks enable row level security;

drop policy if exists phase2_drafts_select_members on public.phase2_drafts;
create policy phase2_drafts_select_members on public.phase2_drafts
for select to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_league_member(e.league_id)
  )
);

drop policy if exists phase2_drafts_rpc_update on public.phase2_drafts;
create policy phase2_drafts_rpc_update on public.phase2_drafts
for update to authenticated
using (
  current_setting('yoso.phase2_rpc', true) = 'save_pick'
  and exists (
    select 1 from public.events e
    where e.id = event_id
      and public.is_league_member(e.league_id)
  )
)
with check (
  current_setting('yoso.phase2_rpc', true) = 'save_pick'
  and exists (
    select 1 from public.events e
    where e.id = event_id
      and public.is_league_member(e.league_id)
  )
);

drop policy if exists phase2_draft_picks_select_owner_or_public on public.phase2_draft_picks;
drop policy if exists phase2_draft_picks_self_before_deadline on public.phase2_draft_picks;
drop policy if exists phase2_draft_picks_select_members on public.phase2_draft_picks;
create policy phase2_draft_picks_select_members on public.phase2_draft_picks
for select to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_league_member(e.league_id)
  )
);

drop policy if exists phase2_draft_picks_rpc_insert on public.phase2_draft_picks;
create policy phase2_draft_picks_rpc_insert on public.phase2_draft_picks
for insert to authenticated
with check (
  current_setting('yoso.phase2_rpc', true) = 'save_pick'
  and exists (
    select 1
    from public.players p
    join public.events e on e.league_id = p.league_id
    where p.id = player_id
      and p.profile_id = (select auth.uid())
      and e.id = event_id
  )
);

create or replace function public.get_koshien_phase2_draft_state(p_event_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_draft public.phase2_drafts;
  v_league_id uuid;
  v_viewer_player_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id;

  if v_league_id is null or not public.is_league_member(v_league_id) then
    raise exception 'league membership is required' using errcode = '42501';
  end if;

  select d.* into v_draft
  from public.phase2_drafts d
  where d.event_id = p_event_id;

  if v_draft.id is null then
    return jsonb_build_object(
      'draft', null,
      'viewer_player_id', null,
      'players', '[]'::jsonb,
      'teams', '[]'::jsonb,
      'picks', '[]'::jsonb
    );
  end if;

  select p.id into v_viewer_player_id
  from public.players p
  where p.league_id = v_league_id
    and p.profile_id = auth.uid();

  return jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'viewer_player_id', v_viewer_player_id,
    'players', coalesce((
      select jsonb_agg(
        jsonb_build_object('player_id', p.id, 'display_name', p.display_name)
        order by ordered.ordinality
      )
      from unnest(v_draft.ordered_player_ids) with ordinality as ordered(player_id, ordinality)
      join public.players p on p.id = ordered.player_id and p.league_id = v_league_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object('team_id', t.id, 'name', t.name)
        order by eligible.ordinality
      )
      from unnest(v_draft.eligible_team_ids) with ordinality as eligible(team_id, ordinality)
      join public.teams t on t.id = eligible.team_id and t.event_id = p_event_id
    ), '[]'::jsonb),
    'picks', coalesce((
      select jsonb_agg(to_jsonb(dp) order by dp.pick_no)
      from public.phase2_draft_picks dp
      where dp.draft_id = v_draft.id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_koshien_phase2_draft_pick(
  p_draft_id uuid,
  p_team_id uuid,
  p_expected_pick_no integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_draft public.phase2_drafts;
  v_existing public.phase2_draft_picks;
  v_league_id uuid;
  v_player_id uuid;
  v_expected_player_id uuid;
  v_round integer;
  v_slot integer;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request_id is required';
  end if;

  perform set_config('yoso.phase2_rpc', 'save_pick', true);

  select d.* into v_draft
  from public.phase2_drafts d
  where d.id = p_draft_id
  for update;

  if v_draft.id is null then
    raise exception 'phase 2 draft is not found or is not visible' using errcode = 'P0002';
  end if;

  select e.league_id into v_league_id
  from public.events e
  where e.id = v_draft.event_id;

  select p.id into v_player_id
  from public.players p
  where p.league_id = v_league_id
    and p.profile_id = auth.uid();

  if v_player_id is null or not (v_player_id = any (v_draft.ordered_player_ids)) then
    raise exception 'draft participant permission is required' using errcode = '42501';
  end if;

  select dp.* into v_existing
  from public.phase2_draft_picks dp
  where dp.draft_id = p_draft_id
    and dp.player_id = v_player_id
    and dp.request_id = p_request_id;

  if v_existing.id is not null then
    if v_existing.team_id <> p_team_id or v_existing.pick_no <> p_expected_pick_no then
      raise exception 'request_id was already used for a different pick' using errcode = '23505';
    end if;
    return public.get_koshien_phase2_draft_state(v_draft.event_id);
  end if;

  if v_draft.status <> 'drafting' then
    raise exception 'phase 2 draft is not active' using errcode = '55000';
  end if;
  if clock_timestamp() < v_draft.starts_at then
    raise exception 'phase 2 draft has not started' using errcode = '55000';
  end if;
  if clock_timestamp() >= v_draft.deadline_at then
    raise exception 'phase 2 draft deadline has passed' using errcode = '55000';
  end if;
  if p_expected_pick_no <> v_draft.current_pick_no then
    raise exception 'draft turn changed' using errcode = '40001';
  end if;
  if v_draft.current_pick_no not between 1 and 16 then
    raise exception 'current pick number is invalid';
  end if;

  v_round := ((v_draft.current_pick_no - 1) / 4) + 1;
  v_slot := ((v_draft.current_pick_no - 1) % 4) + 1;
  if (v_round % 2) = 1 then
    v_expected_player_id := v_draft.ordered_player_ids[v_slot];
  else
    v_expected_player_id := v_draft.ordered_player_ids[5 - v_slot];
  end if;

  if v_player_id <> v_expected_player_id then
    raise exception 'it is not the authenticated player turn' using errcode = '42501';
  end if;
  if not (p_team_id = any (v_draft.eligible_team_ids)) then
    raise exception 'team is not in the fixed best 16';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.event_id = v_draft.event_id
  ) then
    raise exception 'team does not belong to the draft event';
  end if;
  if exists (
    select 1 from public.phase2_draft_picks dp
    where dp.draft_id = v_draft.id and dp.team_id = p_team_id
  ) then
    raise exception 'team was already drafted' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.phase2_draft_picks dp
    where dp.draft_id = v_draft.id
      and dp.player_id = v_player_id
      and dp.draft_round = v_round
  ) then
    raise exception 'player already drafted in this round' using errcode = '23505';
  end if;
  if (select count(*) from public.phase2_draft_picks dp where dp.draft_id = v_draft.id and dp.player_id = v_player_id) >= 4 then
    raise exception 'player already owns four teams' using errcode = '23505';
  end if;

  insert into public.phase2_draft_picks (
    draft_id, event_id, player_id, team_id, pick_no, draft_round, request_id
  ) values (
    v_draft.id, v_draft.event_id, v_player_id, p_team_id,
    v_draft.current_pick_no, v_round, p_request_id
  );

  update public.phase2_drafts
  set current_pick_no = case when v_draft.current_pick_no = 16 then 16 else v_draft.current_pick_no + 1 end,
      status = case when v_draft.current_pick_no = 16 then 'completed' else v_draft.status end,
      version = v_draft.version + 1,
      updated_at = now()
  where id = v_draft.id;

  return public.get_koshien_phase2_draft_state(v_draft.event_id);
end;
$$;

revoke all on table public.phase2_drafts from anon, public;
revoke all on table public.phase2_draft_picks from anon, public;
revoke update, delete on table public.phase2_draft_picks from authenticated;
grant select, update on public.phase2_drafts to authenticated;
grant select, insert on public.phase2_draft_picks to authenticated;

revoke execute on function public.uuid_array_is_unique(uuid[]) from anon, public;
grant execute on function public.uuid_array_is_unique(uuid[]) to authenticated;
revoke execute on function public.koshien_phase2_ranking_snapshot_is_valid(jsonb, uuid[]) from anon, public;
grant execute on function public.koshien_phase2_ranking_snapshot_is_valid(jsonb, uuid[]) to authenticated;
revoke execute on function public.validate_koshien_phase2_draft_setup() from anon, public;
grant execute on function public.validate_koshien_phase2_draft_setup() to authenticated;
revoke execute on function public.is_league_member(uuid) from anon, public;
grant execute on function public.is_league_member(uuid) to authenticated;
revoke execute on function public.get_koshien_phase2_draft_state(text) from anon, public;
grant execute on function public.get_koshien_phase2_draft_state(text) to authenticated;
revoke execute on function public.save_koshien_phase2_draft_pick(uuid, uuid, integer, uuid) from anon, public;
grant execute on function public.save_koshien_phase2_draft_pick(uuid, uuid, integer, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
