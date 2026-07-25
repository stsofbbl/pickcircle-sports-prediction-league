begin;

create table if not exists public.league_admin_audit (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues(id) on delete cascade,
  target_user_id uuid not null references public.profiles(id) on delete cascade,
  previous_role text not null check (previous_role in ('admin', 'member')),
  new_role text not null check (new_role in ('admin', 'member')),
  changed_by uuid not null references public.profiles(id) on delete restrict,
  changed_at timestamptz not null default now()
);

create table if not exists public.koshien_result_cancellations (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  round_key text not null,
  match_no integer not null,
  previous_match jsonb not null,
  canceled_by uuid not null references public.profiles(id) on delete restrict,
  canceled_at timestamptz not null default now()
);

create index if not exists league_admin_audit_league_changed_at_idx
  on public.league_admin_audit (league_id, changed_at desc);
create index if not exists koshien_result_cancellations_event_canceled_at_idx
  on public.koshien_result_cancellations (event_id, canceled_at desc);

alter table public.league_admin_audit enable row level security;
alter table public.koshien_result_cancellations enable row level security;

drop policy if exists league_admin_audit_select_admins on public.league_admin_audit;
create policy league_admin_audit_select_admins
on public.league_admin_audit
for select
to authenticated
using (public.is_league_admin(league_id));

drop policy if exists koshien_result_cancellations_select_admins on public.koshien_result_cancellations;
create policy koshien_result_cancellations_select_admins
on public.koshien_result_cancellations
for select
to authenticated
using (
  exists (
    select 1
    from public.events e
    where e.id = event_id
      and public.is_league_admin(e.league_id)
  )
);

create or replace function public.protect_last_league_admin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.role = 'admin' then
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and new.role <> 'admin') then
      if (
        select count(*)
        from public.league_members lm
        where lm.league_id = old.league_id
          and lm.role = 'admin'
      ) <= 1 then
        raise exception 'last league admin cannot be removed' using errcode = '55000';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists protect_last_league_admin on public.league_members;
create trigger protect_last_league_admin
before update of role or delete on public.league_members
for each row execute function public.protect_last_league_admin();

create or replace function public.manage_league_admin(
  p_league_id uuid,
  p_user_id uuid,
  p_make_admin boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous_role text;
  v_new_role text := case when p_make_admin then 'admin' else 'member' end;
  v_admin_count integer;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if p_league_id is null or p_user_id is null or p_make_admin is null then
    raise exception 'league, member, and target role are required' using errcode = '22023';
  end if;
  if not public.is_league_admin(p_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;

  perform 1
  from public.league_members lm
  where lm.league_id = p_league_id
  for update;

  select lm.role
  into v_previous_role
  from public.league_members lm
  where lm.league_id = p_league_id
    and lm.user_id = p_user_id;

  if v_previous_role is null then
    raise exception 'target user is not a league member' using errcode = 'P0002';
  end if;
  if v_previous_role = v_new_role then
    return jsonb_build_object(
      'league_id', p_league_id,
      'user_id', p_user_id,
      'role', v_new_role,
      'changed', false
    );
  end if;

  if v_previous_role = 'admin' and not p_make_admin then
    select count(*)
    into v_admin_count
    from public.league_members lm
    where lm.league_id = p_league_id
      and lm.role = 'admin';

    if v_admin_count <= 1 then
      raise exception 'last league admin cannot be removed' using errcode = '55000';
    end if;
  end if;

  update public.league_members
  set role = v_new_role
  where league_id = p_league_id
    and user_id = p_user_id;

  update public.players
  set is_admin = p_make_admin,
      updated_at = now()
  where league_id = p_league_id
    and profile_id = p_user_id;

  insert into public.league_admin_audit (
    league_id, target_user_id, previous_role, new_role, changed_by
  )
  values (
    p_league_id, p_user_id, v_previous_role, v_new_role, auth.uid()
  );

  return jsonb_build_object(
    'league_id', p_league_id,
    'user_id', p_user_id,
    'role', v_new_role,
    'changed', true
  );
end;
$$;

create or replace function public.cancel_koshien_match_result(
  p_event_id text,
  p_round_key text,
  p_match_no integer,
  p_results_payload jsonb,
  p_score_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_match public.matches;
  v_score_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if p_event_id is null or p_round_key is null or p_match_no is null then
    raise exception 'event, round, and match number are required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_results_payload, 'null'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_score_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'results payload must be an object and score rows must be an array' using errcode = '22023';
  end if;

  select e.league_id
  into v_league_id
  from public.events e
  where e.id = p_event_id
    and e.preset_type = 'koshien';

  if v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;

  select m.*
  into v_match
  from public.matches m
  where m.event_id = p_event_id
    and m.round_key = p_round_key
    and m.match_no = p_match_no
  for update;

  if v_match.id is null then
    raise exception 'completed match was not found' using errcode = 'P0002';
  end if;
  if v_match.status <> 'completed' then
    raise exception 'only a completed match can be canceled' using errcode = '55000';
  end if;

  if p_round_key in ('R1', 'R2', 'R3') and (
    exists (
      select 1 from public.phase2_drafts d
      where d.event_id = p_event_id and d.status <> 'not_ready'
    )
    or exists (
      select 1 from public.koshien_later_rounds r
      where r.event_id = p_event_id
        and r.phase_key = 'revenge'
        and r.status <> 'not_ready'
    )
  ) then
    raise exception 'downstream phase is already prepared; reset that phase before canceling this result'
      using errcode = '55000';
  end if;

  if p_round_key = 'QF' and exists (
    select 1 from public.koshien_later_rounds r
    where r.event_id = p_event_id
      and r.phase_key = 'zombie'
      and r.status <> 'not_ready'
  ) then
    raise exception 'downstream phase is already prepared; reset that phase before canceling this result'
      using errcode = '55000';
  end if;

  if p_round_key = 'SF' and exists (
    select 1 from public.koshien_later_rounds r
    where r.event_id = p_event_id
      and r.phase_key = 'phase3'
      and r.status <> 'not_ready'
  ) then
    raise exception 'downstream phase is already prepared; reset that phase before canceling this result'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_score_rows) as x(event_id text, player_id uuid)
    left join public.players p
      on p.id = x.player_id
      and p.league_id = v_league_id
    where x.event_id is distinct from p_event_id
      or p.id is null
  ) then
    raise exception 'scores payload contains an invalid event or player reference' using errcode = '22023';
  end if;

  insert into public.koshien_result_cancellations (
    event_id, round_key, match_no, previous_match, canceled_by
  )
  values (
    p_event_id,
    p_round_key,
    p_match_no,
    to_jsonb(v_match),
    auth.uid()
  );

  update public.matches
  set team1_score = null,
      team2_score = null,
      winner_team_id = null,
      loser_team_id = null,
      status = 'scheduled',
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('canceled_at', now(), 'canceled_by', auth.uid()),
      updated_at = now()
  where id = v_match.id;

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

  return jsonb_build_object(
    'event_id', p_event_id,
    'round_key', p_round_key,
    'match_no', p_match_no,
    'status', 'scheduled',
    'score_count', v_score_count
  );
end;
$$;

drop policy if exists league_members_update_admin on public.league_members;
revoke update on public.league_members from authenticated;

revoke all on public.league_admin_audit, public.koshien_result_cancellations from anon, public;
grant select on public.league_admin_audit, public.koshien_result_cancellations to authenticated;

revoke all on function public.manage_league_admin(uuid, uuid, boolean) from anon, public;
grant execute on function public.manage_league_admin(uuid, uuid, boolean) to authenticated;

revoke all on function public.protect_last_league_admin() from anon, authenticated, public;

revoke all on function public.cancel_koshien_match_result(text, text, integer, jsonb, jsonb) from anon, public;
grant execute on function public.cancel_koshien_match_result(text, text, integer, jsonb, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
