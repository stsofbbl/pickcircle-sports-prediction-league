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
      with available_matches as (
        select
          m.id as match_id,
          m.round_key,
          m.match_no,
          m.team1_id,
          m.team2_id,
          t1.name as team1_name,
          t2.name as team2_name,
          m.team1_score,
          m.team2_score,
          m.winner_team_id,
          m.status
        from public.matches m
        left join public.teams t1 on t1.id = m.team1_id
        left join public.teams t2 on t2.id = m.team2_id
        where m.event_id = p_event_id

        union all

        select
          null::uuid as match_id,
          x.item->>'round' as round_key,
          (x.item->>'match_no')::integer as match_no,
          t1.id as team1_id,
          t2.id as team2_id,
          t1.name as team1_name,
          t2.name as team2_name,
          case when coalesce(x.item->>'score_a', '') ~ '^[0-9]+$' then (x.item->>'score_a')::integer end as team1_score,
          case when coalesce(x.item->>'score_b', '') ~ '^[0-9]+$' then (x.item->>'score_b')::integer end as team2_score,
          tw.id as winner_team_id,
          case when x.item->>'status' = 'completed' then 'completed' else 'scheduled' end as status
        from public.results r
        cross join lateral jsonb_array_elements(coalesce(r.payload->'matches', '[]'::jsonb)) x(item)
        left join public.teams t1 on t1.event_id = p_event_id and t1.name = x.item->>'team_a_id'
        left join public.teams t2 on t2.event_id = p_event_id and t2.name = x.item->>'team_b_id'
        left join public.teams tw on tw.event_id = p_event_id and tw.name = x.item->>'winner_id'
        where r.event_id = p_event_id
          and coalesce(x.item->>'round', '') in ('R1','R2','R3','QF','SF','F')
          and coalesce(x.item->>'match_no', '') ~ '^[1-9][0-9]*$'
          and t1.id is not null
          and t2.id is not null
          and not exists (
            select 1 from public.matches m
            where m.event_id = p_event_id
              and m.round_key = x.item->>'round'
              and m.match_no = (x.item->>'match_no')::integer
          )
      )
      select jsonb_agg(jsonb_build_object(
        'matchId', a.match_id,
        'roundKey', a.round_key,
        'matchNo', a.match_no,
        'team1Id', a.team1_id,
        'team2Id', a.team2_id,
        'team1Name', a.team1_name,
        'team2Name', a.team2_name,
        'team1Score', a.team1_score,
        'team2Score', a.team2_score,
        'winnerTeamId', a.winner_team_id,
        'status', a.status
      ) order by case a.round_key
        when 'R1' then 1 when 'R2' then 2 when 'R3' then 3
        when 'QF' then 4 when 'SF' then 5 when 'F' then 6 else 99 end,
        a.match_no)
      from available_matches a
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.get_koshien_external_import_context(text) from public, anon;
grant execute on function public.get_koshien_external_import_context(text) to authenticated;

notify pgrst, 'reload schema';
commit;
