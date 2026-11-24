-- #53: Prevent direct deletion of finalized/archived Koshien events.
-- Preserve the existing admin DELETE permission for unfinished Koshien and other sports.
-- Intentionally do not add a DELETE trigger: delete_club() runs as a SECURITY DEFINER
-- and must retain its existing league/event cascade behavior.
DO $preflight$
BEGIN
  IF (SELECT count(*) FROM pg_policies
      WHERE schemaname='public' AND tablename='events'
        AND policyname='events_delete_admin' AND cmd='DELETE'
        AND roles::text='{authenticated}'
        AND qual='is_league_admin(league_id)') <> 1 THEN
    RAISE EXCEPTION 'events_delete_admin policy differs from reviewed production state';
  END IF;
END
$preflight$;

ALTER POLICY events_delete_admin ON public.events
USING (
  public.is_league_admin(league_id)
  AND (
    preset_type IS DISTINCT FROM 'koshien'
    OR (
      status IS DISTINCT FROM 'finalized'
      AND status IS DISTINCT FROM 'archive'
      AND (rules->'resultFlow'->>'status') IS DISTINCT FROM 'finalized'
    )
  )
);
