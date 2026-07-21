begin;

-- A client-controlled custom setting cannot prove that a write originated
-- inside the pick RPC. Remove the setting-based write policies and all direct
-- authenticated DML before exposing the hardened RPC.
drop policy if exists phase2_drafts_rpc_update on public.phase2_drafts;
drop policy if exists phase2_draft_picks_rpc_insert on public.phase2_draft_picks;

revoke all on table public.phase2_drafts from authenticated;
revoke all on table public.phase2_draft_picks from authenticated;
grant select on table public.phase2_drafts to authenticated;
grant select on table public.phase2_draft_picks to authenticated;

create or replace function public.save_koshien_phase2_draft_pick(
  p_draft_id uuid,
  p_team_id uuid,
  p_expected_pick_no integer,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_draft public.phase2_drafts;
  v_existing public.phase2_draft_picks;
  v_league_id uuid;
  v_player_id uuid;
  v_expected_player_id uuid;
  v_round integer;
  v_slot integer;
begin
  if auth.uid() is null then
    raise exception 'authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'request_id is required';
  end if;

  select d.* into v_draft
  from public.phase2_drafts d
  where d.id = p_draft_id
  for update;

  if v_draft.id is null then
    raise exception 'phase 2 draft is not found' using errcode = 'P0002';
  end if;

  select e.league_id into v_league_id
  from public.events e
  where e.id = v_draft.event_id;

  select p.id into v_player_id
  from public.players p
  where p.league_id = v_league_id
    and p.profile_id = auth.uid();

  if v_player_id is null or not (v_player_id = any (v_draft.ordered_player_ids)) then
    raise exception 'draft participant permission is required' using errcode = '42501';
  end if;

  select dp.* into v_existing
  from public.phase2_draft_picks dp
  where dp.draft_id = p_draft_id
    and dp.player_id = v_player_id
    and dp.request_id = p_request_id;

  if v_existing.id is not null then
    if v_existing.team_id <> p_team_id or v_existing.pick_no <> p_expected_pick_no then
      raise exception 'request_id was already used for a different pick' using errcode = '23505';
    end if;
    return public.get_koshien_phase2_draft_state(v_draft.event_id);
  end if;

  if v_draft.status <> 'drafting' then
    raise exception 'phase 2 draft is not active' using errcode = '55000';
  end if;
  if clock_timestamp() < v_draft.starts_at then
    raise exception 'phase 2 draft has not started' using errcode = '55000';
  end if;
  if clock_timestamp() >= v_draft.deadline_at then
    raise exception 'phase 2 draft deadline has passed' using errcode = '55000';
  end if;
  if p_expected_pick_no <> v_draft.current_pick_no then
    raise exception 'draft turn changed' using errcode = '40001';
  end if;
  if v_draft.current_pick_no not between 1 and 16 then
    raise exception 'current pick number is invalid';
  end if;

  v_round := ((v_draft.current_pick_no - 1) / 4) + 1;
  v_slot := ((v_draft.current_pick_no - 1) % 4) + 1;
  if (v_round % 2) = 1 then
    v_expected_player_id := v_draft.ordered_player_ids[v_slot];
  else
    v_expected_player_id := v_draft.ordered_player_ids[5 - v_slot];
  end if;

  if v_player_id <> v_expected_player_id then
    raise exception 'it is not the authenticated player turn' using errcode = '42501';
  end if;
  if not (p_team_id = any (v_draft.eligible_team_ids)) then
    raise exception 'team is not in the fixed best 16';
  end if;
  if not exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.event_id = v_draft.event_id
  ) then
    raise exception 'team does not belong to the draft event';
  end if;
  if exists (
    select 1 from public.phase2_draft_picks dp
    where dp.draft_id = v_draft.id and dp.team_id = p_team_id
  ) then
    raise exception 'team was already drafted' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.phase2_draft_picks dp
    where dp.draft_id = v_draft.id
      and dp.player_id = v_player_id
      and dp.draft_round = v_round
  ) then
    raise exception 'player already drafted in this round' using errcode = '23505';
  end if;
  if (select count(*) from public.phase2_draft_picks dp where dp.draft_id = v_draft.id and dp.player_id = v_player_id) >= 4 then
    raise exception 'player already owns four teams' using errcode = '23505';
  end if;

  insert into public.phase2_draft_picks (
    draft_id, event_id, player_id, team_id, pick_no, draft_round, request_id
  ) values (
    v_draft.id, v_draft.event_id, v_player_id, p_team_id,
    v_draft.current_pick_no, v_round, p_request_id
  );

  update public.phase2_drafts
  set current_pick_no = case when v_draft.current_pick_no = 16 then 16 else v_draft.current_pick_no + 1 end,
      status = case when v_draft.current_pick_no = 16 then 'completed' else v_draft.status end,
      version = v_draft.version + 1,
      updated_at = now()
  where id = v_draft.id;

  return public.get_koshien_phase2_draft_state(v_draft.event_id);
end;
$$;

revoke execute on function public.save_koshien_phase2_draft_pick(uuid, uuid, integer, uuid) from anon, public;
grant execute on function public.save_koshien_phase2_draft_pick(uuid, uuid, integer, uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
