-- Restore only fixture privileges removed when the earlier test roles were dropped.
GRANT SELECT ON public.events,public.teams,public.players TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.matches,public.scores,public.results,public.external_match_imports TO authenticated;
GRANT USAGE ON SCHEMA yoso_approval_private TO authenticated;
GRANT EXECUTE ON FUNCTION yoso_approval_private.begin_result_write(text) TO authenticated;
DROP POLICY IF EXISTS results_admin ON public.results;
CREATE POLICY results_admin ON public.results FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)))
 WITH CHECK(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)));
ALTER TABLE public.external_match_imports ADD COLUMN canceled_at timestamptz;
ALTER TABLE public.external_match_imports ADD COLUMN canceled_by uuid;
