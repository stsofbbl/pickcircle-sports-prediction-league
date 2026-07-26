begin;

alter table public.external_match_imports
  drop constraint if exists external_match_imports_status_check;

alter table public.external_match_imports
  add constraint external_match_imports_status_check
  check (status in ('confirmed', 'canceled'));

alter table public.external_match_imports
  add column if not exists canceled_at timestamptz,
  add column if not exists canceled_by uuid references public.profiles(id) on delete restrict;

create or replace function public.sync_external_import_status_with_match()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.status = 'completed' and new.status = 'scheduled' then
    update public.external_match_imports
    set status = 'canceled',
        canceled_at = now(),
        canceled_by = auth.uid()
    where imported_match_id = new.id
      and status = 'confirmed';
  elsif old.status = 'scheduled' and new.status = 'completed' then
    update public.external_match_imports
    set status = 'confirmed',
        confirmed_at = now(),
        confirmed_by = coalesce(auth.uid(), confirmed_by),
        canceled_at = null,
        canceled_by = null
    where imported_match_id = new.id
      and status = 'canceled'
      and normalized_payload->>'roundKey' is not distinct from new.round_key
      and (normalized_payload->>'team1Id')::uuid is not distinct from new.team1_id
      and (normalized_payload->>'team2Id')::uuid is not distinct from new.team2_id
      and (normalized_payload->>'team1Score')::integer is not distinct from new.team1_score
      and (normalized_payload->>'team2Score')::integer is not distinct from new.team2_score
      and (normalized_payload->>'winnerTeamId')::uuid is not distinct from new.winner_team_id
      and (normalized_payload->>'loserTeamId')::uuid is not distinct from new.loser_team_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sync_external_import_status_with_match on public.matches;
create trigger sync_external_import_status_with_match
after update of status on public.matches
for each row execute function public.sync_external_import_status_with_match();

revoke all on function public.sync_external_import_status_with_match() from anon, authenticated, public;

notify pgrst, 'reload schema';

commit;
