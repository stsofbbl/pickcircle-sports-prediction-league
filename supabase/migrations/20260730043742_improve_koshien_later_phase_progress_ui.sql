begin;

alter table public.koshien_later_rounds
  add column if not exists start_mode text not null default 'automatic'
    check (start_mode in ('manual', 'automatic')),
  add column if not exists end_mode text not null default 'automatic'
    check (end_mode in ('manual', 'automatic'));

create table if not exists public.koshien_later_prediction_requests (
  event_id text not null references public.events(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  phase_key text not null check (phase_key in ('revenge', 'zombie', 'phase3')),
  request_id uuid not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (event_id, player_id, phase_key, request_id)
);

alter table public.koshien_later_prediction_requests enable row level security;

create or replace function public.validate_koshien_phase2_draft_setup()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_player_count integer;
  v_team_count integer;
  v_pick_count integer;
  v_schedule_managed boolean := coalesce(current_setting('yoso.phase2_rpc', true), '') = 'manage_schedule';
begin
  if tg_op = 'INSERT' and new.status <> 'not_ready' then
    raise exception 'phase 2 draft must be inserted as not_ready';
  end if;

  select count(*) into v_pick_count
  from public.phase2_draft_picks dp
  where dp.draft_id = new.id;

  if new.status <> 'not_ready' then
    select e.league_id into v_league_id
    from public.events e
    where e.id = new.event_id;

    if v_league_id is null then
      raise exception 'phase 2 draft event is not found';
    end if;

    select count(*) into v_player_count
    from public.players p
    where p.league_id = v_league_id
      and p.id = any (new.ordered_player_ids)
      and p.profile_id is not null;

    select count(*) into v_team_count
    from public.teams t
    where t.event_id = new.event_id
      and t.id = any (new.eligible_team_ids);

    if v_player_count <> 4 then
      raise exception 'ordered_player_ids must reference four authenticated players in the event league';
    end if;
    if v_team_count <> 16 then
      raise exception 'eligible_team_ids must reference sixteen teams in the draft event';
    end if;
    if public.koshien_phase2_ranking_snapshot_is_valid(new.ranking_snapshot, new.ordered_player_ids) is not true then
      raise exception 'ranking_snapshot must contain four scored players, resolved ranks, tie draws, and the fixed order';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    new.version := old.version + 1;

    if old.status is distinct from new.status and not (
      (old.status = 'not_ready' and new.status = 'ready')
      or (old.status = 'ready' and new.status = 'drafting')
      or (old.status = 'drafting' and new.status = 'completed')
      or (old.status = 'completed' and new.status = 'locked')
    ) then
      raise exception 'invalid phase 2 draft status transition from % to %', old.status, new.status;
    end if;

    if old.status = 'ready' and new.status = 'drafting' and clock_timestamp() < new.starts_at then
      raise exception 'phase 2 draft cannot start before starts_at';
    end if;

    if old.status <> 'not_ready' and (
      old.event_id is distinct from new.event_id
      or old.ordered_player_ids is distinct from new.ordered_player_ids
      or old.ranking_snapshot is distinct from new.ranking_snapshot
      or old.eligible_team_ids is distinct from new.eligible_team_ids
      or (
        not v_schedule_managed
        and (
          old.starts_at is distinct from new.starts_at
          or old.deadline_at is distinct from new.deadline_at
        )
      )
    ) then
      raise exception 'cannot change fixed phase 2 draft setup after ready';
    end if;
  end if;

  if new.status in ('not_ready', 'ready') and (v_pick_count <> 0 or new.current_pick_no <> 1) then
    raise exception 'not_ready or ready phase 2 draft cannot contain picks';
  end if;
  if new.status = 'drafting' and (
    v_pick_count not between 0 and 15
    or new.current_pick_no <> v_pick_count + 1
  ) then
    raise exception 'drafting phase 2 draft current_pick_no must follow persisted picks';
  end if;
  if new.status in ('completed', 'locked') and (v_pick_count <> 16 or new.current_pick_no <> 16) then
    raise exception 'completed phase 2 draft requires exactly sixteen picks';
  end if;

  return new;
end;
$$;

create or replace function public.prepare_koshien_later_phase(
  p_event_id text,
  p_phase_key text,
  p_opens_at timestamptz,
  p_deadline_at timestamptz,
  p_start_mode text,
  p_end_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_round_key text;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if p_phase_key not in ('best16', 'zombie', 'phase3')
    or p_start_mode not in ('manual', 'automatic')
    or p_end_mode not in ('manual', 'automatic') then
    raise exception 'unsupported later phase schedule';
  end if;
  if p_opens_at is null or p_deadline_at is null or p_opens_at >= p_deadline_at then
    raise exception 'valid opens_at and deadline_at are required';
  end if;

  if p_phase_key = 'best16' then
    perform public.prepare_koshien_best16_phases(p_event_id, p_opens_at, p_deadline_at);
    v_round_key := 'revenge';
  elsif p_phase_key = 'zombie' then
    perform public.prepare_koshien_zombie_phase(p_event_id, p_opens_at, p_deadline_at);
    v_round_key := 'zombie';
  else
    perform public.prepare_koshien_phase3(p_event_id, p_opens_at, p_deadline_at);
    v_round_key := 'phase3';
  end if;

  update public.koshien_later_rounds
  set start_mode = p_start_mode,
      end_mode = p_end_mode,
      updated_at = clock_timestamp(),
      version = version + 1
  where event_id = p_event_id and phase_key = v_round_key;

  if p_phase_key = 'best16' then
    perform set_config('yoso.phase2_rpc', 'manage_schedule', true);
    update public.phase2_drafts
    set starts_at = case when p_start_mode = 'manual' then '-infinity'::timestamptz else p_opens_at end,
        deadline_at = case when p_end_mode = 'manual' then 'infinity'::timestamptz else p_deadline_at end
    where event_id = p_event_id and status = 'ready';
  end if;

  return public.get_koshien_later_phase_state(p_event_id);
end;
$$;

create or replace function public.update_koshien_later_phase_schedule(
  p_event_id text,
  p_phase_key text,
  p_opens_at timestamptz,
  p_deadline_at timestamptz,
  p_start_mode text,
  p_end_mode text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_round_key text := case when p_phase_key = 'best16' then 'revenge' else p_phase_key end;
  v_round public.koshien_later_rounds;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if p_phase_key not in ('best16', 'zombie', 'phase3')
    or p_start_mode not in ('manual', 'automatic')
    or p_end_mode not in ('manual', 'automatic') then
    raise exception 'unsupported later phase schedule';
  end if;
  if p_opens_at is null or p_deadline_at is null or p_opens_at >= p_deadline_at then
    raise exception 'valid opens_at and deadline_at are required';
  end if;

  select r.* into v_round
  from public.koshien_later_rounds r
  where r.event_id = p_event_id and r.phase_key = v_round_key
  for update;

  if v_round.id is null or v_round.status not in ('ready', 'open') then
    raise exception 'later phase schedule cannot be changed now' using errcode = '55000';
  end if;
  if v_round.status = 'open'
    and (
      p_opens_at is distinct from v_round.opens_at
      or p_start_mode is distinct from v_round.start_mode
      or p_end_mode is distinct from v_round.end_mode
    ) then
    raise exception 'only the deadline can be changed while reception is open' using errcode = '55000';
  end if;

  update public.koshien_later_rounds
  set opens_at = p_opens_at,
      deadline_at = p_deadline_at,
      start_mode = p_start_mode,
      end_mode = p_end_mode,
      status = case
        when p_end_mode = 'automatic'
          and p_deadline_at <= clock_timestamp()
          and (
            p_phase_key <> 'best16'
            or exists (
              select 1 from public.phase2_drafts d
              where d.event_id = p_event_id and d.status in ('completed', 'locked')
            )
          ) then 'locked'
        else status
      end,
      locked_at = case
        when p_end_mode = 'automatic'
          and p_deadline_at <= clock_timestamp()
          and (
            p_phase_key <> 'best16'
            or exists (
              select 1 from public.phase2_drafts d
              where d.event_id = p_event_id and d.status in ('completed', 'locked')
            )
          ) then clock_timestamp()
        else locked_at
      end,
      updated_at = clock_timestamp(),
      version = version + 1
  where id = v_round.id;

  if p_phase_key = 'best16' then
    perform set_config('yoso.phase2_rpc', 'manage_schedule', true);
    update public.phase2_drafts
    set starts_at = case
          when status = 'ready' and p_start_mode = 'manual' then '-infinity'::timestamptz
          when status = 'ready' then p_opens_at
          else starts_at
        end,
        deadline_at = case when p_end_mode = 'manual' then 'infinity'::timestamptz else p_deadline_at end,
        status = case when status = 'completed' and p_end_mode = 'automatic'
          and p_deadline_at <= clock_timestamp() then 'locked' else status end
    where event_id = p_event_id and status in ('ready', 'drafting', 'completed');
  end if;

  return public.get_koshien_later_phase_state(p_event_id);
end;
$$;

create or replace function public.refresh_koshien_phase_schedule(p_event_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_id uuid;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_member(v_league_id) then
    raise exception 'league membership is required' using errcode = '42501';
  end if;

  update public.koshien_later_rounds
  set status = 'open', updated_at = clock_timestamp(), version = version + 1
  where event_id = p_event_id
    and status = 'ready'
    and start_mode = 'automatic'
    and opens_at <= clock_timestamp()
    and (end_mode = 'manual' or deadline_at > clock_timestamp());

  update public.koshien_later_rounds
  set status = 'locked', locked_at = clock_timestamp(),
      updated_at = clock_timestamp(), version = version + 1
  where event_id = p_event_id
    and status in ('ready', 'open')
    and end_mode = 'automatic'
    and deadline_at <= clock_timestamp()
    and (
      phase_key <> 'revenge'
      or exists (
        select 1 from public.phase2_drafts d
        where d.event_id = p_event_id and d.status in ('completed', 'locked')
      )
    );

  perform set_config('yoso.phase2_rpc', 'manage_schedule', true);
  update public.phase2_drafts d
  set status = 'drafting'
  from public.koshien_later_rounds r
  where d.event_id = p_event_id
    and r.event_id = d.event_id
    and r.phase_key = 'revenge'
    and r.status = 'open'
    and d.status = 'ready';

  update public.phase2_drafts d
  set deadline_at = least(d.deadline_at, clock_timestamp()),
      status = case when d.status = 'completed' then 'locked' else d.status end
  from public.koshien_later_rounds r
  where d.event_id = p_event_id
    and r.event_id = d.event_id
    and r.phase_key = 'revenge'
    and r.status = 'locked'
    and d.status in ('ready', 'drafting', 'completed');
end;
$$;

create or replace function public.set_koshien_later_phase_status(
  p_event_id text,
  p_phase_key text,
  p_action text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_id uuid;
  v_round_key text := case when p_phase_key = 'best16' then 'revenge' else p_phase_key end;
  v_round public.koshien_later_rounds;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if p_phase_key not in ('best16', 'zombie', 'phase3') or p_action not in ('open', 'lock') then
    raise exception 'unsupported later phase action';
  end if;

  select r.* into v_round
  from public.koshien_later_rounds r
  where r.event_id = p_event_id and r.phase_key = v_round_key
  for update;

  if v_round.id is null then
    raise exception 'later phase is not prepared' using errcode = '55000';
  end if;

  if p_action = 'open' then
    if v_round.status <> 'ready' then
      raise exception 'later phase is not waiting to open' using errcode = '55000';
    end if;
    if v_round.end_mode = 'automatic' and clock_timestamp() >= v_round.deadline_at then
      raise exception 'later phase deadline has passed' using errcode = '55000';
    end if;

    update public.koshien_later_rounds
    set status = 'open', start_mode = 'manual', opens_at = clock_timestamp(),
        updated_at = clock_timestamp(), version = version + 1
    where id = v_round.id;

    if p_phase_key = 'best16' then
      perform set_config('yoso.phase2_rpc', 'manage_schedule', true);
      update public.phase2_drafts
      set starts_at = '-infinity'::timestamptz, status = 'drafting'
      where event_id = p_event_id and status = 'ready';
    end if;
  else
    if v_round.status not in ('ready', 'open') then
      raise exception 'later phase is already closed' using errcode = '55000';
    end if;
    if p_phase_key = 'best16' and not exists (
      select 1 from public.phase2_drafts d
      where d.event_id = p_event_id and d.status in ('completed', 'locked')
    ) then
      raise exception 'formal phase 2 draft must be completed before lock' using errcode = '55000';
    end if;

    update public.koshien_later_rounds
    set status = 'locked', end_mode = 'manual', deadline_at = clock_timestamp(),
        locked_at = clock_timestamp(), updated_at = clock_timestamp(), version = version + 1
    where id = v_round.id;

    if p_phase_key = 'best16' then
      perform set_config('yoso.phase2_rpc', 'manage_schedule', true);
      update public.phase2_drafts
      set deadline_at = clock_timestamp(),
          status = case when status = 'completed' then 'locked' else status end
      where event_id = p_event_id and status in ('ready', 'drafting', 'completed');
    end if;
  end if;

  return public.get_koshien_later_phase_state(p_event_id);
end;
$$;

create or replace function public.get_koshien_later_phase_admin_progress(p_event_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league_id uuid;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'readiness', jsonb_build_object(
      'best16', (
        select count(distinct candidate.team_id) = 16
        from (
          select m.team1_id as team_id from public.matches m
          where m.event_id = p_event_id and m.round_key = 'R3' and m.team1_id is not null
          union
          select m.team2_id from public.matches m
          where m.event_id = p_event_id and m.round_key = 'R3' and m.team2_id is not null
        ) candidate
      ) and (
        select count(*) = 4
        from public.players p
        where p.league_id = v_league_id and p.profile_id is not null
          and (select count(*) from public.phase1_picks p1 where p1.event_id = p_event_id and p1.player_id = p.id) = 8
      ),
      'zombie', (
        select count(distinct candidate.team_id) = 4
        from (
          select m.team1_id as team_id from public.matches m
          where m.event_id = p_event_id and m.round_key = 'SF' and m.team1_id is not null
          union
          select m.team2_id from public.matches m
          where m.event_id = p_event_id and m.round_key = 'SF' and m.team2_id is not null
        ) candidate
      ) and exists (
        select 1 from public.phase2_drafts d
        where d.event_id = p_event_id and d.status in ('completed', 'locked')
      ),
      'phase3', exists (
        select 1 from public.matches m
        where m.event_id = p_event_id and m.round_key = 'F'
          and m.team1_id is not null and m.team2_id is not null and m.team1_id <> m.team2_id
      )
    ),
    'best16', jsonb_build_object(
      'participant_count', coalesce((select cardinality(d.ordered_player_ids) from public.phase2_drafts d where d.event_id = p_event_id), 0),
      'submitted_count', (
        select count(*) from (
          select dp.player_id
          from public.phase2_draft_picks dp
          join public.phase2_drafts d on d.id = dp.draft_id
          where d.event_id = p_event_id
          group by dp.player_id having count(*) = 4
        ) submitted
      ),
      'details', coalesce((
        select jsonb_agg(to_jsonb(detail) order by detail.order_no)
        from (
          select ordered.ordinality as order_no, p.id as player_id, p.display_name,
            count(dp.id) = 4 as submitted,
            coalesce(jsonb_agg(t.name order by dp.pick_no) filter (where dp.id is not null), '[]'::jsonb) as selections
          from public.phase2_drafts d
          cross join unnest(d.ordered_player_ids) with ordinality as ordered(player_id, ordinality)
          join public.players p on p.id = ordered.player_id
          left join public.phase2_draft_picks dp on dp.draft_id = d.id and dp.player_id = p.id
          left join public.teams t on t.id = dp.team_id
          where d.event_id = p_event_id
          group by ordered.ordinality, p.id, p.display_name
        ) detail
      ), '[]'::jsonb),
      'revenge_details', coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_id', p.id,
          'display_name', p.display_name,
          'submitted', rp.id is not null,
          'selection', t.name
        ) order by p.display_name)
        from public.koshien_revenge_eligibility re
        join public.players p on p.id = re.player_id
        left join public.revenge_picks rp on rp.event_id = re.event_id and rp.player_id = re.player_id
        left join public.teams t on t.id = rp.target_team_id
        where re.event_id = p_event_id and re.eligible
      ), '[]'::jsonb)
    ),
    'zombie', jsonb_build_object(
      'participant_count', (select count(*) from public.koshien_zombie_eligibility ze where ze.event_id = p_event_id and ze.eligible),
      'submitted_count', (
        select count(*) from public.koshien_zombie_eligibility ze
        join public.zombie_predictions zp on zp.event_id = ze.event_id and zp.player_id = ze.player_id
        where ze.event_id = p_event_id and ze.eligible
      ),
      'details', coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_id', p.id,
          'display_name', p.display_name,
          'submitted', zp.id is not null,
          'selection', t.name
        ) order by p.display_name)
        from public.koshien_zombie_eligibility ze
        join public.players p on p.id = ze.player_id
        left join public.zombie_predictions zp on zp.event_id = ze.event_id and zp.player_id = ze.player_id
        left join public.teams t on t.id = zp.team_id
        where ze.event_id = p_event_id and ze.eligible
      ), '[]'::jsonb)
    ),
    'phase3', jsonb_build_object(
      'participant_count', (
        select count(*) from public.players p
        where p.league_id = v_league_id and p.profile_id is not null
          and (select count(*) from public.phase1_picks p1 where p1.event_id = p_event_id and p1.player_id = p.id) = 8
      ),
      'submitted_count', (
        select count(*) from public.final_score_predictions fsp
        join public.players p on p.id = fsp.player_id
        where fsp.event_id = p_event_id and p.league_id = v_league_id
      ),
      'details', coalesce((
        select jsonb_agg(jsonb_build_object(
          'player_id', p.id,
          'display_name', p.display_name,
          'submitted', fsp.id is not null,
          'selection', case when fsp.id is null then null else fsp.predicted_score_a::text || ' - ' || fsp.predicted_score_b::text end
        ) order by p.display_name)
        from public.players p
        left join public.final_score_predictions fsp on fsp.event_id = p_event_id and fsp.player_id = p.id
        where p.league_id = v_league_id and p.profile_id is not null
          and (select count(*) from public.phase1_picks p1 where p1.event_id = p_event_id and p1.player_id = p.id) = 8
      ), '[]'::jsonb)
    )
  );
end;
$$;

create or replace function public.save_koshien_revenge_pick(p_event_id text, p_target_team_id uuid, p_expected_version bigint, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_round public.koshien_later_rounds;
  v_player_id uuid;
  v_allowed uuid[];
  v_existing public.revenge_picks;
  v_request_payload jsonb := jsonb_build_object('target_team_id', p_target_team_id);
  v_previous_payload jsonb;
begin
  select r.* into v_round from public.koshien_later_rounds r where r.event_id=p_event_id and r.phase_key='revenge' for update;
  if auth.uid() is null or v_round.id is null then raise exception 'revenge round is unavailable' using errcode='42501'; end if;
  select p.id into v_player_id from public.players p join public.events e on e.league_id=p.league_id where e.id=p_event_id and p.profile_id=auth.uid();
  if v_player_id is null then raise exception 'event player is required' using errcode='42501'; end if;
  select h.payload into v_previous_payload from public.koshien_later_prediction_requests h
  where h.event_id=p_event_id and h.player_id=v_player_id and h.phase_key='revenge' and h.request_id=p_request_id;
  if v_previous_payload is not null then
    if v_previous_payload is distinct from v_request_payload then raise exception 'request_id payload conflict' using errcode='23505'; end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;
  select x.* into v_existing from public.revenge_picks x where x.event_id=p_event_id and x.player_id=v_player_id;
  if v_existing.request_id=p_request_id then
    if v_existing.target_team_id is distinct from p_target_team_id then raise exception 'request_id payload conflict' using errcode='23505'; end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;
  if v_round.status <> 'open' or clock_timestamp() < v_round.opens_at
    or (v_round.end_mode = 'automatic' and clock_timestamp() >= v_round.deadline_at)
    then raise exception 'revenge round is closed' using errcode='55000'; end if;
  if v_round.version <> p_expected_version then raise exception 'revenge version conflict' using errcode='40001'; end if;
  select x.allowed_team_ids into v_allowed from public.koshien_revenge_eligibility x where x.event_id=p_event_id and x.player_id=v_player_id and x.eligible;
  if v_allowed is null or not (p_target_team_id=any(v_allowed)) then raise exception 'revenge team is not allowed' using errcode='42501'; end if;
  insert into public.koshien_later_prediction_requests(event_id,player_id,phase_key,request_id,payload)
  values(p_event_id,v_player_id,'revenge',p_request_id,v_request_payload);
  insert into public.revenge_picks(event_id,player_id,target_team_id,request_id,payload)
  values(p_event_id,v_player_id,p_target_team_id,p_request_id,jsonb_build_object('round_version',v_round.version))
  on conflict(event_id,player_id) do update set target_team_id=excluded.target_team_id,request_id=excluded.request_id,payload=excluded.payload,updated_at=now();
  return public.get_koshien_later_phase_state(p_event_id);
end $$;

create or replace function public.save_koshien_zombie_prediction(p_event_id text, p_target_team_id uuid, p_expected_version bigint, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_round public.koshien_later_rounds;
  v_player_id uuid;
  v_allowed uuid[];
  v_existing public.zombie_predictions;
  v_request_payload jsonb := jsonb_build_object('target_team_id', p_target_team_id);
  v_previous_payload jsonb;
begin
  select r.* into v_round from public.koshien_later_rounds r where r.event_id=p_event_id and r.phase_key='zombie' for update;
  if auth.uid() is null or v_round.id is null then raise exception 'zombie round is unavailable' using errcode='42501'; end if;
  select p.id into v_player_id from public.players p join public.events e on e.league_id=p.league_id where e.id=p_event_id and p.profile_id=auth.uid();
  if v_player_id is null then raise exception 'event player is required' using errcode='42501'; end if;
  select h.payload into v_previous_payload from public.koshien_later_prediction_requests h
  where h.event_id=p_event_id and h.player_id=v_player_id and h.phase_key='zombie' and h.request_id=p_request_id;
  if v_previous_payload is not null then
    if v_previous_payload is distinct from v_request_payload then raise exception 'request_id payload conflict' using errcode='23505'; end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;
  select x.* into v_existing from public.zombie_predictions x where x.event_id=p_event_id and x.player_id=v_player_id;
  if v_existing.request_id=p_request_id then
    if v_existing.team_id is distinct from p_target_team_id then raise exception 'request_id payload conflict' using errcode='23505'; end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;
  if v_round.status <> 'open' or clock_timestamp() < v_round.opens_at
    or (v_round.end_mode = 'automatic' and clock_timestamp() >= v_round.deadline_at)
    then raise exception 'zombie round is closed' using errcode='55000'; end if;
  if v_round.version <> p_expected_version then raise exception 'zombie version conflict' using errcode='40001'; end if;
  select x.allowed_team_ids into v_allowed from public.koshien_zombie_eligibility x where x.event_id=p_event_id and x.player_id=v_player_id and x.eligible;
  if v_allowed is null or not (p_target_team_id=any(v_allowed)) then raise exception 'zombie team is not allowed' using errcode='42501'; end if;
  insert into public.koshien_later_prediction_requests(event_id,player_id,phase_key,request_id,payload)
  values(p_event_id,v_player_id,'zombie',p_request_id,v_request_payload);
  insert into public.zombie_predictions(event_id,player_id,team_id,request_id,payload)
  values(p_event_id,v_player_id,p_target_team_id,p_request_id,jsonb_build_object('round_version',v_round.version))
  on conflict(event_id,player_id) do update set team_id=excluded.team_id,request_id=excluded.request_id,payload=excluded.payload,updated_at=now();
  return public.get_koshien_later_phase_state(p_event_id);
end $$;

create or replace function public.save_koshien_phase3_prediction(p_event_id text, p_score_a integer, p_score_b integer, p_expected_version bigint, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_round public.koshien_later_rounds;
  v_player_id uuid;
  v_existing public.final_score_predictions;
  v_request_payload jsonb := jsonb_build_object('score_a', p_score_a, 'score_b', p_score_b);
  v_previous_payload jsonb;
begin
  select r.* into v_round from public.koshien_later_rounds r where r.event_id=p_event_id and r.phase_key='phase3' for update;
  if auth.uid() is null or v_round.id is null then raise exception 'phase 3 round is unavailable' using errcode='42501'; end if;
  select p.id into v_player_id from public.players p join public.events e on e.league_id=p.league_id where e.id=p_event_id and p.profile_id=auth.uid();
  if v_player_id is null then raise exception 'event player is required' using errcode='42501'; end if;
  select h.payload into v_previous_payload from public.koshien_later_prediction_requests h
  where h.event_id=p_event_id and h.player_id=v_player_id and h.phase_key='phase3' and h.request_id=p_request_id;
  if v_previous_payload is not null then
    if v_previous_payload is distinct from v_request_payload then raise exception 'request_id payload conflict' using errcode='23505'; end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;
  select x.* into v_existing from public.final_score_predictions x where x.event_id=p_event_id and x.player_id=v_player_id;
  if v_existing.request_id=p_request_id then
    if v_existing.predicted_score_a is distinct from p_score_a or v_existing.predicted_score_b is distinct from p_score_b then raise exception 'request_id payload conflict' using errcode='23505'; end if;
    return public.get_koshien_later_phase_state(p_event_id);
  end if;
  if v_round.status <> 'open' or clock_timestamp() < v_round.opens_at
    or (v_round.end_mode = 'automatic' and clock_timestamp() >= v_round.deadline_at)
    then raise exception 'phase 3 round is closed' using errcode='55000'; end if;
  if v_round.version <> p_expected_version then raise exception 'phase 3 version conflict' using errcode='40001'; end if;
  if p_score_a is null or p_score_b is null or p_score_a < 0 or p_score_b < 0 or p_score_a=p_score_b then raise exception 'valid non-tied scores are required'; end if;
  insert into public.koshien_later_prediction_requests(event_id,player_id,phase_key,request_id,payload)
  values(p_event_id,v_player_id,'phase3',p_request_id,v_request_payload);
  insert into public.final_score_predictions(event_id,player_id,champion_team_id,runner_up_team_id,predicted_score_a,predicted_score_b,request_id)
  values(p_event_id,v_player_id,v_round.team_a_id,v_round.team_b_id,p_score_a,p_score_b,p_request_id)
  on conflict(event_id,player_id) do update set champion_team_id=excluded.champion_team_id,runner_up_team_id=excluded.runner_up_team_id,
    predicted_score_a=excluded.predicted_score_a,predicted_score_b=excluded.predicted_score_b,request_id=excluded.request_id,updated_at=now();
  return public.get_koshien_later_phase_state(p_event_id);
end $$;

revoke all on function public.prepare_koshien_later_phase(text,text,timestamptz,timestamptz,text,text) from anon, public;
revoke all on function public.update_koshien_later_phase_schedule(text,text,timestamptz,timestamptz,text,text) from anon, public;
revoke all on function public.get_koshien_later_phase_admin_progress(text) from anon, public;
revoke all on function public.refresh_koshien_phase_schedule(text) from anon, public;
revoke all on function public.set_koshien_later_phase_status(text,text,text) from anon, public;
revoke all on function public.save_koshien_revenge_pick(text,uuid,bigint,uuid) from anon, public;
revoke all on function public.save_koshien_zombie_prediction(text,uuid,bigint,uuid) from anon, public;
revoke all on function public.save_koshien_phase3_prediction(text,integer,integer,bigint,uuid) from anon, public;
revoke all on function public.validate_koshien_phase2_draft_setup() from anon, authenticated, public;
revoke all on table public.koshien_later_prediction_requests from anon, authenticated;

grant execute on function public.prepare_koshien_later_phase(text,text,timestamptz,timestamptz,text,text) to authenticated;
grant execute on function public.update_koshien_later_phase_schedule(text,text,timestamptz,timestamptz,text,text) to authenticated;
grant execute on function public.get_koshien_later_phase_admin_progress(text) to authenticated;
grant execute on function public.refresh_koshien_phase_schedule(text) to authenticated;
grant execute on function public.set_koshien_later_phase_status(text,text,text) to authenticated;
grant execute on function public.save_koshien_revenge_pick(text,uuid,bigint,uuid) to authenticated;
grant execute on function public.save_koshien_zombie_prediction(text,uuid,bigint,uuid) to authenticated;
grant execute on function public.save_koshien_phase3_prediction(text,integer,integer,bigint,uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
