begin;

create table if not exists public.koshien_result_reopens (
  id bigint generated always as identity primary key,
  event_id text not null references public.events(id) on delete cascade,
  previous_event jsonb not null,
  reopened_by uuid not null references public.profiles(id) on delete restrict,
  reopened_at timestamptz not null default now()
);

create index if not exists koshien_result_reopens_event_reopened_at_idx
  on public.koshien_result_reopens (event_id, reopened_at desc);

alter table public.koshien_result_reopens enable row level security;

drop policy if exists koshien_result_reopens_select_admins on public.koshien_result_reopens;
create policy koshien_result_reopens_select_admins
on public.koshien_result_reopens
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

create or replace function public.protect_completed_koshien_downstream_result()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'completed'
    and new.status = 'scheduled'
    and old.winner_team_id is not null
    and exists (
      select 1
      from public.matches downstream
      where downstream.event_id = old.event_id
        and downstream.id <> old.id
        and downstream.status = 'completed'
        and old.winner_team_id in (downstream.team1_id, downstream.team2_id)
    ) then
    raise exception 'dependent completed match exists; cancel the downstream result first'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_completed_koshien_downstream_result on public.matches;
create trigger protect_completed_koshien_downstream_result
before update of status on public.matches
for each row execute function public.protect_completed_koshien_downstream_result();

create or replace function public.reopen_koshien_results(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      rules = jsonb_set(coalesce(rules, '{}'::jsonb), '{resultFlow}', v_result_flow, true),
      updated_at = now()
  where id = p_event_id;

  return jsonb_build_object(
    'event_id', p_event_id,
    'status', 'resultWait',
    'result_flow', v_result_flow
  );
end;
$$;

revoke all on function public.protect_completed_koshien_downstream_result() from anon, authenticated, public;
revoke all on function public.reopen_koshien_results(text) from anon, public;
grant execute on function public.reopen_koshien_results(text) to authenticated;

notify pgrst, 'reload schema';

commit;
