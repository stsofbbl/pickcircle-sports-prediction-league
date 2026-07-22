begin;

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
          'finish_key', case
            when exists (
              select 1
              from public.matches m
              where m.event_id = p_event_id
                and m.status = 'completed'
                and m.round_key = 'F'
                and m.winner_team_id = t.id
            ) then 'champion'
            else coalesce((
              select case m.round_key
                when 'R1' then 'initial_loss'
                when 'R2' then case
                  when t.start_round = 2 then 'initial_loss'
                  else 'first_win_then_loss'
                end
                when 'R3' then 'best16'
                when 'QF' then 'best8'
                when 'SF' then 'best4'
                when 'F' then 'runner_up'
                else ''
              end
              from public.matches m
              where m.event_id = p_event_id
                and m.status = 'completed'
                and m.loser_team_id = t.id
              order by m.updated_at desc
              limit 1
            ), '')
          end
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

create or replace function public.recompute_koshien_phase2_score()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_formal_score numeric := 0;
  v_previous_phase2 numeric := coalesce(new.phase2_score, 0);
  v_previous_total numeric := 0;
begin
  if not exists (
    select 1
    from public.phase2_drafts d
    where d.event_id = new.event_id
      and d.status in ('drafting', 'completed', 'locked')
      and new.player_id = any (d.ordered_player_ids)
  ) then
    return new;
  end if;

  select coalesce(sum(
    case
      when exists (
        select 1
        from public.matches final_match
        where final_match.event_id = new.event_id
          and final_match.status = 'completed'
          and final_match.round_key = 'F'
          and final_match.winner_team_id = dp.team_id
      ) then 100
      else coalesce((
        select case lost_match.round_key
          when 'QF' then 20
          when 'SF' then 40
          when 'F' then 60
          else 0
        end
        from public.matches lost_match
        where lost_match.event_id = new.event_id
          and lost_match.status = 'completed'
          and lost_match.loser_team_id = dp.team_id
        order by lost_match.updated_at desc
        limit 1
      ), 0)
    end
  ), 0)
  into v_formal_score
  from public.phase2_drafts d
  join public.phase2_draft_picks dp on dp.draft_id = d.id
  where d.event_id = new.event_id
    and dp.player_id = new.player_id;

  if jsonb_typeof(coalesce(new.breakdown, '{}'::jsonb) -> 'total') = 'number' then
    v_previous_total := (new.breakdown ->> 'total')::numeric;
  else
    v_previous_total := coalesce(new.phase1_score, 0)
      + coalesce(new.revenge_score, 0)
      + v_previous_phase2
      + coalesce(new.zombie_score, 0)
      + coalesce(new.phase3_score, 0);
  end if;

  new.phase2_score := v_formal_score;
  new.breakdown := jsonb_set(coalesce(new.breakdown, '{}'::jsonb), '{phase2}', to_jsonb(v_formal_score), true);
  new.breakdown := jsonb_set(new.breakdown, '{total}', to_jsonb(v_previous_total - v_previous_phase2 + v_formal_score), true);
  return new;
end;
$$;

drop trigger if exists scores_recompute_koshien_phase2 on public.scores;
create trigger scores_recompute_koshien_phase2
before insert or update on public.scores
for each row execute function public.recompute_koshien_phase2_score();

revoke execute on function public.get_koshien_phase2_draft_state(text) from anon, public;
grant execute on function public.get_koshien_phase2_draft_state(text) to authenticated;
revoke execute on function public.recompute_koshien_phase2_score() from anon, public;

notify pgrst, 'reload schema';

commit;
