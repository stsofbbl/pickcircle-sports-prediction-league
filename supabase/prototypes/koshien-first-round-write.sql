-- PROTOTYPE ONLY: not a migration. Preserve invoker security and registration behavior.
CREATE OR REPLACE FUNCTION public.register_koshien_official_first_round_matches(p_event_id text, p_matches jsonb, p_source_url text, p_fetched_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_event public.events;
  v_result public.results;
  v_result_payload jsonb;
  v_item jsonb;
  v_slot jsonb;
  v_match_no integer;
  v_team1_id uuid;
  v_team2_id uuid;
  v_team1_name text;
  v_team2_name text;
  v_unique_team_count integer;
  v_inserted integer := 0;
  v_row_count integer := 0;
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
     or jsonb_array_length(p_matches) <> 17 then
    raise exception 'exactly 17 first-round matches are required';
  end if;
  if coalesce(p_source_url, '') !~ '^https://(www\.)?jhbf\.or\.jp/sensyuken/[0-9]{4}/tournament/?$' then
    raise exception 'source URL is outside the JHBF allowlist';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_matches) item
    where item->>'round_key' is distinct from 'R1'
      or coalesce(item->>'match_no', '') !~ '^[0-9]+$'
      or coalesce(item->>'team1_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(item->>'team2_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or item->>'team1_id' = item->>'team2_id'
  ) then
    raise exception 'invalid first-round match payload';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_matches) item
    where (item->>'match_no')::integer not between 1 and 17
  ) then
    raise exception 'invalid first-round match payload';
  end if;
  if (select count(distinct (item->>'match_no')::integer) from jsonb_array_elements(p_matches) item) <> 17
     or exists (
       select 1 from generate_series(1, 17) expected(match_no)
       where not exists (
         select 1 from jsonb_array_elements(p_matches) item
         where (item->>'match_no')::integer = expected.match_no
       )
     ) then
    raise exception 'R1-1 through R1-17 must be unique and complete';
  end if;

  with provided_teams as (
    select (item->>'team1_id')::uuid as team_id from jsonb_array_elements(p_matches) item
    union all
    select (item->>'team2_id')::uuid as team_id from jsonb_array_elements(p_matches) item
  )
  select count(distinct team_id) into v_unique_team_count from provided_teams;
  if v_unique_team_count <> 34 then
    raise exception 'count(distinct team_id) <> 34: first-round schools must be unique';
  end if;
  if exists (
    with provided_teams as (
      select (item->>'team1_id')::uuid as team_id from jsonb_array_elements(p_matches) item
      union all
      select (item->>'team2_id')::uuid as team_id from jsonb_array_elements(p_matches) item
    )
    select 1
    from provided_teams p
    left join public.teams t on t.id = p.team_id and t.event_id = p_event_id
    where t.id is null or t.start_round <> 1
  ) then
    raise exception 'team does not belong to event or is not a first-round starter';
  end if;

  -- This invoker RPC always updates results, including repeated registration.
  -- Authorize/recheck and advance once before any child row lock or write.
  perform yoso_approval_private.begin_result_write(p_event_id);

  select r.* into v_result
  from public.results r
  where r.event_id = p_event_id
  for update;
  if v_result.id is null
     or jsonb_typeof(v_result.payload) <> 'object'
     or jsonb_typeof(v_result.payload->'matches') <> 'array'
     or jsonb_array_length(v_result.payload->'matches') < 17 then
    raise exception 'results payload does not contain the first-round slots';
  end if;

  if exists (
    select 1 from public.matches m
    where m.event_id = p_event_id
      and m.round_key = 'R1'
      and m.status = 'completed'
  ) then
    raise exception 'completed first-round match cannot be overwritten';
  end if;
  if exists (
    select 1
    from public.matches m
    where m.event_id = p_event_id
      and m.round_key = 'R1'
      and (
        m.match_no not between 1 and 17
        or not exists (
          select 1
          from jsonb_array_elements(p_matches) item
          where (item->>'match_no')::integer = m.match_no
            and (item->>'team1_id')::uuid = m.team1_id
            and (item->>'team2_id')::uuid = m.team2_id
        )
      )
  ) then
    raise exception 'different first-round draw is already saved';
  end if;

  v_result_payload := v_result.payload;
  for v_item in select value from jsonb_array_elements(p_matches) loop
    v_match_no := (v_item->>'match_no')::integer;
    v_team1_id := (v_item->>'team1_id')::uuid;
    v_team2_id := (v_item->>'team2_id')::uuid;
    select t.name into v_team1_name from public.teams t where t.id = v_team1_id and t.event_id = p_event_id;
    select t.name into v_team2_name from public.teams t where t.id = v_team2_id and t.event_id = p_event_id;
    v_slot := v_result_payload->'matches'->(v_match_no - 1);
    if v_slot->>'round' is distinct from 'R1'
       or coalesce(v_slot->>'match_no', '') !~ '^[0-9]+$' then
      raise exception 'results payload first-round slot mismatch';
    end if;
    if (v_slot->>'match_no')::integer is distinct from v_match_no then
      raise exception 'results payload first-round slot mismatch';
    end if;
    if coalesce(v_slot->>'status', 'scheduled') in ('completed', 'final') then
      raise exception 'completed first-round match cannot be overwritten';
    end if;
    if (coalesce(v_slot->>'team_a_id', '') <> '' or coalesce(v_slot->>'team_b_id', '') <> '')
       and (v_slot->>'team_a_id' is distinct from v_team1_name or v_slot->>'team_b_id' is distinct from v_team2_name) then
      raise exception 'different first-round draw is already saved';
    end if;

    insert into public.matches (
      event_id, round_key, match_no, team1_id, team2_id,
      team1_score, team2_score, winner_team_id, loser_team_id,
      status, metadata, updated_at
    ) values (
      p_event_id, 'R1', v_match_no, v_team1_id, v_team2_id,
      null, null, null, null, 'scheduled',
      jsonb_build_object(
        'match_id', 'R1-' || v_match_no,
        'team_a_name', v_team1_name,
        'team_b_name', v_team2_name,
        'source', 'jhbf',
        'source_url', p_source_url,
        'fetched_at', coalesce(p_fetched_at, v_registered_at),
        'source_version', coalesce(p_fetched_at, v_registered_at)::text,
        'registered_by', auth.uid(),
        'registered_at', v_registered_at
      ),
      now()
    )
    on conflict (event_id, round_key, match_no) do nothing;
    get diagnostics v_row_count = row_count;
    v_inserted := v_inserted + v_row_count;

    v_result_payload := jsonb_set(
      v_result_payload,
      array['matches', (v_match_no - 1)::text],
      coalesce(v_slot, '{}'::jsonb) || jsonb_build_object(
        'match_id', 'R1-' || v_match_no,
        'round', 'R1',
        'match_no', v_match_no,
        'team_a_id', v_team1_name,
        'team_b_id', v_team2_name,
        'score_a', '',
        'score_b', '',
        'winner_id', '',
        'loser_id', '',
        'status', 'scheduled'
      ),
      false
    );
  end loop;

  update public.results
  set payload = v_result_payload,
      updated_by = auth.uid(),
      updated_at = now()
  where event_id = p_event_id;

  return jsonb_build_object(
    'ok', true,
    'count', 17,
    'inserted', v_inserted,
    'idempotent', v_inserted = 0
  );
end;
$function$;
REVOKE ALL ON FUNCTION public.register_koshien_official_first_round_matches(text,jsonb,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.register_koshien_official_first_round_matches(text,jsonb,text,timestamptz) TO authenticated,service_role;
