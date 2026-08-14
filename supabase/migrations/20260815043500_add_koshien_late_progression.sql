create or replace function public.sync_koshien_late_round_advancement()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_target_round text;
  v_target_match_no integer;
  v_target_side integer;
  v_team_id uuid;
  v_target public.matches;
  v_team1_name text;
  v_team2_name text;
  v_matches_payload jsonb;
begin
  if not exists (
    select 1 from public.events e
    where e.id = new.event_id and e.preset_type = 'koshien'
  ) then
    return new;
  end if;

  if new.round_key = 'R2' and new.match_no between 1 and 16 then
    v_target_round := 'R3';
    v_target_match_no := (new.match_no + 1) / 2;
    v_target_side := case when mod(new.match_no, 2) = 1 then 1 else 2 end;
  elsif new.round_key = 'SF' and new.match_no between 1 and 2 then
    v_target_round := 'F';
    v_target_match_no := 1;
    v_target_side := new.match_no;
  else
    return new;
  end if;

  v_team_id := case when new.status = 'completed' then new.winner_team_id else null end;
  if new.status = 'completed' and v_team_id is null then
    raise exception 'completed upstream match is missing winner_team_id' using errcode = '55000';
  end if;

  select m.* into v_target
  from public.matches m
  where m.event_id = new.event_id
    and m.round_key = v_target_round
    and m.match_no = v_target_match_no
  for update;

  if v_target.id is null then
    if v_team_id is null then
      return new;
    end if;
    insert into public.matches (
      event_id, round_key, match_no, team1_id, team2_id,
      team1_score, team2_score, winner_team_id, loser_team_id,
      status, metadata, updated_at
    ) values (
      new.event_id,
      v_target_round,
      v_target_match_no,
      case when v_target_side = 1 then v_team_id else null end,
      case when v_target_side = 2 then v_team_id else null end,
      null, null, null, null, 'scheduled',
      jsonb_strip_nulls(jsonb_build_object(
        'match_id', v_target_round || '-' || v_target_match_no,
        case when v_target_side = 1 then 'team1_source_round_key' else 'team2_source_round_key' end, new.round_key,
        case when v_target_side = 1 then 'team1_source_match_no' else 'team2_source_match_no' end, new.match_no,
        'progression_source', 'completed_match'
      )),
      now()
    )
    returning * into v_target;
  else
    if v_target.status = 'completed' and (
      (v_target_side = 1 and v_target.team1_id is distinct from v_team_id)
      or (v_target_side = 2 and v_target.team2_id is distinct from v_team_id)
    ) then
      raise exception 'dependent completed match exists; cancel the downstream result first' using errcode = '55000';
    end if;
    if v_team_id is not null and (
      (v_target_side = 1 and v_target.team1_id is not null and v_target.team1_id is distinct from v_team_id)
      or (v_target_side = 2 and v_target.team2_id is not null and v_target.team2_id is distinct from v_team_id)
    ) then
      raise exception 'different deterministic downstream card is already saved' using errcode = '55000';
    end if;

    update public.matches m
    set team1_id = case when v_target_side = 1 then v_team_id else v_target.team1_id end,
        team2_id = case when v_target_side = 2 then v_team_id else v_target.team2_id end,
        metadata = coalesce(v_target.metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'match_id', v_target_round || '-' || v_target_match_no,
          case when v_target_side = 1 then 'team1_source_round_key' else 'team2_source_round_key' end, new.round_key,
          case when v_target_side = 1 then 'team1_source_match_no' else 'team2_source_match_no' end, new.match_no,
          'progression_source', 'completed_match'
        )),
        updated_at = now()
    where m.id = v_target.id
    returning m.* into v_target;
  end if;

  if v_target.team1_id is not null and v_target.team1_id = v_target.team2_id then
    raise exception 'downstream card cannot contain the same team twice' using errcode = '55000';
  end if;

  select t.name into v_team1_name from public.teams t where t.id = v_target.team1_id and t.event_id = new.event_id;
  select t.name into v_team2_name from public.teams t where t.id = v_target.team2_id and t.event_id = new.event_id;

  select jsonb_agg(
    case
      when item.value->>'round' = v_target_round
        and nullif(item.value->>'match_no', '')::integer = v_target_match_no
      then item.value || jsonb_build_object(
        'match_id', v_target_round || '-' || v_target_match_no,
        'team_a_id', coalesce(v_team1_name, ''),
        'team_b_id', coalesce(v_team2_name, ''),
        'metadata', coalesce(item.value->'metadata', '{}'::jsonb) || coalesce(v_target.metadata, '{}'::jsonb)
      )
      else item.value
    end
    order by item.ordinality
  ) into v_matches_payload
  from public.results r,
    jsonb_array_elements(r.payload->'matches') with ordinality item(value, ordinality)
  where r.event_id = new.event_id;

  if v_matches_payload is not null then
    update public.results
    set payload = jsonb_set(payload, '{matches}', v_matches_payload, false),
        updated_by = coalesce(auth.uid(), updated_by),
        updated_at = now()
    where event_id = new.event_id;
  end if;
  return new;
end;
$$;

revoke all on function public.sync_koshien_late_round_advancement() from public;

DROP TRIGGER IF EXISTS sync_koshien_late_round_advancement ON public.matches;
create constraint trigger sync_koshien_late_round_advancement
after insert or update on public.matches
deferrable initially deferred
for each row execute function public.sync_koshien_late_round_advancement();


-- Backfill deterministic R3 / Final slots for the currently active Koshien event(s)
-- without touching completed downstream matches.
update public.matches m
set updated_at = m.updated_at
where m.round_key in ('R2', 'SF')
  and m.status = 'completed'
  and exists (
    select 1 from public.events e
    where e.id = m.event_id
      and e.preset_type = 'koshien'
      and e.archived_at is null
  );
