-- Reuse event identity fixture and its admin RLS; all changes are transactional.
ALTER TABLE public.events ADD COLUMN rules jsonb DEFAULT '{}';
UPDATE public.events SET rules='{"resultFlow":{"state":"draft"},"config":{"year":2026}}' WHERE id='save';
INSERT INTO public.events(id,preset_type,league_id,created_by,status,rules) VALUES
 ('done','koshien','00000000-0000-0000-0000-000000000010',
 '00000000-0000-0000-0000-000000000001','finalized','{"resultFlow":{"state":"finalized"}}');
SAVEPOINT reproduce_state_bypass;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
UPDATE public.events SET status='finalized',rules='{"resultFlow":{"state":"finalized","votes":["forged"]}}' WHERE id='save';
RESET ROLE;
SELECT public.test_assert((SELECT status='finalized' AND rules->'resultFlow'->>'state'='finalized'
 FROM public.events WHERE id='save'),'reproduced direct approval-state overwrite');
ROLLBACK TO SAVEPOINT reproduce_state_bypass;
RESET ROLE;
