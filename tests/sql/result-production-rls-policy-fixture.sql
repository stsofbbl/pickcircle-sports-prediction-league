-- ISOLATED PRODUCTION POLICY SNAPSHOT (catalog SELECT 2026-11-19).
-- This file is NOT a migration. Use inside BEGIN/ROLLBACK only.
-- Table schemas, security-definer helper functions and live data are not copied.
DROP POLICY IF EXISTS results_admin ON public.results;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.events TO anon,authenticated;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.matches TO anon,authenticated;
ALTER TABLE public.results ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.results TO anon,authenticated;
ALTER TABLE public.scores ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.scores TO anon,authenticated;
DROP POLICY IF EXISTS events_delete_admin ON public.events;
CREATE POLICY events_delete_admin ON public.events AS PERMISSIVE FOR DELETE TO authenticated USING (is_league_admin(league_id));
DROP POLICY IF EXISTS events_insert_admin ON public.events;
CREATE POLICY events_insert_admin ON public.events AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((created_by = ( SELECT auth.uid() AS uid)) AND is_league_admin(league_id)));
DROP POLICY IF EXISTS events_select_members ON public.events;
CREATE POLICY events_select_members ON public.events AS PERMISSIVE FOR SELECT TO authenticated USING (is_league_member(league_id));
DROP POLICY IF EXISTS events_update_admin ON public.events;
CREATE POLICY events_update_admin ON public.events AS PERMISSIVE FOR UPDATE TO authenticated USING (is_league_admin(league_id)) WITH CHECK (is_league_admin(league_id));
DROP POLICY IF EXISTS matches_admin_all ON public.matches;
CREATE POLICY matches_admin_all ON public.matches AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = matches.event_id) AND is_league_admin(e.league_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = matches.event_id) AND is_league_admin(e.league_id)))));
DROP POLICY IF EXISTS matches_select_members ON public.matches;
CREATE POLICY matches_select_members ON public.matches AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = matches.event_id) AND is_league_member(e.league_id)))));
DROP POLICY IF EXISTS results_insert_admin ON public.results;
CREATE POLICY results_insert_admin ON public.results AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((updated_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = results.event_id) AND is_league_admin(e.league_id))))));
DROP POLICY IF EXISTS results_select_members ON public.results;
CREATE POLICY results_select_members ON public.results AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = results.event_id) AND is_league_member(e.league_id)))));
DROP POLICY IF EXISTS results_update_admin ON public.results;
CREATE POLICY results_update_admin ON public.results AS PERMISSIVE FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = results.event_id) AND is_league_admin(e.league_id))))) WITH CHECK (((updated_by = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = results.event_id) AND is_league_admin(e.league_id))))));
DROP POLICY IF EXISTS scores_admin_all ON public.scores;
CREATE POLICY scores_admin_all ON public.scores AS PERMISSIVE FOR ALL TO authenticated USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = scores.event_id) AND is_league_admin(e.league_id))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = scores.event_id) AND is_league_admin(e.league_id)))));
DROP POLICY IF EXISTS scores_select_members ON public.scores;
CREATE POLICY scores_select_members ON public.scores AS PERMISSIVE FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM events e
  WHERE ((e.id = scores.event_id) AND is_league_member(e.league_id)))));
