begin;

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
      if v_existing.status = 'canceled' then
        update public.external_match_imports
        set source_url = v_source_url,
            normalized_payload = v_payload,
            raw_payload = coalesce(v_item->'rawPayload', '{}'::jsonb),
            imported_match_id = v_imported_match_id,
            fetched_at = coalesce(nullif(v_item->>'fetchedAt', '')::timestamptz, now()),
            status = 'confirmed',
            confirmed_at = now(),
            confirmed_by = auth.uid(),
            canceled_at = null,
            canceled_by = null
        where id = v_existing.id;
        v_count := v_count + 1;
        continue;
      end if;
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

revoke all on function public.record_koshien_external_imports(text, jsonb) from public, anon;
grant execute on function public.record_koshien_external_imports(text, jsonb) to authenticated;

notify pgrst, 'reload schema';

commit;
