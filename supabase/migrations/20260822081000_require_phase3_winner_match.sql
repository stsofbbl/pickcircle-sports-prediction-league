begin;

create or replace function public.koshien_phase3_points(p_event_id text, p_player_id uuid)
returns numeric
language plpgsql
stable
security invoker
set search_path = ''
as $$
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
$$;

notify pgrst, 'reload schema';

commit;
