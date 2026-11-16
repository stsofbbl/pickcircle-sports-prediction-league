-- Isolated integration fixture. Production function bodies read 2026-11-17 JST.
ALTER TABLE public.matches ADD COLUMN starts_at timestamptz;
ALTER TABLE public.phase2_draft_picks ADD COLUMN pick_no integer;
ALTER TABLE public.koshien_later_rounds
 ADD COLUMN opens_at timestamptz, ADD COLUMN deadline_at timestamptz,
 ADD COLUMN source_results_version bigint, ADD COLUMN snapshot jsonb,
 ADD COLUMN start_mode text, ADD COLUMN end_mode text,
 ADD COLUMN updated_at timestamptz, ADD COLUMN version bigint DEFAULT 0;
CREATE TABLE public.koshien_zombie_eligibility(
 event_id text,player_id uuid,eligible boolean,allowed_team_ids uuid[],source_results_version bigint,
 PRIMARY KEY(event_id,player_id));
CREATE OR REPLACE FUNCTION public.auto_prepare_koshien_zombie_from_sf()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.koshien_result_version(p_event_id text)
 RETURNS bigint
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce(sum(extract(epoch from m.updated_at)::bigint), 0)
  from public.matches m
  where m.event_id = p_event_id and m.status = 'completed';
$function$
;

CREATE OR REPLACE FUNCTION public.prepare_koshien_zombie_phase_internal(p_event_id text, p_opens_at timestamp with time zone, p_deadline_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
;

-- Effective EXECUTE matches catalog 2026-11-17: service_role yes, authenticated/anon no.
-- Fixture roles/tables still do not reproduce the complete production ACL/RLS.
REVOKE ALL ON FUNCTION public.prepare_koshien_zombie_phase_internal(text,timestamptz,timestamptz)
 FROM PUBLIC,authenticated,anon;
GRANT EXECUTE ON FUNCTION public.prepare_koshien_zombie_phase_internal(text,timestamptz,timestamptz) TO service_role;
BEGIN;
INSERT INTO public.events(id,preset_type,league_id,created_by,status,rules)
 VALUES('zombie-test','koshien','00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000001','resultWait','{}');
INSERT INTO public.teams(id,event_id,name,game_multiplier,sqrt_odds,start_round)
 SELECT ('50000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'zombie-test','Team '||i,2,2,1
 FROM generate_series(1,8) i;
INSERT INTO public.phase2_drafts(event_id,status,id,ordered_player_ids)
 VALUES('zombie-test','completed','60000000-0000-0000-0000-000000000001',
 ARRAY['20000000-0000-0000-0000-000000000001'::uuid,'20000000-0000-0000-0000-000000000002'::uuid]);
INSERT INTO public.phase2_draft_picks(draft_id,player_id,team_id,pick_no)
 SELECT '60000000-0000-0000-0000-000000000001',
 CASE WHEN i<=4 THEN '20000000-0000-0000-0000-000000000002'::uuid
 ELSE '20000000-0000-0000-0000-000000000001'::uuid END,
 ('50000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,i
 FROM generate_series(1,8) i;
SELECT yoso_approval_private.issue_write_permit('zombie-test');
INSERT INTO public.matches(event_id,round_key,match_no,team1_id,team2_id,team1_score,team2_score,
 winner_team_id,loser_team_id,status,updated_at)
 SELECT 'zombie-test','QF',i,
 ('50000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 ('50000000-0000-0000-0000-'||lpad((i+4)::text,12,'0'))::uuid,3,1,
 ('50000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,
 ('50000000-0000-0000-0000-'||lpad((i+4)::text,12,'0'))::uuid,'completed',now()
 FROM generate_series(1,4) i;
INSERT INTO public.matches(event_id,round_key,match_no,team1_id,team2_id,status)
 VALUES('zombie-test','SF',1,'50000000-0000-0000-0000-000000000001',
 '50000000-0000-0000-0000-000000000002','scheduled');
COMMIT;
CREATE CONSTRAINT TRIGGER auto_prepare_koshien_zombie_from_sf
 AFTER INSERT OR UPDATE ON public.matches DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION public.auto_prepare_koshien_zombie_from_sf();
