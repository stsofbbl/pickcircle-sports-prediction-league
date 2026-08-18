create or replace function public.get_koshien_later_phase_state(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_league_id uuid;
  v_player_id uuid;
begin
  select e.league_id into v_league_id
  from public.events e
  where e.id = p_event_id;

  if auth.uid() is null or v_league_id is null or not public.is_league_member(v_league_id) then
    raise exception 'league membership is required' using errcode = '42501';
  end if;

  select p.id into v_player_id
  from public.players p
  where p.league_id = v_league_id
    and p.profile_id = auth.uid();

  return jsonb_build_object(
    'event_id', p_event_id,
    'viewer_player_id', v_player_id,
    'is_admin', public.is_league_admin(v_league_id),
    'rounds', coalesce((
      select jsonb_object_agg(r.phase_key, to_jsonb(r))
      from public.koshien_later_rounds r
      where r.event_id = p_event_id
    ), '{}'::jsonb),
    'revenge', jsonb_build_object(
      'eligibility', (
        select to_jsonb(x)
        from public.koshien_revenge_eligibility x
        where x.event_id = p_event_id and x.player_id = v_player_id
      ),
      'pick', (
        select to_jsonb(x)
        from public.revenge_picks x
        where x.event_id = p_event_id and x.player_id = v_player_id
      )
    ),
    'zombie', jsonb_build_object(
      'eligibility', (
        select to_jsonb(x)
        from public.koshien_zombie_eligibility x
        where x.event_id = p_event_id and x.player_id = v_player_id
      ),
      'prediction', (
        select to_jsonb(x)
        from public.zombie_predictions x
        where x.event_id = p_event_id and x.player_id = v_player_id
      ),
      'public_predictions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_id', zp.player_id,
          'profile_id', p.profile_id,
          'display_name', p.display_name,
          'team_id', zp.team_id,
          'team_name', t.name,
          'created_at', zp.created_at,
          'updated_at', zp.updated_at
        ) order by zp.created_at, p.id)
        from public.zombie_predictions zp
        join public.players p on p.id = zp.player_id
        join public.teams t on t.id = zp.team_id and t.event_id = zp.event_id
        where zp.event_id = p_event_id
      ), '[]'::jsonb)
    ),
    'phase3', jsonb_build_object(
      'prediction', (
        select to_jsonb(x)
        from public.final_score_predictions x
        where x.event_id = p_event_id and x.player_id = v_player_id
      ),
      'predictions', case
        when exists (
          select 1
          from public.koshien_later_rounds r
          where r.event_id = p_event_id
            and r.phase_key = 'phase3'
            and r.status in ('locked', 'completed')
        ) then coalesce((
          select jsonb_agg(jsonb_build_object(
            'player_id', fsp.player_id,
            'profile_id', p.profile_id,
            'display_name', p.display_name,
            'predicted_score_a', fsp.predicted_score_a,
            'predicted_score_b', fsp.predicted_score_b
          ) order by p.id)
          from public.final_score_predictions fsp
          join public.players p on p.id = fsp.player_id
          where fsp.event_id = p_event_id
        ), '[]'::jsonb)
        else '[]'::jsonb
      end
    ),
    'official_scores', coalesce((
      select jsonb_agg(jsonb_build_object(
        'player_id', s.player_id,
        'profile_id', p.profile_id,
        'display_name', p.display_name,
        'phase1_score', s.phase1_score,
        'revenge_score', s.revenge_score,
        'phase2_score', s.phase2_score,
        'zombie_score', s.zombie_score,
        'phase3_score', s.phase3_score,
        'total_score', s.total_score,
        'breakdown', s.breakdown
      ) order by s.total_score desc, p.id)
      from public.scores s
      join public.players p on p.id = s.player_id
      where s.event_id = p_event_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object(
        'team_id', t.id,
        'name', t.name,
        'sqrt_odds', least(t.sqrt_odds, 50)
      ))
      from public.teams t
      where t.event_id = p_event_id
    ), '[]'::jsonb)
  );
end;
$function$;
