-- Recovery only: restores the old early-publication behavior.
-- Use only after assessing the privacy impact. Does not change prediction data.
ALTER POLICY final_score_predictions_select_owner_or_public
ON public.final_score_predictions
USING (
  EXISTS (
    SELECT 1 FROM public.players p
    WHERE p.id = final_score_predictions.player_id
      AND p.profile_id = (SELECT auth.uid())
  )
  OR public.is_prediction_public(event_id)
);
