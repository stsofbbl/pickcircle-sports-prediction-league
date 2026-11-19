-- ISOLATED PostgreSQL catalog snapshot 2026-11-19. NOT a migration.
-- Install inside a transaction then ROLLBACK. NOT VALID avoids validating
-- unrelated synthetic rows while enforcing all newly written values.
ALTER TABLE public.events ADD CONSTRAINT yoso_catalog_events_status_check CHECK (status = ANY (ARRAY['draft'::text, 'open'::text, 'resultWait'::text, 'finalized'::text, 'archive'::text])) NOT VALID;
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT yoso_catalog_koshien_later_rounds_end_mode_check CHECK (end_mode = ANY (ARRAY['manual'::text, 'automatic'::text])) NOT VALID;
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT yoso_catalog_koshien_later_rounds_phase_key_check CHECK (phase_key = ANY (ARRAY['revenge'::text, 'zombie'::text, 'phase3'::text])) NOT VALID;
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT yoso_catalog_koshien_later_rounds_start_mode_check CHECK (start_mode = ANY (ARRAY['manual'::text, 'automatic'::text])) NOT VALID;
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT yoso_catalog_koshien_later_rounds_status_check CHECK (status = ANY (ARRAY['not_ready'::text, 'ready'::text, 'open'::text, 'locked'::text, 'completed'::text])) NOT VALID;
ALTER TABLE public.matches ADD CONSTRAINT yoso_catalog_matches_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.matches ADD CONSTRAINT yoso_catalog_matches_loser_team_id_fkey FOREIGN KEY (loser_team_id) REFERENCES teams(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.matches ADD CONSTRAINT yoso_catalog_matches_status_check CHECK (status = ANY (ARRAY['scheduled'::text, 'completed'::text])) NOT VALID;
ALTER TABLE public.matches ADD CONSTRAINT yoso_catalog_matches_team1_id_fkey FOREIGN KEY (team1_id) REFERENCES teams(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.matches ADD CONSTRAINT yoso_catalog_matches_team2_id_fkey FOREIGN KEY (team2_id) REFERENCES teams(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.matches ADD CONSTRAINT yoso_catalog_matches_winner_team_id_fkey FOREIGN KEY (winner_team_id) REFERENCES teams(id) ON DELETE SET NULL NOT VALID;
ALTER TABLE public.results ADD CONSTRAINT yoso_catalog_results_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.scores ADD CONSTRAINT yoso_catalog_scores_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE public.scores ADD CONSTRAINT yoso_catalog_scores_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE NOT VALID;
