-- Isolated fixture only. Unmodified production definitions read 2026-11-16.
CREATE OR REPLACE FUNCTION public.protect_completed_koshien_downstream_result()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.protect_koshien_opened_later_results()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_initial_completion boolean;
begin
  v_initial_completion := (
    old.status = 'scheduled'
    and new.status = 'completed'
    and old.team1_id is not distinct from new.team1_id
    and old.team2_id is not distinct from new.team2_id
    and old.team1_score is null
    and old.team2_score is null
    and old.winner_team_id is null
    and old.loser_team_id is null
    and new.team1_score is not null
    and new.team2_score is not null
    and new.team1_score >= 0
    and new.team2_score >= 0
    and new.team1_score <> new.team2_score
    and new.winner_team_id = case
      when new.team1_score > new.team2_score then new.team1_id
      else new.team2_id
    end
    and new.loser_team_id = case
      when new.team1_score > new.team2_score then new.team2_id
      else new.team1_id
    end
  );

  if not v_initial_completion and (
    (old.winner_team_id, old.loser_team_id) is distinct from (new.winner_team_id, new.loser_team_id)
    or (
      (old.team1_id, old.team2_id) is distinct from (new.team1_id, new.team2_id)
      and not (
        old.status = 'scheduled' and new.status = 'scheduled'
        and old.winner_team_id is null and new.winner_team_id is null
        and old.loser_team_id is null and new.loser_team_id is null
      )
    )
  ) and (
    exists (
      select 1
      from public.koshien_later_rounds r
      where r.event_id = old.event_id
        and r.status in ('open', 'locked', 'completed')
    )
    or exists (
      select 1
      from public.phase2_drafts d
      where d.event_id = old.event_id
        and d.status in ('drafting', 'completed', 'locked')
    )
  ) then
    raise exception 'winner-changing result corrections are locked after a later phase opens'
      using errcode = '55000';
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_koshien_official_second_round_advancement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE TRIGGER matches_protect_koshien_opened_later_results BEFORE UPDATE ON public.matches
 FOR EACH ROW EXECUTE FUNCTION public.protect_koshien_opened_later_results();
CREATE TRIGGER protect_completed_koshien_downstream_result BEFORE UPDATE OF status ON public.matches
 FOR EACH ROW EXECUTE FUNCTION public.protect_completed_koshien_downstream_result();
CREATE CONSTRAINT TRIGGER sync_koshien_official_second_round_advancement
 AFTER INSERT OR UPDATE ON public.matches DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION public.sync_koshien_official_second_round_advancement();
