-- PROTOTYPE ONLY. Requires result-write and approval-revision prototypes.
CREATE OR REPLACE FUNCTION public.cancel_koshien_match_result(p_event_id text, p_round_key text, p_match_no integer, p_results_payload jsonb, p_score_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_league_id uuid;
  v_match public.matches;
  v_score_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if p_event_id is null or p_round_key is null or p_match_no is null then
    raise exception 'event, round, and match number are required' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_results_payload, 'null'::jsonb)) <> 'object'
    or jsonb_typeof(coalesce(p_score_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'results payload must be an object and score rows must be an array' using errcode = '22023';
  end if;

  select e.league_id
  into v_league_id
  from public.events e
  where e.id = p_event_id
    and e.preset_type = 'koshien';

  if v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;

  perform yoso_approval_private.begin_result_write(p_event_id);

  select m.*
  into v_match
  from public.matches m
  where m.event_id = p_event_id
    and m.round_key = p_round_key
    and m.match_no = p_match_no
  for update;

  if v_match.id is null then
    raise exception 'completed match was not found' using errcode = 'P0002';
  end if;
  if v_match.status <> 'completed' then
    raise exception 'only a completed match can be canceled' using errcode = '55000';
  end if;

  if p_round_key in ('R1', 'R2', 'R3') and (
    exists (
      select 1 from public.phase2_drafts d
      where d.event_id = p_event_id and d.status <> 'not_ready'
    )
    or exists (
      select 1 from public.koshien_later_rounds r
      where r.event_id = p_event_id
        and r.phase_key = 'revenge'
        and r.status <> 'not_ready'
    )
  ) then
    raise exception 'downstream phase is already prepared; reset that phase before canceling this result'
      using errcode = '55000';
  end if;

  if p_round_key = 'QF' and exists (
    select 1 from public.koshien_later_rounds r
    where r.event_id = p_event_id
      and r.phase_key = 'zombie'
      and r.status <> 'not_ready'
  ) then
    raise exception 'downstream phase is already prepared; reset that phase before canceling this result'
      using errcode = '55000';
  end if;

  if p_round_key = 'SF' and exists (
    select 1 from public.koshien_later_rounds r
    where r.event_id = p_event_id
      and r.phase_key = 'phase3'
      and r.status <> 'not_ready'
  ) then
    raise exception 'downstream phase is already prepared; reset that phase before canceling this result'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_score_rows) as x(event_id text, player_id uuid)
    left join public.players p
      on p.id = x.player_id
      and p.league_id = v_league_id
    where x.event_id is distinct from p_event_id
      or p.id is null
  ) then
    raise exception 'scores payload contains an invalid event or player reference' using errcode = '22023';
  end if;

  insert into public.koshien_result_cancellations (
    event_id, round_key, match_no, previous_match, canceled_by
  )
  values (
    p_event_id,
    p_round_key,
    p_match_no,
    to_jsonb(v_match),
    auth.uid()
  );

  update public.matches
  set team1_score = null,
      team2_score = null,
      winner_team_id = null,
      loser_team_id = null,
      status = 'scheduled',
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object('canceled_at', now(), 'canceled_by', auth.uid()),
      updated_at = now()
  where id = v_match.id;

  insert into public.scores (
    event_id, player_id, phase1_score, phase2_score, phase3_score,
    revenge_score, zombie_score, breakdown, updated_at
  )
  select
    p_event_id, x.player_id, x.phase1_score, x.phase2_score, x.phase3_score,
    x.revenge_score, x.zombie_score, coalesce(x.breakdown, '{}'::jsonb), now()
  from jsonb_to_recordset(p_score_rows) as x(
    event_id text, player_id uuid, phase1_score numeric, phase2_score numeric,
    phase3_score numeric, revenge_score numeric, zombie_score numeric, breakdown jsonb
  )
  on conflict (event_id, player_id) do update set
    phase1_score = excluded.phase1_score,
    phase2_score = excluded.phase2_score,
    phase3_score = excluded.phase3_score,
    revenge_score = excluded.revenge_score,
    zombie_score = excluded.zombie_score,
    breakdown = excluded.breakdown,
    updated_at = now();
  get diagnostics v_score_count = row_count;

  insert into public.results (event_id, payload, updated_by, updated_at)
  values (p_event_id, p_results_payload, auth.uid(), now())
  on conflict (event_id) do update set
    payload = excluded.payload,
    updated_by = excluded.updated_by,
    updated_at = now();

  return jsonb_build_object(
    'event_id', p_event_id,
    'round_key', p_round_key,
    'match_no', p_match_no,
    'status', 'scheduled',
    'score_count', v_score_count
  );
end;
$function$;
