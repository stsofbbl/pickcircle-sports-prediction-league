-- Isolated fixture only. Production definitions read by catalog SELECT 2026-11-16.
-- Extends the existing result/reopen fixture; not a full production schema.
ALTER TABLE public.teams ADD COLUMN game_multiplier numeric DEFAULT 2;
ALTER TABLE public.teams ADD COLUMN sqrt_odds numeric DEFAULT 2;
ALTER TABLE public.teams ADD COLUMN start_round integer DEFAULT 1;
ALTER TABLE public.scores
 ALTER COLUMN phase1_score TYPE numeric, ALTER COLUMN phase2_score TYPE numeric,
 ALTER COLUMN phase3_score TYPE numeric, ALTER COLUMN revenge_score TYPE numeric,
 ALTER COLUMN zombie_score TYPE numeric;
ALTER TABLE public.phase2_drafts ADD COLUMN id uuid;
ALTER TABLE public.phase2_drafts ADD COLUMN ordered_player_ids uuid[];
CREATE TABLE public.phase1_picks(event_id text,player_id uuid,team_id uuid,captain boolean);
CREATE TABLE public.phase2_draft_picks(draft_id uuid,player_id uuid,team_id uuid);
CREATE TABLE public.revenge_picks(event_id text,player_id uuid,target_team_id uuid);
CREATE TABLE public.zombie_predictions(event_id text,team_id uuid);
CREATE TABLE public.final_score_predictions(event_id text,player_id uuid,
 predicted_score_a integer,predicted_score_b integer,
 predicted_tiebreak_score_a integer,predicted_tiebreak_score_b integer);
GRANT SELECT ON public.phase1_picks,public.phase2_drafts,public.phase2_draft_picks,
 public.revenge_picks,public.zombie_predictions,public.final_score_predictions TO authenticated;
UPDATE public.teams SET name=CASE WHEN id='10000000-0000-0000-0000-000000000001'
 THEN 'Team A' ELSE 'Team B' END WHERE event_id='save';
INSERT INTO public.phase1_picks VALUES('save','20000000-0000-0000-0000-000000000001',
 '10000000-0000-0000-0000-000000000001',true);
CREATE OR REPLACE FUNCTION public.koshien_arrival_points(p_finish text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  select case p_finish
    when 'first_win_then_loss' then 1
    when 'best16' then 1.5
    when 'best8' then 2
    when 'best4' then 2.5
    when 'runner_up' then 3.5
    when 'champion' then 5
    else 0
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.koshien_phase3_points(p_event_id text, p_player_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_score_a integer;
  v_score_b integer;
  v_used_tiebreak boolean := false;
  v_player_metric integer[];
  v_best_metric integer[];
begin
  select
    m.team1_score,
    m.team2_score,
    coalesce(
      case when jsonb_typeof(m.metadata->'used_tiebreak') = 'boolean'
        then (m.metadata->>'used_tiebreak')::boolean end,
      false
    )
  into v_score_a, v_score_b, v_used_tiebreak
  from public.matches m
  where m.event_id = p_event_id and m.round_key = 'F' and m.status = 'completed'
  order by m.match_no
  limit 1;

  if v_score_a is null or v_score_b is null then return 0; end if;

  if exists (
    select 1
    from public.final_score_predictions fsp
    where fsp.event_id = p_event_id
      and case when v_used_tiebreak then fsp.predicted_tiebreak_score_a else fsp.predicted_score_a end = v_score_a
      and case when v_used_tiebreak then fsp.predicted_tiebreak_score_b else fsp.predicted_score_b end = v_score_b
  ) then
    return case when exists (
      select 1
      from public.final_score_predictions fsp
      where fsp.event_id = p_event_id
        and fsp.player_id = p_player_id
        and case when v_used_tiebreak then fsp.predicted_tiebreak_score_a else fsp.predicted_score_a end = v_score_a
        and case when v_used_tiebreak then fsp.predicted_tiebreak_score_b else fsp.predicted_score_b end = v_score_b
    ) then 50 else 0 end;
  end if;

  select array[
    abs(x.score_a - v_score_a) + abs(x.score_b - v_score_b),
    case when sign(x.score_a - x.score_b) = sign(v_score_a - v_score_b) then 0 else 1 end,
    abs((x.score_a - x.score_b) - (v_score_a - v_score_b)),
    abs((x.score_a + x.score_b) - (v_score_a + v_score_b))
  ] into v_player_metric
  from (
    select
      fsp.player_id,
      case when v_used_tiebreak then fsp.predicted_tiebreak_score_a else fsp.predicted_score_a end as score_a,
      case when v_used_tiebreak then fsp.predicted_tiebreak_score_b else fsp.predicted_score_b end as score_b
    from public.final_score_predictions fsp
    where fsp.event_id = p_event_id and fsp.player_id = p_player_id
  ) x
  where x.score_a is not null
    and x.score_b is not null
    and sign(x.score_a - x.score_b) = sign(v_score_a - v_score_b);

  select array[
    abs(x.score_a - v_score_a) + abs(x.score_b - v_score_b),
    case when sign(x.score_a - x.score_b) = sign(v_score_a - v_score_b) then 0 else 1 end,
    abs((x.score_a - x.score_b) - (v_score_a - v_score_b)),
    abs((x.score_a + x.score_b) - (v_score_a + v_score_b))
  ] into v_best_metric
  from (
    select
      case when v_used_tiebreak then fsp.predicted_tiebreak_score_a else fsp.predicted_score_a end as score_a,
      case when v_used_tiebreak then fsp.predicted_tiebreak_score_b else fsp.predicted_score_b end as score_b
    from public.final_score_predictions fsp
    where fsp.event_id = p_event_id
  ) x
  where x.score_a is not null
    and x.score_b is not null
    and sign(x.score_a - x.score_b) = sign(v_score_a - v_score_b)
  order by 1
  limit 1;

  return case when v_player_metric = v_best_metric then 30 else 0 end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.koshien_team_current_stage(p_event_id text, p_team_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when exists (
      select 1
      from public.matches m
      where m.event_id = p_event_id
        and m.status = 'completed'
        and m.round_key = 'F'
        and m.winner_team_id = p_team_id
    ) then 'champion'
    when exists (
      select 1
      from public.matches m
      where m.event_id = p_event_id
        and m.status = 'completed'
        and m.loser_team_id = p_team_id
    ) then coalesce((
      select case m.round_key
        when 'R1' then 'initial_loss'
        when 'R2' then case when t.start_round = 2 then 'initial_loss' else 'first_win_then_loss' end
        when 'R3' then 'best16'
        when 'QF' then 'best8'
        when 'SF' then 'best4'
        when 'F' then 'runner_up'
        else ''
      end
      from public.matches m
      join public.teams t on t.id = p_team_id and t.event_id = p_event_id
      where m.event_id = p_event_id
        and m.status = 'completed'
        and m.loser_team_id = p_team_id
      order by m.updated_at desc
      limit 1
    ), '')
    else coalesce((
      select case m.round_key
        when 'R1' then 'first_win_then_loss'
        when 'R2' then 'best16'
        when 'R3' then 'best8'
        when 'QF' then 'best4'
        when 'SF' then 'best4'
        when 'F' then 'champion'
        else ''
      end
      from public.matches m
      where m.event_id = p_event_id
        and m.status = 'completed'
        and m.winner_team_id = p_team_id
      order by case m.round_key
        when 'F' then 6
        when 'SF' then 5
        when 'QF' then 4
        when 'R3' then 3
        when 'R2' then 2
        when 'R1' then 1
        else 0
      end desc,
      m.updated_at desc
      limit 1
    ), '')
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.koshien_team_finish(p_event_id text, p_team_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case
    when exists (
      select 1 from public.matches m
      where m.event_id = p_event_id and m.status = 'completed' and m.round_key = 'F' and m.winner_team_id = p_team_id
    ) then 'champion'
    else coalesce((
      select case m.round_key
        when 'R1' then 'initial_loss'
        when 'R2' then case when t.start_round = 2 then 'initial_loss' else 'first_win_then_loss' end
        when 'R3' then 'best16'
        when 'QF' then 'best8'
        when 'SF' then 'best4'
        when 'F' then 'runner_up'
        else ''
      end
      from public.matches m
      join public.teams t on t.id = p_team_id and t.event_id = p_event_id
      where m.event_id = p_event_id and m.status = 'completed' and m.loser_team_id = p_team_id
      order by m.updated_at desc limit 1
    ), '')
  end;
$function$
;
CREATE OR REPLACE FUNCTION public.recompute_koshien_current_scores()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_phase1 numeric := 0;
  v_phase2 numeric := 0;
  v_revenge numeric := 0;
  v_zombie numeric := 0;
  v_phase3 numeric := 0;
begin
  if not exists (
    select 1
    from public.events e
    where e.id = new.event_id
      and e.preset_type = 'koshien'
  ) then
    return new;
  end if;

  select coalesce(sum(
    public.koshien_arrival_points(public.koshien_team_current_stage(new.event_id, p1.team_id))
      * coalesce(t.game_multiplier, 0)
      * case when p1.captain then 1.2 else 1 end
  ), 0)
  into v_phase1
  from public.phase1_picks p1
  join public.teams t on t.id = p1.team_id and t.event_id = new.event_id
  where p1.event_id = new.event_id
    and p1.player_id = new.player_id;

  if exists (
    select 1
    from public.phase2_drafts d
    where d.event_id = new.event_id
      and d.status in ('drafting', 'completed', 'locked')
      and new.player_id = any(d.ordered_player_ids)
  ) then
    select coalesce(sum(case public.koshien_team_current_stage(new.event_id, dp.team_id)
      when 'best8' then 20
      when 'best4' then 40
      when 'runner_up' then 60
      when 'champion' then 100
      else 0
    end), 0)
    into v_phase2
    from public.phase2_drafts d
    join public.phase2_draft_picks dp on dp.draft_id = d.id
    where d.event_id = new.event_id
      and dp.player_id = new.player_id;
  end if;

  select coalesce(
    greatest(
      0,
      public.koshien_arrival_points(public.koshien_team_current_stage(new.event_id, rp.target_team_id)) - 1.5
    ) * least(t.sqrt_odds, 50),
    0
  )
  into v_revenge
  from public.revenge_picks rp
  join public.teams t on t.id = rp.target_team_id
  where rp.event_id = new.event_id
    and rp.player_id = new.player_id;

  select coalesce(sum(hit.adjustment), 0)
  into v_zombie
  from (
    select case
      when count(*) >= 2 then -40
      when count(*) = 1 then -20
      else 0
    end as adjustment
    from public.phase2_draft_picks dp
    join public.phase2_drafts d on d.id = dp.draft_id
    join public.zombie_predictions zp on zp.event_id = d.event_id and zp.team_id = dp.team_id
    where d.event_id = new.event_id
      and dp.player_id = new.player_id
      and public.koshien_team_finish(new.event_id, dp.team_id) = 'best4'
    group by dp.team_id
  ) hit;

  v_phase3 := public.koshien_phase3_points(new.event_id, new.player_id);

  new.phase1_score := coalesce(v_phase1, 0);
  new.phase2_score := coalesce(v_phase2, 0);
  new.revenge_score := coalesce(v_revenge, 0);
  new.zombie_score := coalesce(v_zombie, 0);
  new.phase3_score := coalesce(v_phase3, 0);
  new.breakdown := jsonb_set(coalesce(new.breakdown, '{}'::jsonb), '{phase1}', to_jsonb(new.phase1_score), true);
  new.breakdown := jsonb_set(new.breakdown, '{phase2}', to_jsonb(new.phase2_score), true);
  new.breakdown := jsonb_set(new.breakdown, '{revenge}', to_jsonb(new.revenge_score), true);
  new.breakdown := jsonb_set(new.breakdown, '{zombie}', to_jsonb(new.zombie_score), true);
  new.breakdown := jsonb_set(new.breakdown, '{phase3}', to_jsonb(new.phase3_score), true);
  new.breakdown := jsonb_set(new.breakdown, '{total}', to_jsonb(
    new.phase1_score + new.phase2_score + new.revenge_score + new.zombie_score + new.phase3_score
  ), true);
  new.breakdown := jsonb_set(new.breakdown, '{scoring_basis}', to_jsonb('current_stage'::text), true);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_koshien_late_round_advancement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE CONSTRAINT TRIGGER sync_koshien_late_round_advancement
 AFTER INSERT OR UPDATE ON public.matches DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION public.sync_koshien_late_round_advancement();
CREATE TRIGGER scores_recompute_koshien_current BEFORE INSERT OR UPDATE ON public.scores
 FOR EACH ROW EXECUTE FUNCTION public.recompute_koshien_current_scores();
