-- Within the existing fixture transaction; reproduce before installing the guard.
ALTER TABLE public.events ADD COLUMN created_by uuid;
ALTER TABLE public.events ADD COLUMN name text DEFAULT 'Original';
ALTER TABLE public.events ADD COLUMN status text DEFAULT 'open';
UPDATE public.events SET created_by='00000000-0000-0000-0000-000000000001' WHERE id='save';
GRANT UPDATE ON public.events TO authenticated;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY events_read_fixture ON public.events FOR SELECT TO authenticated USING(true);
CREATE POLICY events_update_admin ON public.events FOR UPDATE TO authenticated
 USING(public.is_league_admin(league_id)) WITH CHECK(public.is_league_admin(league_id));
-- Admin of both clubs: RLS alone would permit transfer.
INSERT INTO public.league_members VALUES
 ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','owner','active');
UPDATE public.events SET league_id='00000000-0000-0000-0000-000000000010' WHERE id='c';
SAVEPOINT reproduce_identity_bypass;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
UPDATE public.events SET preset_type='other' WHERE id='save';
INSERT INTO public.matches(event_id,round_key,match_no,status) VALUES('save','R1',1,'scheduled');
RESET ROLE;
SELECT public.test_assert(EXISTS(SELECT 1 FROM public.matches WHERE event_id='save'),'reproduced preset change bypasses child permit gate');
SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM yoso_approval_private.write_permits WHERE event_id='save'),'bypass required no permit');
ROLLBACK TO SAVEPOINT reproduce_identity_bypass;
RESET ROLE;
