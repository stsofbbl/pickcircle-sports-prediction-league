-- PROTOTYPE ONLY: not a migration; no production writers use it yet.
-- Public RPCs must authorize first. All writers must lock event before results.
CREATE SCHEMA yoso_approval_private;
REVOKE ALL ON SCHEMA yoso_approval_private FROM PUBLIC;

CREATE TABLE yoso_approval_private.revisions (
  event_id text PRIMARY KEY REFERENCES public.events(id),
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
REVOKE ALL ON yoso_approval_private.revisions FROM PUBLIC;

-- Internal SECURITY INVOKER helper, callable only by a trusted server role.
-- Despite its name this creates an initial revision and acquires write locks.
CREATE FUNCTION yoso_approval_private.lock_revision(p_event_id text)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_revision bigint;
BEGIN
  PERFORM 1 FROM public.events
    WHERE id = p_event_id AND preset_type = 'koshien' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Koshien event not found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO yoso_approval_private.revisions(event_id)
    VALUES (p_event_id) ON CONFLICT DO NOTHING;
  SELECT revision INTO STRICT v_revision
    FROM yoso_approval_private.revisions WHERE event_id = p_event_id FOR UPDATE;
  RETURN v_revision;
END;
$$;

CREATE FUNCTION yoso_approval_private.advance_revision(p_event_id text, p_expected bigint)
RETURNS bigint LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE v_revision bigint;
BEGIN
  IF p_expected IS NULL OR p_expected < 0 THEN
    RAISE EXCEPTION 'expected revision is required' USING ERRCODE = '22023';
  END IF;
  v_revision := yoso_approval_private.lock_revision(p_event_id);
  IF v_revision <> p_expected THEN
    RAISE EXCEPTION 'stale approval revision' USING ERRCODE = '40001';
  END IF;
  UPDATE yoso_approval_private.revisions SET revision = revision + 1
    WHERE event_id = p_event_id RETURNING revision INTO v_revision;
  RETURN v_revision;
END;
$$;
REVOKE ALL ON FUNCTION yoso_approval_private.lock_revision(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION yoso_approval_private.advance_revision(text,bigint) FROM PUBLIC;
