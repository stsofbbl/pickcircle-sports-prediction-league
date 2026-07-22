begin;

create or replace function public.koshien_team_current_stage(p_event_id text, p_team_id uuid)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
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
$$;

create or replace function public.get_koshien_phase2_draft_state(p_event_id text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_draft public.phase2_drafts;
  v_league_id uuid;
  v_viewer_player_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;

  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id;

  if v_league_id is null or not public.is_league_member(v_league_id) then
    raise exception 'league membership is required' using errcode = '42501';
  end if;

  select d.* into v_draft
  from public.phase2_drafts d
  where d.event_id = p_event_id;

  if v_draft.id is null then
    return jsonb_build_object(
      'draft', null,
      'viewer_player_id', null,
      'players', '[]'::jsonb,
      'teams', '[]'::jsonb,
      'picks', '[]'::jsonb
    );
  end if;

  select p.id into v_viewer_player_id
  from public.players p
  where p.league_id = v_league_id
    and p.profile_id = auth.uid();

  return jsonb_build_object(
    'draft', to_jsonb(v_draft),
    'viewer_player_id', v_viewer_player_id,
    'players', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'player_id', p.id,
          'profile_id', p.profile_id,
          'display_name', p.display_name
        )
        order by ordered.ordinality
      )
      from unnest(v_draft.ordered_player_ids) with ordinality as ordered(player_id, ordinality)
      join public.players p on p.id = ordered.player_id and p.league_id = v_league_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'team_id', t.id,
          'name', t.name,
          'finish_key', public.koshien_team_current_stage(p_event_id, t.id)
        )
        order by eligible.ordinality
      )
      from unnest(v_draft.eligible_team_ids) with ordinality as eligible(team_id, ordinality)
      join public.teams t on t.id = eligible.team_id and t.event_id = p_event_id
    ), '[]'::jsonb),
    'picks', coalesce((
      select jsonb_agg(to_jsonb(dp) order by dp.pick_no)
      from public.phase2_draft_picks dp
      where dp.draft_id = v_draft.id
    ), '[]'::jsonb)
  );
end;
$$;

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
      * least(coalesce(p1.sqrt_odds_snapshot, sqrt(p1.odds_snapshot), t.sqrt_odds, 1), 50)
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

drop trigger if exists scores_recompute_koshien_phase2 on public.scores;
drop trigger if exists scores_recompute_koshien_later on public.scores;
drop trigger if exists scores_recompute_koshien_current on public.scores;

create trigger scores_recompute_koshien_current
before insert or update on public.scores
for each row execute function public.recompute_koshien_current_scores();

revoke all on function public.koshien_team_current_stage(text, uuid) from anon, public;
grant execute on function public.koshien_team_current_stage(text, uuid) to authenticated;
revoke all on function public.recompute_koshien_current_scores() from anon, authenticated, public;

grant execute on function public.get_koshien_phase2_draft_state(text) to authenticated;

notify pgrst, 'reload schema';

commit;
