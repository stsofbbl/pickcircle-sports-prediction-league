begin;

create table if not exists public.external_team_aliases (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  source text not null check (source = 'jhbf'),
  external_name text not null check (length(trim(external_name)) between 1 and 120),
  normalized_external_name text not null check (length(trim(normalized_external_name)) between 1 and 120),
  team_id uuid not null references public.teams(id) on delete cascade,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, source, normalized_external_name)
);

create table if not exists public.external_result_fetches (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  source text not null check (source = 'jhbf'),
  requested_by uuid not null references public.profiles(id) on delete restrict,
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  source_urls text[] not null default '{}'::text[],
  row_count integer not null default 0 check (row_count >= 0),
  error_code text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists external_result_fetches_cooldown_idx
  on public.external_result_fetches (event_id, source, requested_by, created_at desc);

create table if not exists public.external_match_imports (
  id uuid primary key default gen_random_uuid(),
  event_id text not null references public.events(id) on delete cascade,
  source text not null check (source = 'jhbf'),
  external_key text not null check (external_key ~ '^jhbf:(summer|senbatsu):[0-9]{4}:[0-9]{4}-[0-9]{2}-[0-9]{2}:[1-9][0-9]*$'),
  source_url text not null,
  normalized_payload jsonb not null check (jsonb_typeof(normalized_payload) = 'object'),
  raw_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(raw_payload) = 'object'),
  status text not null default 'confirmed' check (status = 'confirmed'),
  imported_match_id uuid not null references public.matches(id) on delete restrict,
  fetched_at timestamptz not null,
  confirmed_at timestamptz not null default now(),
  confirmed_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, source, external_key)
);

create or replace trigger external_team_aliases_set_updated_at
before update on public.external_team_aliases
for each row execute function public.set_updated_at();

create or replace trigger external_match_imports_set_updated_at
before update on public.external_match_imports
for each row execute function public.set_updated_at();

alter table public.external_team_aliases enable row level security;
alter table public.external_result_fetches enable row level security;
alter table public.external_match_imports enable row level security;

create policy external_team_aliases_admin_all
on public.external_team_aliases
for all
to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = event_id and public.is_league_admin(e.league_id)
  )
)
with check (
  exists (
    select 1 from public.events e
    where e.id = event_id and public.is_league_admin(e.league_id)
  )
);

create policy external_result_fetches_admin_all
on public.external_result_fetches
for all
to authenticated
using (
  requested_by = (select auth.uid())
  and exists (
    select 1 from public.events e
    where e.id = event_id and public.is_league_admin(e.league_id)
  )
)
with check (
  requested_by = (select auth.uid())
  and exists (
    select 1 from public.events e
    where e.id = event_id and public.is_league_admin(e.league_id)
  )
);

create policy external_match_imports_admin_all
on public.external_match_imports
for all
to authenticated
using (
  exists (
    select 1 from public.events e
    where e.id = event_id and public.is_league_admin(e.league_id)
  )
)
with check (
  confirmed_by = (select auth.uid())
  and exists (
    select 1 from public.events e
    where e.id = event_id and public.is_league_admin(e.league_id)
  )
);

grant select, insert, update, delete on public.external_team_aliases to authenticated;
grant select, insert, update on public.external_result_fetches to authenticated;
grant select, insert, update on public.external_match_imports to authenticated;
revoke all on public.external_team_aliases, public.external_result_fetches, public.external_match_imports from anon, public;

create or replace function public.request_koshien_external_fetch(p_event_id text, p_source text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_fetch_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if p_source <> 'jhbf' then
    raise exception 'unsupported external result source';
  end if;
  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id and e.preset_type = 'koshien';
  if v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.external_result_fetches f
    where f.event_id = p_event_id
      and f.source = p_source
      and f.requested_by = auth.uid()
      and f.created_at > clock_timestamp() - interval '5 minutes'
  ) then
    raise exception 'result fetch cooldown active' using errcode = '55000';
  end if;
  insert into public.external_result_fetches (event_id, source, requested_by)
  values (p_event_id, p_source, auth.uid())
  returning id into v_fetch_id;
  return jsonb_build_object('fetchId', v_fetch_id, 'status', 'started');
end;
$$;

create or replace function public.complete_koshien_external_fetch(
  p_fetch_id uuid,
  p_status text,
  p_source_urls text[],
  p_row_count integer,
  p_error_code text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_fetch public.external_result_fetches;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if p_status not in ('completed', 'failed') then
    raise exception 'invalid fetch completion status';
  end if;
  select f.* into v_fetch
  from public.external_result_fetches f
  where f.id = p_fetch_id
  for update;
  if v_fetch.id is null or v_fetch.requested_by <> auth.uid() then
    raise exception 'external fetch is unavailable' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_source_urls, '{}'::text[])) u(url)
    where u.url !~ '^https://(www\.)?jhbf\.or\.jp/(sensyuken|senbatsu)/[0-9]{4}/schedule/schedule_[0-9]{8}\.html$'
  ) then
    raise exception 'source URL is outside the JHBF allowlist';
  end if;
  update public.external_result_fetches
  set status = p_status,
      source_urls = coalesce(p_source_urls, '{}'::text[]),
      row_count = greatest(coalesce(p_row_count, 0), 0),
      error_code = nullif(trim(coalesce(p_error_code, '')), ''),
      completed_at = clock_timestamp()
  where id = p_fetch_id;
  return jsonb_build_object('fetchId', p_fetch_id, 'status', p_status);
end;
$$;

create or replace function public.get_koshien_external_import_context(p_event_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_league_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id and e.preset_type = 'koshien';
  if v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'eventId', p_event_id,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('teamId', t.id, 'name', t.name) order by t.seed, t.name)
      from public.teams t where t.event_id = p_event_id
    ), '[]'::jsonb),
    'aliases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'externalName', a.external_name,
        'normalizedExternalName', a.normalized_external_name,
        'teamId', a.team_id
      ) order by a.external_name)
      from public.external_team_aliases a
      where a.event_id = p_event_id and a.source = 'jhbf'
    ), '[]'::jsonb),
    'imports', coalesce((
      select jsonb_agg(jsonb_build_object(
        'externalKey', i.external_key,
        'normalizedPayload', i.normalized_payload,
        'importedMatchId', i.imported_match_id,
        'status', i.status
      ) order by i.confirmed_at desc)
      from public.external_match_imports i
      where i.event_id = p_event_id and i.source = 'jhbf'
    ), '[]'::jsonb),
    'matches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'matchId', m.id,
        'roundKey', m.round_key,
        'matchNo', m.match_no,
        'team1Id', m.team1_id,
        'team2Id', m.team2_id,
        'team1Name', t1.name,
        'team2Name', t2.name,
        'team1Score', m.team1_score,
        'team2Score', m.team2_score,
        'winnerTeamId', m.winner_team_id,
        'status', m.status
      ) order by case m.round_key
        when 'R1' then 1 when 'R2' then 2 when 'R3' then 3
        when 'QF' then 4 when 'SF' then 5 when 'F' then 6 else 99 end,
        m.match_no)
      from public.matches m
      left join public.teams t1 on t1.id = m.team1_id
      left join public.teams t2 on t2.id = m.team2_id
      where m.event_id = p_event_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.save_koshien_external_team_alias(
  p_event_id text,
  p_source text,
  p_external_name text,
  p_normalized_external_name text,
  p_team_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_league_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if p_source <> 'jhbf' then raise exception 'unsupported external result source'; end if;
  if length(trim(coalesce(p_external_name, ''))) not between 1 and 120
     or length(trim(coalesce(p_normalized_external_name, ''))) not between 1 and 120 then
    raise exception 'valid external school name is required';
  end if;
  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id and e.preset_type = 'koshien';
  if v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team_id and t.event_id = p_event_id) then
    raise exception 'team does not belong to event';
  end if;
  insert into public.external_team_aliases (
    event_id, source, external_name, normalized_external_name, team_id, created_by
  ) values (
    p_event_id, p_source, trim(p_external_name), trim(p_normalized_external_name), p_team_id, auth.uid()
  )
  on conflict (event_id, source, normalized_external_name) do update set
    external_name = excluded.external_name,
    team_id = excluded.team_id,
    created_by = excluded.created_by,
    updated_at = now();
  return jsonb_build_object('ok', true, 'externalName', trim(p_external_name), 'teamId', p_team_id);
end;
$$;

create or replace function public.record_koshien_external_imports(p_event_id text, p_rows jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_item jsonb;
  v_payload jsonb;
  v_external_key text;
  v_source_url text;
  v_imported_match_id uuid;
  v_existing public.external_match_imports;
  v_match public.matches;
  v_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'import rows must be an array';
  end if;
  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id and e.preset_type = 'koshien';
  if v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(p_rows) loop
    if v_item->>'source' <> 'jhbf' then raise exception 'unsupported import source'; end if;
    v_external_key := v_item->>'externalKey';
    v_source_url := v_item->>'sourceUrl';
    v_imported_match_id := nullif(v_item->>'importedMatchId', '')::uuid;
    v_payload := v_item->'normalizedPayload';
    if v_external_key is null or v_external_key !~ '^jhbf:(summer|senbatsu):[0-9]{4}:[0-9]{4}-[0-9]{2}-[0-9]{2}:[1-9][0-9]*$' then
      raise exception 'invalid external match key';
    end if;
    if v_source_url is null or v_source_url !~ '^https://(www\.)?jhbf\.or\.jp/(sensyuken|senbatsu)/[0-9]{4}/schedule/schedule_[0-9]{8}\.html$' then
      raise exception 'source URL is outside the JHBF allowlist';
    end if;
    if jsonb_typeof(coalesce(v_payload, 'null'::jsonb)) <> 'object'
       or v_payload->>'source' <> 'jhbf'
       or v_payload->>'externalKey' is distinct from v_external_key
       or coalesce(v_payload->>'roundKey', '') not in ('R1','R2','R3','QF','SF','F')
       or coalesce(v_payload->>'team1Id', '') !~ '^[0-9a-f-]{36}$'
       or coalesce(v_payload->>'team2Id', '') !~ '^[0-9a-f-]{36}$'
       or coalesce(v_payload->>'winnerTeamId', '') !~ '^[0-9a-f-]{36}$'
       or coalesce(v_payload->>'loserTeamId', '') !~ '^[0-9a-f-]{36}$'
       or coalesce(v_payload->>'team1Score', '') !~ '^[0-9]+$'
       or coalesce(v_payload->>'team2Score', '') !~ '^[0-9]+$'
       or (v_payload->>'team1Score')::integer = (v_payload->>'team2Score')::integer then
      raise exception 'normalized import payload is invalid';
    end if;
    select m.* into v_match
    from public.matches m
    where m.id = v_imported_match_id and m.event_id = p_event_id;
    if v_match.id is null or v_match.status <> 'completed'
       or v_match.round_key is distinct from v_payload->>'roundKey'
       or v_match.team1_id is distinct from (v_payload->>'team1Id')::uuid
       or v_match.team2_id is distinct from (v_payload->>'team2Id')::uuid
       or v_match.team1_score is distinct from (v_payload->>'team1Score')::integer
       or v_match.team2_score is distinct from (v_payload->>'team2Score')::integer
       or v_match.winner_team_id is distinct from (v_payload->>'winnerTeamId')::uuid
       or v_match.loser_team_id is distinct from (v_payload->>'loserTeamId')::uuid then
      raise exception 'saved match does not match external import payload';
    end if;
    select i.* into v_existing
    from public.external_match_imports i
    where i.event_id = p_event_id and i.source = 'jhbf' and i.external_key = v_external_key
    for update;
    if v_existing.id is not null then
      if v_existing.normalized_payload is distinct from v_payload
         or v_existing.imported_match_id is distinct from v_imported_match_id then
        raise exception 'external import payload conflict' using errcode = '23505';
      end if;
      continue;
    end if;
    insert into public.external_match_imports (
      event_id, source, external_key, source_url, normalized_payload, raw_payload,
      imported_match_id, fetched_at, confirmed_by
    ) values (
      p_event_id, 'jhbf', v_external_key, v_source_url, v_payload,
      coalesce(v_item->'rawPayload', '{}'::jsonb), v_imported_match_id,
      coalesce(nullif(v_item->>'fetchedAt', '')::timestamptz, now()), auth.uid()
    );
    v_count := v_count + 1;
  end loop;
  return jsonb_build_object('ok', true, 'inserted', v_count);
end;
$$;

revoke all on function public.request_koshien_external_fetch(text, text) from public, anon;
revoke all on function public.complete_koshien_external_fetch(uuid, text, text[], integer, text) from public, anon;
revoke all on function public.get_koshien_external_import_context(text) from public, anon;
revoke all on function public.save_koshien_external_team_alias(text, text, text, text, uuid) from public, anon;
revoke all on function public.record_koshien_external_imports(text, jsonb) from public, anon;

grant execute on function public.request_koshien_external_fetch(text, text) to authenticated;
grant execute on function public.complete_koshien_external_fetch(uuid, text, text[], integer, text) to authenticated;
grant execute on function public.get_koshien_external_import_context(text) to authenticated;
grant execute on function public.save_koshien_external_team_alias(text, text, text, text, uuid) to authenticated;
grant execute on function public.record_koshien_external_imports(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
