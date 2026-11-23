-- Minimal dependencies for the actual cancellation function.
ALTER TABLE public.matches ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE TABLE public.phase2_drafts(event_id text,status text);
CREATE TABLE public.koshien_later_rounds(event_id text,phase_key text,status text);
CREATE TABLE public.koshien_result_cancellations(
 event_id text,round_key text,match_no integer,previous_match jsonb,canceled_by uuid);
