begin;

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
declare v_league_id uuid; v_round public.koshien_later_rounds;
begin
  select e.league_id into v_league_id from public.events e where e.id = p_event_id;
  if auth.uid() is null or v_league_id is null or not public.is_league_admin(v_league_id) then
    raise exception 'league admin permission is required' using errcode = '42501';
  end if;
  if p_phase_key not in ('best16','zombie','phase3') or p_action not in ('open','lock') then
    raise exception 'unsupported later phase action';
  end if;

  if p_phase_key = 'best16' then
    select r.* into v_round from public.koshien_later_rounds r where r.event_id = p_event_id and r.phase_key = 'revenge' for update;
    if v_round.id is null then raise exception 'best 16 phases are not prepared'; end if;
    if p_action = 'open' then
      if clock_timestamp() < v_round.opens_at or clock_timestamp() >= v_round.deadline_at then raise exception 'best 16 phase is outside its schedule'; end if;
      update public.koshien_later_rounds set status = 'open' where id = v_round.id and status = 'ready';
      update public.phase2_drafts set status = 'drafting' where event_id = p_event_id and status = 'ready';
    else
      if not exists (select 1 from public.phase2_drafts d where d.event_id = p_event_id and d.status in ('completed','locked')) then
        raise exception 'formal phase 2 draft must be completed before lock' using errcode = '55000';
      end if;
      update public.koshien_later_rounds set status = 'locked' where id = v_round.id and status in ('ready','open');
      update public.phase2_drafts set status = 'locked' where event_id = p_event_id and status = 'completed';
    end if;
  else
    select r.* into v_round from public.koshien_later_rounds r where r.event_id = p_event_id and r.phase_key = p_phase_key for update;
    if v_round.id is null then raise exception 'later phase is not prepared'; end if;
    if p_action = 'open' then
      if clock_timestamp() < v_round.opens_at or clock_timestamp() >= v_round.deadline_at then raise exception 'later phase is outside its schedule'; end if;
      update public.koshien_later_rounds set status = 'open' where id = v_round.id and status = 'ready';
    else
      update public.koshien_later_rounds set status = 'locked' where id = v_round.id and status in ('ready','open');
    end if;
  end if;
  return public.get_koshien_later_phase_state(p_event_id);
end;
$$;

revoke all on function public.set_koshien_later_phase_status(text,text,text) from anon, public;
grant execute on function public.set_koshien_later_phase_status(text,text,text) to authenticated;

commit;
