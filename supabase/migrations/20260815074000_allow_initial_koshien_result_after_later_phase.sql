create or replace function public.protect_koshien_opened_later_results()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_initial_completion boolean;
begin
  v_initial_completion := (
    old.status = 'scheduled'
    and new.status = 'completed'
    and old.team1_id is not distinct from new.team1_id
    and old.team2_id is not distinct from new.team2_id
    and old.team1_score is null
    and old.team2_score is null
    and old.winner_team_id is null
    and old.loser_team_id is null
    and new.team1_score is not null
    and new.team2_score is not null
    and new.team1_score >= 0
    and new.team2_score >= 0
    and new.team1_score <> new.team2_score
    and new.winner_team_id = case
      when new.team1_score > new.team2_score then new.team1_id
      else new.team2_id
    end
    and new.loser_team_id = case
      when new.team1_score > new.team2_score then new.team2_id
      else new.team1_id
    end
  );

  if not v_initial_completion and (
    (old.winner_team_id, old.loser_team_id) is distinct from (new.winner_team_id, new.loser_team_id)
    or (
      (old.team1_id, old.team2_id) is distinct from (new.team1_id, new.team2_id)
      and not (
        old.status = 'scheduled' and new.status = 'scheduled'
        and old.winner_team_id is null and new.winner_team_id is null
        and old.loser_team_id is null and new.loser_team_id is null
      )
    )
  ) and (
    exists (
      select 1
      from public.koshien_later_rounds r
      where r.event_id = old.event_id
        and r.status in ('open', 'locked', 'completed')
    )
    or exists (
      select 1
      from public.phase2_drafts d
      where d.event_id = old.event_id
        and d.status in ('drafting', 'completed', 'locked')
    )
  ) then
    raise exception 'winner-changing result corrections are locked after a later phase opens'
      using errcode = '55000';
  end if;

  return new;
end;
$function$;
