-- Read-only catalog snapshot: constraints from production on 2026-11-14.
-- Applied only inside the disposable integration fixture, not a migration.
ALTER TABLE public.final_score_predictions
 ADD COLUMN id uuid DEFAULT gen_random_uuid(),
 ADD COLUMN champion_team_id uuid,
 ADD COLUMN runner_up_team_id uuid,
 ADD COLUMN champion_score integer,
 ADD COLUMN runner_up_score integer;
ALTER TABLE public.koshien_later_rounds
 ADD COLUMN id uuid DEFAULT gen_random_uuid(),
 ADD COLUMN team_a_id uuid,
 ADD COLUMN team_b_id uuid;
INSERT INTO public.teams (id,event_id,name,sqrt_odds) VALUES
 ('20000000-0000-0000-0000-000000000001','event','A',1),
 ('20000000-0000-0000-0000-000000000002','event','B',1),
 ('20000000-0000-0000-0000-000000000003','other-event','C',1),
 ('20000000-0000-0000-0000-000000000004','other-event','D',1);
UPDATE public.koshien_later_rounds
 SET opens_at=clock_timestamp()-interval '2 days',
 deadline_at=clock_timestamp()+interval '1 day',
 team_a_id=CASE WHEN event_id='event'
 THEN '20000000-0000-0000-0000-000000000001'::uuid
 ELSE '20000000-0000-0000-0000-000000000003'::uuid END,
 team_b_id=CASE WHEN event_id='event'
 THEN '20000000-0000-0000-0000-000000000002'::uuid
 ELSE '20000000-0000-0000-0000-000000000004'::uuid END;
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_champion_score_check CHECK (((champion_score IS NULL) OR (champion_score >= 0)));
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_champion_team_id_fkey FOREIGN KEY (champion_team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_event_id_player_id_key UNIQUE (event_id, player_id);
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_pkey PRIMARY KEY (id);
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_player_id_fkey FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE;
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_runner_up_score_check CHECK (((runner_up_score IS NULL) OR (runner_up_score >= 0)));
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_runner_up_team_id_fkey FOREIGN KEY (runner_up_team_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_tiebreak_score_a_check CHECK (((predicted_tiebreak_score_a IS NULL) OR (predicted_tiebreak_score_a >= 0)));
ALTER TABLE public.final_score_predictions ADD CONSTRAINT final_score_predictions_tiebreak_score_b_check CHECK (((predicted_tiebreak_score_b IS NULL) OR (predicted_tiebreak_score_b >= 0)));
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_check CHECK (((status = ANY (ARRAY['not_ready'::text, 'ready'::text])) OR ((opens_at IS NOT NULL) AND (deadline_at IS NOT NULL) AND (opens_at < deadline_at))));
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_check1 CHECK (((phase_key <> 'phase3'::text) OR (status = ANY (ARRAY['not_ready'::text, 'ready'::text])) OR ((team_a_id IS NOT NULL) AND (team_b_id IS NOT NULL) AND (team_a_id <> team_b_id))));
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_end_mode_check CHECK ((end_mode = ANY (ARRAY['manual'::text, 'automatic'::text])));
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_event_id_fkey FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE;
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_event_id_phase_key_key UNIQUE (event_id, phase_key);
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_phase_key_check CHECK ((phase_key = ANY (ARRAY['revenge'::text, 'zombie'::text, 'phase3'::text])));
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_pkey PRIMARY KEY (id);
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_start_mode_check CHECK ((start_mode = ANY (ARRAY['manual'::text, 'automatic'::text])));
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_status_check CHECK ((status = ANY (ARRAY['not_ready'::text, 'ready'::text, 'open'::text, 'locked'::text, 'completed'::text])));
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_team_a_id_fkey FOREIGN KEY (team_a_id) REFERENCES teams(id) ON DELETE SET NULL;
ALTER TABLE public.koshien_later_rounds ADD CONSTRAINT koshien_later_rounds_team_b_id_fkey FOREIGN KEY (team_b_id) REFERENCES teams(id) ON DELETE SET NULL;
-- Validate that constraints are active, not just copied into a file.
DO $$ BEGIN
 BEGIN
   INSERT INTO public.koshien_later_rounds(event_id,phase_key,status)
   VALUES ('event','phase2','not_ready');
   RAISE EXCEPTION 'Invalid phase key accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
   UPDATE public.koshien_later_rounds SET deadline_at=opens_at
   WHERE event_id='event' AND phase_key='phase3';
   RAISE EXCEPTION 'Invalid deadline accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
   UPDATE public.koshien_later_rounds SET team_b_id=team_a_id
   WHERE event_id='event' AND phase_key='phase3';
   RAISE EXCEPTION 'Identical finalists accepted';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
 BEGIN
   INSERT INTO public.final_score_predictions(event_id,player_id)
   VALUES ('event','10000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'Duplicate prediction accepted';
 EXCEPTION WHEN unique_violation THEN NULL;
 END;
 BEGIN
   INSERT INTO public.final_score_predictions(event_id,player_id)
   VALUES ('missing-event','10000000-0000-0000-0000-000000000001');
   RAISE EXCEPTION 'Missing event accepted';
 EXCEPTION WHEN foreign_key_violation THEN NULL;
 END;
 RAISE NOTICE 'PASS constraints: phase key, deadline, finalists, uniqueness, foreign key';
END $$;
