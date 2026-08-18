begin;

create or replace function public.prepare_koshien_zombie_phase_internal(
  p_event_id text,
  p_opens_at timestamptz,
  p_deadline_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_best4 uuid[];
  v_best4_count integer;
  v_result_version bigint;
  v_player record;
  v_own uuid[];
  v_allowed uuid[];
begin
  if p_opens_at is null or p_deadline_at is null or p_opens_at >= p_deadline_at then
    raise exception 'valid schedule is required';
  end if;
  if coalesce((select (e.rules #>> '{config,zombieEnabled}')::boolean from public.events e where e.id = p_event_id), true) is false then
    raise exception 'zombie phase is disabled for this event' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.koshien_later_rounds r
    where r.event_id = p_event_id and r.phase_key = 'zombie'
  ) then
    raise exception 'zombie phase is already prepared' using errcode = '55000';
  end if;
  if not exists (
    select 1 from public.phase2_drafts d
    where d.event_id = p_event_id and d.status in ('completed','locked')
  ) then
    raise exception 'formal phase 2 draft must be completed first';
  end if;

  select array_agg(m.winner_team_id order by m.winner_team_id), count(distinct m.winner_team_id)
  into v_best4, v_best4_count
  from public.matches m
  where m.event_id = p_event_id
    and m.round_key = 'QF'
    and m.status = 'completed'
    and m.winner_team_id is not null;

  if cardinality(v_best4) <> 4 or v_best4_count <> 4 then
    raise exception 'exactly four completed official QF winners are required';
  end if;

  v_result_version := public.koshien_result_version(p_event_id);
  insert into public.koshien_later_rounds (
    event_id, phase_key, status, opens_at, deadline_at, source_results_version, snapshot
  ) values (
    p_event_id,
    'zombie',
    'ready',
    p_opens_at,
    p_deadline_at,
    v_result_version,
    jsonb_build_object('best4_team_ids', v_best4)
  );

  for v_player in
    select unnest(d.ordered_player_ids) as player_id
    from public.phase2_drafts d
    where d.event_id = p_event_id
  loop
    select array_agg(dp.team_id order by dp.pick_no) into v_own
    from public.phase2_draft_picks dp
    join public.phase2_drafts d on d.id = dp.draft_id
    where d.event_id = p_event_id and dp.player_id = v_player.player_id;

    select coalesce(
      array_agg(dp.team_id order by dp.pick_no) filter (where dp.team_id = any(v_best4)),
      '{}'::uuid[]
    ) into v_allowed
    from public.phase2_draft_picks dp
    join public.phase2_drafts d on d.id = dp.draft_id
    where d.event_id = p_event_id and dp.player_id <> v_player.player_id;

    insert into public.koshien_zombie_eligibility (
      event_id, player_id, eligible, allowed_team_ids, source_results_version
    ) values (
      p_event_id,
      v_player.player_id,
      cardinality(v_own) = 4 and not (v_own && v_best4),
      case
        when cardinality(v_own) = 4 and not (v_own && v_best4) then v_allowed
        else '{}'::uuid[]
      end,
      v_result_version
    );
  end loop;
end;
$$;

revoke all on function public.prepare_koshien_zombie_phase_internal(text, timestamptz, timestamptz)
  from anon, authenticated, public;

create or replace function public.auto_prepare_koshien_zombie_from_sf()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_qf_winner_count integer;
  v_qf_winner_distinct_count integer;
  v_known_sf_match_count integer;
  v_deadline timestamptz;
  v_opens_at timestamptz;
begin
  if new.round_key not in ('QF', 'SF') then
    return new;
  end if;

  if exists (
    select 1 from public.koshien_later_rounds r
    where r.event_id = new.event_id and r.phase_key = 'zombie'
  ) then
    return new;
  end if;

  if not exists (
    select 1 from public.phase2_drafts d
    where d.event_id = new.event_id and d.status in ('completed','locked')
  ) then
    return new;
  end if;

  if coalesce((
    select (e.rules #>> '{config,zombieEnabled}')::boolean
    from public.events e
    where e.id = new.event_id
  ), true) is false then
    return new;
  end if;

  select count(*), count(distinct m.winner_team_id)
  into v_qf_winner_count, v_qf_winner_distinct_count
  from public.matches m
  where m.event_id = new.event_id
    and m.round_key = 'QF'
    and m.status = 'completed'
    and m.winner_team_id is not null;

  if v_qf_winner_count <> 4 or v_qf_winner_distinct_count <> 4 then
    return new;
  end if;

  select
    count(*) filter (
      where m.team1_id is not null
        and m.team2_id is not null
        and m.team1_id <> m.team2_id
        and m.starts_at is not null
    ),
    min(m.starts_at) filter (where m.starts_at is not null)
  into v_known_sf_match_count, v_deadline
  from public.matches m
  where m.event_id = new.event_id and m.round_key = 'SF';

  if v_known_sf_match_count < 1 or v_deadline is null then
    return new;
  end if;

  if exists (
    select 1
    from public.matches sf
    where sf.event_id = new.event_id
      and sf.round_key = 'SF'
      and sf.team1_id is not null
      and sf.team2_id is not null
      and (
        not exists (
          select 1 from public.matches qf
          where qf.event_id = new.event_id and qf.round_key = 'QF'
            and qf.status = 'completed' and qf.winner_team_id = sf.team1_id
        )
        or not exists (
          select 1 from public.matches qf
          where qf.event_id = new.event_id and qf.round_key = 'QF'
            and qf.status = 'completed' and qf.winner_team_id = sf.team2_id
        )
      )
  ) then
    return new;
  end if;

  v_opens_at := clock_timestamp();
  if v_deadline <= v_opens_at then
    return new;
  end if;

  perform public.prepare_koshien_zombie_phase_internal(new.event_id, v_opens_at, v_deadline);

  update public.koshien_later_rounds
  set status = 'open',
      start_mode = 'automatic',
      end_mode = 'automatic',
      updated_at = clock_timestamp(),
      version = version + 1
  where event_id = new.event_id
    and phase_key = 'zombie'
    and status = 'ready';

  return new;
end;
$$;

revoke all on function public.auto_prepare_koshien_zombie_from_sf()
  from anon, authenticated, public;

do $$
declare
  v_event record;
  v_known_sf_match_count integer;
  v_deadline timestamptz;
  v_opens_at timestamptz;
begin
  for v_event in
    select e.id
    from public.events e
    where e.preset_type = 'koshien'
      and e.archived_at is null
      and coalesce((e.rules #>> '{config,zombieEnabled}')::boolean, true)
      and exists (
        select 1 from public.phase2_drafts d
        where d.event_id = e.id and d.status in ('completed','locked')
      )
      and not exists (
        select 1 from public.koshien_later_rounds r
        where r.event_id = e.id and r.phase_key = 'zombie'
      )
      and (
        select count(distinct m.winner_team_id)
        from public.matches m
        where m.event_id = e.id
          and m.round_key = 'QF'
          and m.status = 'completed'
          and m.winner_team_id is not null
      ) = 4
  loop
    select
      count(*) filter (
        where m.team1_id is not null
          and m.team2_id is not null
          and m.team1_id <> m.team2_id
          and m.starts_at is not null
      ),
      min(m.starts_at) filter (where m.starts_at is not null)
    into v_known_sf_match_count, v_deadline
    from public.matches m
    where m.event_id = v_event.id and m.round_key = 'SF';

    v_opens_at := clock_timestamp();
    if v_known_sf_match_count >= 1 and v_deadline is not null and v_deadline > v_opens_at then
      perform public.prepare_koshien_zombie_phase_internal(v_event.id, v_opens_at, v_deadline);
      update public.koshien_later_rounds
      set status = 'open',
          start_mode = 'automatic',
          end_mode = 'automatic',
          updated_at = clock_timestamp(),
          version = version + 1
      where event_id = v_event.id
        and phase_key = 'zombie'
        and status = 'ready';
    end if;
  end loop;
end;
$$;

commit;
