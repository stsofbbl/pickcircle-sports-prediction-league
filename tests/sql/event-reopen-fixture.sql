ALTER TABLE public.events ADD COLUMN updated_at timestamptz;
CREATE TABLE public.koshien_result_reopens(
 event_id text, previous_event jsonb, reopened_by uuid
);
-- Dependencies only; no real production rows. Auth helper/RLS comes from prior fixture.
