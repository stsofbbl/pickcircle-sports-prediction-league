begin;

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
      select jsonb_agg(jsonb_build_object(
        'teamId', t.id,
        'name', t.name,
        'startRound', t.start_round
      ) order by t.seed, t.name)
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
        'status', m.status,
        'metadata', m.metadata
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

revoke all on function public.get_koshien_external_import_context(text) from public, anon;
grant execute on function public.get_koshien_external_import_context(text) to authenticated;

create or replace function public.register_koshien_official_second_round_slots(
  p_event_id text,
  p_matches jsonb,
  p_source_url text,
  p_fetched_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.events;
  v_result public.results;
  v_result_payload jsonb;
  v_item jsonb;
  v_existing public.matches;
  v_slot jsonb;
  v_match_no integer;
  v_slot_index integer;
  v_team1_id uuid;
  v_team2_id uuid;
  v_team1_source_match_no integer;
  v_team2_source_match_no integer;
  v_team1_name text;
  v_team2_name text;
  v_new_metadata jsonb;
  v_new_slot jsonb;
  v_existing_count integer := 0;
  v_changed_count integer := 0;
  v_row_count integer := 0;
  v_results_changed boolean := false;
  v_registered_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id and e.preset_type = 'koshien'
  for update;
  if v_event.id is null or not public.is_league_admin(v_event.league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_matches, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_matches) <> 16 then
    raise exception 'exactly 16 second-round matches are required';
  end if;
  if coalesce(p_source_url, '') !~ '^https://(www\.)?jhbf\.or\.jp/sensyuken/[0-9]{4}/tournament/?$' then
    raise exception 'source URL is outside the JHBF allowlist';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_matches) item
    where item->>'round_key' is distinct from 'R2'
      or coalesce(item->>'match_no', '') !~ '^[0-9]+$'
      or (nullif(item->>'team1_id', '') is null) = (nullif(item->>'team1_source_match_no', '') is null)
      or (nullif(item->>'team2_id', '') is null) = (nullif(item->>'team2_source_match_no', '') is null)
      or (nullif(item->>'team1_id', '') is not null and item->>'team1_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or (nullif(item->>'team2_id', '') is not null and item->>'team2_id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or (nullif(item->>'team1_source_match_no', '') is not null and item->>'team1_source_match_no' !~ '^[0-9]+$')
      or (nullif(item->>'team2_source_match_no', '') is not null and item->>'team2_source_match_no' !~ '^[0-9]+$')
  ) then
    raise exception 'invalid second-round match payload';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_matches) item
    where (item->>'match_no')::integer not between 1 and 16
      or coalesce(nullif(item->>'team1_source_match_no', '')::integer, 1) not between 1 and 17
      or coalesce(nullif(item->>'team2_source_match_no', '')::integer, 1) not between 1 and 17
  ) then
    raise exception 'invalid second-round match payload';
  end if;
  if (select count(distinct (item->>'match_no')::integer) from jsonb_array_elements(p_matches) item) <> 16
     or exists (
       select 1 from generate_series(1, 16) expected(match_no)
       where not exists (
         select 1 from jsonb_array_elements(p_matches) item
         where (item->>'match_no')::integer = expected.match_no
       )
     ) then
    raise exception 'R2-1 through R2-16 must be unique and complete';
  end if;
  if (
    with provided_teams as (
      select nullif(item->>'team1_id', '')::uuid as team_id from jsonb_array_elements(p_matches) item
      union all
      select nullif(item->>'team2_id', '')::uuid as team_id from jsonb_array_elements(p_matches) item
    )
    select count(distinct team_id) from provided_teams where team_id is not null
  ) <> 15 then
    raise exception 'count(distinct team_id) <> 15: second-round starters must be unique';
  end if;
  if (
    with provided_sources as (
      select nullif(item->>'team1_source_match_no', '')::integer as source_match_no from jsonb_array_elements(p_matches) item
      union all
      select nullif(item->>'team2_source_match_no', '')::integer as source_match_no from jsonb_array_elements(p_matches) item
    )
    select count(distinct source_match_no) from provided_sources where source_match_no is not null
  ) <> 17 then
    raise exception 'count(distinct source_match_no) <> 17: first-round feeders must be unique';
  end if;
  if exists (
    select 1 from generate_series(1, 17) expected(match_no)
    where not exists (
      select 1
      from jsonb_array_elements(p_matches) item
      where nullif(item->>'team1_source_match_no', '')::integer = expected.match_no
         or nullif(item->>'team2_source_match_no', '')::integer = expected.match_no
    )
  ) then
    raise exception 'R1-1 through R1-17 must each feed one second-round slot';
  end if;
  if exists (
    with provided_teams as (
      select nullif(item->>'team1_id', '')::uuid as team_id from jsonb_array_elements(p_matches) item
      union all
      select nullif(item->>'team2_id', '')::uuid as team_id from jsonb_array_elements(p_matches) item
    )
    select 1
    from provided_teams p
    left join public.teams t on t.id = p.team_id and t.event_id = p_event_id
    where p.team_id is not null and (t.id is null or t.start_round <> 2)
  ) then
    raise exception 'team does not belong to event or is not a second-round starter';
  end if;
  if exists (
    select 1 from generate_series(1, 17) expected(match_no)
    where not exists (
      select 1 from public.matches m
      where m.event_id = p_event_id and m.round_key = 'R1' and m.match_no = expected.match_no
    )
  ) then
    raise exception 'official first-round cards are incomplete';
  end if;
  perform m.id
  from public.matches m
  where m.event_id = p_event_id and m.round_key = 'R1' and m.match_no between 1 and 17
  order by m.match_no
  for update;

  select r.* into v_result
  from public.results r
  where r.event_id = p_event_id
  for update;
  if v_result.id is null
     or jsonb_typeof(v_result.payload) <> 'object'
     or jsonb_typeof(v_result.payload->'matches') <> 'array' then
    raise exception 'results payload does not contain tournament match slots';
  end if;
  if exists (
    select 1 from public.matches m
    where m.event_id = p_event_id and m.round_key = 'R2'
      and (m.match_no not between 1 and 16 or not exists (
        select 1 from jsonb_array_elements(p_matches) item
        where (item->>'match_no')::integer = m.match_no
      ))
  ) then
    raise exception 'different second-round draw is already saved';
  end if;

  select count(*) into v_existing_count
  from public.matches m
  where m.event_id = p_event_id and m.round_key = 'R2';
  v_result_payload := v_result.payload;

  for v_item in select value from jsonb_array_elements(p_matches) loop
    v_match_no := (v_item->>'match_no')::integer;
    v_team1_source_match_no := nullif(v_item->>'team1_source_match_no', '')::integer;
    v_team2_source_match_no := nullif(v_item->>'team2_source_match_no', '')::integer;
    v_team1_id := nullif(v_item->>'team1_id', '')::uuid;
    v_team2_id := nullif(v_item->>'team2_id', '')::uuid;
    if v_team1_source_match_no is not null then
      select m.winner_team_id into v_team1_id
      from public.matches m
      where m.event_id = p_event_id and m.round_key = 'R1' and m.match_no = v_team1_source_match_no;
    end if;
    if v_team2_source_match_no is not null then
      select m.winner_team_id into v_team2_id
      from public.matches m
      where m.event_id = p_event_id and m.round_key = 'R1' and m.match_no = v_team2_source_match_no;
    end if;

    select m.* into v_existing
    from public.matches m
    where m.event_id = p_event_id and m.round_key = 'R2' and m.match_no = v_match_no
    for update;
    if v_existing.id is not null and (
      (v_team1_source_match_no is null and (
        v_existing.team1_id is not null and v_existing.team1_id is distinct from v_team1_id
        or v_existing.metadata ? 'team1_source_match_no'
      ))
      or (v_team2_source_match_no is null and (
        v_existing.team2_id is not null and v_existing.team2_id is distinct from v_team2_id
        or v_existing.metadata ? 'team2_source_match_no'
      ))
      or (v_team1_source_match_no is not null and (
        nullif(v_existing.metadata->>'team1_source_match_no', '')::integer is distinct from v_team1_source_match_no
        or v_existing.team1_id is distinct from v_team1_id
      ))
      or (v_team2_source_match_no is not null and (
        nullif(v_existing.metadata->>'team2_source_match_no', '')::integer is distinct from v_team2_source_match_no
        or v_existing.team2_id is distinct from v_team2_id
      ))
    ) then
      raise exception 'different second-round draw is already saved';
    end if;

    select t.name into v_team1_name from public.teams t where t.id = v_team1_id and t.event_id = p_event_id;
    select t.name into v_team2_name from public.teams t where t.id = v_team2_id and t.event_id = p_event_id;
    v_new_metadata := coalesce(v_existing.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'match_id', 'R2-' || v_match_no,
      'team_a_name', coalesce(v_team1_name, ''),
      'team_b_name', coalesce(v_team2_name, ''),
      'team1_source_round_key', case when v_team1_source_match_no is not null then 'R1' end,
      'team1_source_match_no', v_team1_source_match_no,
      'team2_source_round_key', case when v_team2_source_match_no is not null then 'R1' end,
      'team2_source_match_no', v_team2_source_match_no,
      'source', 'jhbf',
      'source_url', p_source_url,
      'fetched_at', coalesce(v_existing.metadata->'fetched_at', to_jsonb(coalesce(p_fetched_at, v_registered_at))),
      'source_version', coalesce(v_existing.metadata->'source_version', to_jsonb(coalesce(p_fetched_at, v_registered_at)::text)),
      'registered_by', coalesce(v_existing.metadata->'registered_by', to_jsonb(auth.uid())),
      'registered_at', coalesce(v_existing.metadata->'registered_at', to_jsonb(v_registered_at))
    ));

    insert into public.matches as target (
      event_id, round_key, match_no, team1_id, team2_id,
      team1_score, team2_score, winner_team_id, loser_team_id,
      status, metadata, updated_at
    ) values (
      p_event_id, 'R2', v_match_no, v_team1_id, v_team2_id,
      null, null, null, null, 'scheduled',
      v_new_metadata,
      now()
    )
    on conflict (event_id, round_key, match_no) do update set
      team1_id = excluded.team1_id,
      team2_id = excluded.team2_id,
      metadata = excluded.metadata,
      updated_at = now()
    where target.team1_id is distinct from excluded.team1_id
       or target.team2_id is distinct from excluded.team2_id
       or target.metadata is distinct from excluded.metadata;
    get diagnostics v_row_count = row_count;
    v_changed_count := v_changed_count + v_row_count;

    select (slot.ordinality - 1)::integer, slot.value
    into v_slot_index, v_slot
    from jsonb_array_elements(v_result_payload->'matches') with ordinality slot(value, ordinality)
    where slot.value->>'round' = 'R2'
      and nullif(slot.value->>'match_no', '')::integer = v_match_no
    limit 1;
    if v_slot_index is null then
      raise exception 'results payload second-round slot mismatch';
    end if;
    if coalesce(v_slot->>'status', 'scheduled') in ('completed', 'final') then
      if coalesce(v_slot->>'team_a_id', '') is distinct from coalesce(v_team1_name, '')
         or coalesce(v_slot->>'team_b_id', '') is distinct from coalesce(v_team2_name, '')
         or nullif(v_slot->'metadata'->>'team1_source_match_no', '')::integer is distinct from v_team1_source_match_no
         or nullif(v_slot->'metadata'->>'team2_source_match_no', '')::integer is distinct from v_team2_source_match_no then
        raise exception 'completed second-round match cannot be overwritten';
      end if;
      v_slot_index := null;
      continue;
    end if;
    v_new_slot := coalesce(v_slot, '{}'::jsonb) || jsonb_build_object(
        'match_id', 'R2-' || v_match_no,
        'round', 'R2',
        'match_no', v_match_no,
        'team_a_id', coalesce(v_team1_name, ''),
        'team_b_id', coalesce(v_team2_name, ''),
        'metadata', coalesce(v_slot->'metadata', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'team1_source_round_key', case when v_team1_source_match_no is not null then 'R1' end,
          'team1_source_match_no', v_team1_source_match_no,
          'team2_source_round_key', case when v_team2_source_match_no is not null then 'R1' end,
          'team2_source_match_no', v_team2_source_match_no,
          'source', 'jhbf',
          'source_url', p_source_url,
          'source_version', coalesce(
            v_slot->'metadata'->'source_version',
            to_jsonb(coalesce(p_fetched_at, v_registered_at)::text)
          )
        ))
      );
    v_result_payload := jsonb_set(
      v_result_payload,
      array['matches', v_slot_index::text],
      v_new_slot,
      false
    );
    v_slot_index := null;
  end loop;

  if v_result.payload is distinct from v_result_payload then
    update public.results
    set payload = v_result_payload,
        updated_by = auth.uid(),
        updated_at = now()
    where event_id = p_event_id;
    v_results_changed := true;
  end if;

  return jsonb_build_object(
    'ok', true,
    'count', 16,
    'inserted', 16 - v_existing_count,
    'idempotent', v_changed_count = 0 and not v_results_changed
  );
end;
$$;

revoke all on function public.register_koshien_official_second_round_slots(text, jsonb, text, timestamptz) from public, anon;
grant execute on function public.register_koshien_official_second_round_slots(text, jsonb, text, timestamptz) to authenticated;

create or replace function public.sync_koshien_official_second_round_advancement()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_downstream public.matches;
  v_team_id uuid;
  v_team1_name text;
  v_team2_name text;
  v_matches_payload jsonb;
begin
  if new.round_key = 'R1' then
    v_team_id := case when new.status = 'completed' then new.winner_team_id else null end;
  else
    return new;
  end if;

  for v_downstream in
    select m.*
    from public.matches m
    where m.event_id = new.event_id
      and m.round_key = 'R2'
      and (
        nullif(m.metadata->>'team1_source_match_no', '')::integer = new.match_no
        or nullif(m.metadata->>'team2_source_match_no', '')::integer = new.match_no
      )
    for update
  loop
    if v_downstream.status = 'completed'
       and ((nullif(v_downstream.metadata->>'team1_source_match_no', '')::integer = new.match_no and v_downstream.team1_id is distinct from v_team_id)
         or (nullif(v_downstream.metadata->>'team2_source_match_no', '')::integer = new.match_no and v_downstream.team2_id is distinct from v_team_id)) then
      raise exception 'dependent completed match exists; cancel the downstream result first' using errcode = '55000';
    end if;
    if v_team_id is not null
       and ((nullif(v_downstream.metadata->>'team1_source_match_no', '')::integer = new.match_no
          and v_downstream.team1_id is not null and v_downstream.team1_id is distinct from v_team_id)
         or (nullif(v_downstream.metadata->>'team2_source_match_no', '')::integer = new.match_no
          and v_downstream.team2_id is not null and v_downstream.team2_id is distinct from v_team_id)) then
      raise exception 'different second-round draw is already saved' using errcode = '55000';
    end if;

    update public.matches m
    set team1_id = case
          when nullif(v_downstream.metadata->>'team1_source_match_no', '')::integer = new.match_no then v_team_id
          else v_downstream.team1_id
        end,
        team2_id = case
          when nullif(v_downstream.metadata->>'team2_source_match_no', '')::integer = new.match_no then v_team_id
          else v_downstream.team2_id
        end,
        metadata = v_downstream.metadata || jsonb_build_object(
          'team_a_name', coalesce((select t.name from public.teams t where t.id = case
            when nullif(v_downstream.metadata->>'team1_source_match_no', '')::integer = new.match_no then v_team_id
            else v_downstream.team1_id end), ''),
          'team_b_name', coalesce((select t.name from public.teams t where t.id = case
            when nullif(v_downstream.metadata->>'team2_source_match_no', '')::integer = new.match_no then v_team_id
            else v_downstream.team2_id end), '')
        ),
        updated_at = now()
    where m.id = v_downstream.id
    returning m.* into v_downstream;

    select t.name into v_team1_name from public.teams t where t.id = v_downstream.team1_id;
    select t.name into v_team2_name from public.teams t where t.id = v_downstream.team2_id;
    select jsonb_agg(
      case
        when item.value->>'round' = 'R2'
          and nullif(item.value->>'match_no', '')::integer = v_downstream.match_no
        then item.value || jsonb_build_object(
          'team_a_id', coalesce(v_team1_name, ''),
          'team_b_id', coalesce(v_team2_name, ''),
          'metadata', coalesce(item.value->'metadata', '{}'::jsonb) || v_downstream.metadata
        )
        else item.value
      end
      order by item.ordinality
    ) into v_matches_payload
    from public.results r,
      jsonb_array_elements(r.payload->'matches') with ordinality item(value, ordinality)
    where r.event_id = new.event_id;

    if v_matches_payload is null then
      raise exception 'results payload second-round slot mismatch';
    end if;
    update public.results
    set payload = jsonb_set(payload, '{matches}', v_matches_payload, false),
        updated_by = coalesce(auth.uid(), updated_by),
        updated_at = now()
    where event_id = new.event_id;
  end loop;
  return new;
end;
$$;

drop trigger if exists sync_koshien_official_second_round_advancement on public.matches;
create constraint trigger sync_koshien_official_second_round_advancement
after insert or update on public.matches
deferrable initially deferred
for each row
execute function public.sync_koshien_official_second_round_advancement();

revoke all on function public.sync_koshien_official_second_round_advancement() from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
