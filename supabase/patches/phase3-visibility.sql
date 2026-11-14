-- DRAFT: isolated validation required before creating/applying a migration.
-- Match get_koshien_later_phase_state phase3.predictions visibility.
-- No schedule refresh or other mutation is performed during reads.
ALTER POLICY final_score_predictions_select_owner_or_public
ON public.final_score_predictions
USING (
  EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = final_score_predictions.event_id
      AND public.is_league_member(e.league_id)
      AND (
        EXISTS (
          SELECT 1 FROM public.players p
          WHERE p.id = final_score_predictions.player_id
            AND p.league_id = e.league_id
            AND p.profile_id = (SELECT auth.uid())
        )
        OR EXISTS (
          SELECT 1 FROM public.koshien_later_rounds r
          WHERE r.event_id = e.id
            AND r.phase_key = 'phase3'
            AND r.status IN ('locked', 'completed')
        )
      )
  )
);
