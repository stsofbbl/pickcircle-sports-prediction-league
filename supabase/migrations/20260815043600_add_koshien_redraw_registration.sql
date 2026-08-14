create or replace function public.register_koshien_official_redraw_slots(
  p_event_id text,
  p_round_key text,
  p_matches jsonb,
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
  v_previous_round text;
  v_expected_matches integer;
  v_expected_teams integer;
  v_item jsonb;
  v_match_no integer;
  v_team1_id uuid;
  v_team2_id uuid;
  v_team1_name text;
  v_team2_name text;
  v_existing public.matches;
  v_result public.results;
  v_payload jsonb;
  v_slot_index integer;
  v_slot jsonb;
  v_new_slot jsonb;
  v_metadata jsonb;
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

  if p_round_key = 'QF' then
    v_previous_round := 'R3';
    v_expected_matches := 4;
    v_expected_teams := 8;
  elsif p_round_key = 'SF' then
    v_previous_round := 'QF';
    v_expected_matches := 2;
    v_expected_teams := 4;
  else
    raise exception 'redraw round must be QF or SF';
  end if;

  if jsonb_typeof(coalesce(p_matches, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_matches) <> v_expected_matches then
    raise exception 'official redraw match count is invalid';
  end if;
  if coalesce(p_source_url, '') !~ '^https://(www\.)?jhbf\.or\.jp/sensyuken/[0-9]{4}/tournament/?$' then
    raise exception 'source URL is outside the JHBF allowlist';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_matches) item
    where item->>'round_key' is distinct from p_round_key
      or coalesce(item->>'match_no', '') !~ '^[0-9]+$'
      or coalesce(item->>'team1_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(item->>'team2_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or item->>'team1_id' = item->>'team2_id'
  ) then
    raise exception 'invalid official redraw payload';
  end if;
  if (select count(distinct (item->>'match_no')::integer) from jsonb_array_elements(p_matches) item) <> v_expected_matches
     or exists (
       select 1 from generate_series(1, v_expected_matches) expected(match_no)
       where not exists (
         select 1 from jsonb_array_elements(p_matches) item
         where (item->>'match_no')::integer = expected.match_no
       )
     ) then
    raise exception 'official redraw match numbers must be unique and complete';
  end if;
  if (
    with provided as (
      select (item->>'team1_id')::uuid team_id from jsonb_array_elements(p_matches) item
      union all
      select (item->>'team2_id')::uuid team_id from jsonb_array_elements(p_matches) item
    )
    select count(distinct team_id) from provided
  ) <> v_expected_teams then
    raise exception 'official redraw teams must be unique';
  end if;
  if (
    select count(*) from public.matches m
    where m.event_id = p_event_id
      and m.round_key = v_previous_round
      and m.status = 'completed'
      and m.winner_team_id is not null
  ) <> v_expected_teams then
    raise exception 'previous round is not fully completed';
  end if;
  if exists (
    with provided as (
      select (item->>'team1_id')::uuid team_id from jsonb_array_elements(p_matches) item
      union all
      select (item->>'team2_id')::uuid team_id from jsonb_array_elements(p_matches) item
    )
    select 1 from provided p
    where not exists (
      select 1 from public.matches m
      where m.event_id = p_event_id
        and m.round_key = v_previous_round
        and m.status = 'completed'
        and m.winner_team_id = p.team_id
    )
  ) then
    raise exception 'official redraw contains a team that did not win the previous round';
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

  for v_item in select value from jsonb_array_elements(p_matches) loop
    v_match_no := (v_item->>'match_no')::integer;
    v_team1_id := (v_item->>'team1_id')::uuid;
    v_team2_id := (v_item->>'team2_id')::uuid;
    select t.name into v_team1_name from public.teams t where t.id = v_team1_id and t.event_id = p_event_id;
    select t.name into v_team2_name from public.teams t where t.id = v_team2_id and t.event_id = p_event_id;
    if v_team1_name is null or v_team2_name is null then
      raise exception 'official redraw contains an unknown team';
    end if;

    select m.* into v_existing
    from public.matches m
    where m.event_id = p_event_id and m.round_key = p_round_key and m.match_no = v_match_no
    for update;
    if v_existing.id is not null and v_existing.status = 'completed' then
      if v_existing.team1_id is distinct from v_team1_id or v_existing.team2_id is distinct from v_team2_id then
        raise exception 'completed redraw match cannot be overwritten';
      end if;
      continue;
    end if;
    if v_existing.id is not null
       and ((v_existing.team1_id is not null and v_existing.team1_id is distinct from v_team1_id)
         or (v_existing.team2_id is not null and v_existing.team2_id is distinct from v_team2_id)) then
      raise exception 'different official redraw is already saved';
    end if;

    v_metadata := coalesce(v_existing.metadata, '{}'::jsonb) || jsonb_build_object(
      'match_id', p_round_key || '-' || v_match_no,
      'team_a_name', v_team1_name,
      'team_b_name', v_team2_name,
      'source', 'jhbf',
      'source_url', p_source_url,
      'fetched_at', coalesce(p_fetched_at, now()),
      'official_redraw', true
    );

    insert into public.matches as target (
      event_id, round_key, match_no, team1_id, team2_id,
      team1_score, team2_score, winner_team_id, loser_team_id,
      status, metadata, updated_at
    ) values (
      p_event_id, p_round_key, v_match_no, v_team1_id, v_team2_id,
      null, null, null, null, 'scheduled', v_metadata, now()
    )
    on conflict (event_id, round_key, match_no) do update set
      team1_id = excluded.team1_id,
      team2_id = excluded.team2_id,
      metadata = excluded.metadata,
      updated_at = now()
    where target.status = 'scheduled'
      and (target.team1_id is distinct from excluded.team1_id
        or target.team2_id is distinct from excluded.team2_id
        or target.metadata is distinct from excluded.metadata);
    if found then v_changed := v_changed + 1; end if;

    select (slot.ordinality - 1)::integer, slot.value
    into v_slot_index, v_slot
    from jsonb_array_elements(v_payload->'matches') with ordinality slot(value, ordinality)
    where slot.value->>'round' = p_round_key
      and nullif(slot.value->>'match_no', '')::integer = v_match_no
    limit 1;
    if v_slot_index is null then
      raise exception 'results payload redraw slot mismatch';
    end if;
    if coalesce(v_slot->>'status', 'scheduled') in ('completed', 'final') then
      if coalesce(v_slot->>'team_a_id', '') is distinct from v_team1_name
         or coalesce(v_slot->>'team_b_id', '') is distinct from v_team2_name then
        raise exception 'completed redraw payload cannot be overwritten';
      end if;
      v_slot_index := null;
      continue;
    end if;
    v_new_slot := coalesce(v_slot, '{}'::jsonb) || jsonb_build_object(
      'match_id', p_round_key || '-' || v_match_no,
      'round', p_round_key,
      'match_no', v_match_no,
      'team_a_id', v_team1_name,
      'team_b_id', v_team2_name,
      'metadata', coalesce(v_slot->'metadata', '{}'::jsonb) || v_metadata
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

  return jsonb_build_object('ok', true, 'round_key', p_round_key, 'count', v_expected_matches,
    'changed', v_changed, 'idempotent', v_changed = 0 and not v_payload_changed);
end;
$$;

revoke all on function public.register_koshien_official_redraw_slots(text, text, jsonb, text, timestamptz) from public, anon, authenticated;
grant execute on function public.register_koshien_official_redraw_slots(text, text, jsonb, text, timestamptz) to service_role;
