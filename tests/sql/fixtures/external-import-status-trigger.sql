CREATE OR REPLACE FUNCTION public.sync_external_import_status_with_match()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
$function$;
CREATE TRIGGER sync_external_import_status_with_match AFTER UPDATE OF status ON public.matches FOR EACH ROW EXECUTE FUNCTION public.sync_external_import_status_with_match();
