begin;

alter table public.teams
  add column if not exists game_multiplier numeric(10, 4);

alter table public.teams
  add constraint teams_game_multiplier_check
  check (game_multiplier is null or (game_multiplier > 0 and game_multiplier <= 50));

create or replace function public.recompute_koshien_current_scores()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
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
$$;

create or replace function public.update_koshien_game_multipliers(
  p_event_id text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_event public.events%rowtype;
  v_team_count integer;
  v_configured_count integer;
  v_team_meta jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select e.* into v_event
  from public.events e
  where e.id = p_event_id
  for update;

  if v_event.id is null or v_event.preset_type <> 'koshien' then
    raise exception 'koshien event was not found' using errcode = 'P0002';
  end if;
  if not public.is_league_admin(v_event.league_id) then
    raise exception 'league admin is required' using errcode = '42501';
  end if;
  if v_event.status not in ('draft', 'open')
     or (v_event.prediction_deadline is not null
       and clock_timestamp() >= v_event.prediction_deadline) then
    raise exception 'game multipliers can no longer be changed' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) <> 49 then
    raise exception 'game_multiplier_count_invalid: expected 49, got %',
      case when jsonb_typeof(p_rows) = 'array' then jsonb_array_length(p_rows) else 0 end
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_to_recordset(p_rows) as x(representative_key text, game_multiplier numeric)
    where nullif(btrim(x.representative_key), '') is null
       or (x.game_multiplier is not null
         and (x.game_multiplier <= 0 or x.game_multiplier > 50))
  ) then
    raise exception 'game_multiplier_row_invalid' using errcode = '22023';
  end if;
  if (
    select count(distinct btrim(x.representative_key))
    from jsonb_to_recordset(p_rows) as x(representative_key text, game_multiplier numeric)
  ) <> 49 then
    raise exception 'game_multiplier_representative_duplicate' using errcode = '23505';
  end if;

  select count(*) into v_team_count
  from public.teams t
  where t.event_id = p_event_id
    and nullif(t.metadata ->> 'representative_key', '') is not null;

  if v_team_count <> 49
     or exists (
       select 1
       from jsonb_to_recordset(p_rows) as x(representative_key text, game_multiplier numeric)
       where not exists (
         select 1
         from public.teams t
         where t.event_id = p_event_id
           and t.metadata ->> 'representative_key' = btrim(x.representative_key)
       )
     ) then
    raise exception 'game_multiplier_representatives_do_not_match_event' using errcode = '22023';
  end if;

  update public.teams t
  set game_multiplier = x.game_multiplier,
      updated_at = now()
  from jsonb_to_recordset(p_rows) as x(representative_key text, game_multiplier numeric)
  where t.event_id = p_event_id
    and t.metadata ->> 'representative_key' = btrim(x.representative_key);

  update public.event_teams et
  set metadata = (coalesce(et.metadata, '{}'::jsonb) - 'gameMultiplier')
    || jsonb_strip_nulls(jsonb_build_object('gameMultiplier', t.game_multiplier))
  from public.teams t
  where et.event_id = p_event_id
    and t.event_id = et.event_id
    and et.metadata ->> 'representative_key' = t.metadata ->> 'representative_key';

  select jsonb_object_agg(
    t.name,
    (coalesce(v_event.rules #> array['config', 'teamMeta', t.name], '{}'::jsonb) - 'gameMultiplier')
      || jsonb_strip_nulls(jsonb_build_object('gameMultiplier', t.game_multiplier))
    order by t.seed
  )
  into v_team_meta
  from public.teams t
  where t.event_id = p_event_id;

  update public.events e
  set rules = jsonb_set(
        coalesce(e.rules, '{}'::jsonb),
        '{config}',
        coalesce(e.rules -> 'config', '{}'::jsonb)
          || jsonb_build_object('teamMeta', v_team_meta),
        true
      ),
      updated_at = now()
  where e.id = p_event_id;

  update public.scores s
  set updated_at = now()
  where s.event_id = p_event_id;

  select count(*) into v_configured_count
  from public.teams t
  where t.event_id = p_event_id
    and t.game_multiplier is not null;

  return jsonb_build_object(
    'ok', true,
    'eventId', p_event_id,
    'count', v_team_count,
    'configuredCount', v_configured_count
  );
end;
$$;

revoke all on function public.update_koshien_game_multipliers(text, jsonb) from public, anon;
grant execute on function public.update_koshien_game_multipliers(text, jsonb) to authenticated;
revoke all on function public.recompute_koshien_current_scores() from anon, authenticated, public;

notify pgrst, 'reload schema';

commit;
