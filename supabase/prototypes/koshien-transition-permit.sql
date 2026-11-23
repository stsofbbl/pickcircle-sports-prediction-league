-- PROTOTYPE ONLY: trusted RPCs issue exact, single-use transition permits.
CREATE TABLE yoso_approval_private.transition_permits (
 event_id text PRIMARY KEY REFERENCES public.events(id) ON DELETE CASCADE,
 transaction_id bigint NOT NULL,
 actor_id uuid NOT NULL,
 old_status text, new_status text,
 old_flow jsonb, new_flow jsonb,
 old_policy text, new_policy text
);
ALTER TABLE yoso_approval_private.transition_permits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON yoso_approval_private.transition_permits FROM PUBLIC,authenticated,anon;

-- Definer is limited to checking/deleting the private permit. No event locks here.
CREATE OR REPLACE FUNCTION yoso_approval_private.protect_koshien_approval_state()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF OLD.preset_type='koshien' OR NEW.preset_type='koshien' THEN
  IF ((OLD.status='finalized' OR NEW.status='finalized')
       AND NEW.status IS DISTINCT FROM OLD.status)
     OR (NEW.rules->'resultFlow') IS DISTINCT FROM (OLD.rules->'resultFlow')
     OR NEW.rules->>'approvalPolicy' IS DISTINCT FROM OLD.rules->>'approvalPolicy' THEN
   DELETE FROM yoso_approval_private.transition_permits p
   WHERE p.event_id=OLD.id AND NEW.id=OLD.id
    AND p.transaction_id=pg_catalog.txid_current() AND p.actor_id=auth.uid()
    AND p.old_status IS NOT DISTINCT FROM OLD.status
    AND p.new_status IS NOT DISTINCT FROM NEW.status
    AND p.old_flow IS NOT DISTINCT FROM (OLD.rules->'resultFlow')
    AND p.new_flow IS NOT DISTINCT FROM (NEW.rules->'resultFlow')
    AND ((OLD.rules->>'approvalPolicy' IS NOT DISTINCT FROM NEW.rules->>'approvalPolicy')
      OR (p.old_policy IS NOT DISTINCT FROM OLD.rules->>'approvalPolicy'
       AND p.new_policy IS NOT DISTINCT FROM NEW.rules->>'approvalPolicy'));
   IF NOT FOUND THEN
    RAISE EXCEPTION 'approval state requires an authorized transition' USING ERRCODE='42501';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION yoso_approval_private.protect_koshien_approval_state() FROM PUBLIC,authenticated,anon;
