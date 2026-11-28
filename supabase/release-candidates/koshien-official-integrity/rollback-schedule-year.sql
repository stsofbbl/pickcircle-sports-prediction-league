-- REVIEW CANDIDATE: restore only the three exact schedule body modifications.
-- Preserves existing function identity, owner, ACL and security mode. Requires separate approval.
-- All three changes execute atomically in this DO statement; source drift aborts.
DO $test$ DECLARE signature regprocedure; original text; modified text; anchor text; expected_hash text; actual_hash text; restored_body text;
 guard text := $guard$
  if nullif(btrim(v_event.season), '') is null
     or v_event.season !~ '^(202[0-9]|203[0-5])$'
     or substring(p_source_url from '/sensyuken/([0-9]{4})/schedule') is distinct from v_event.season
     or exists (
       select 1 from jsonb_array_elements(p_rows) item
       where extract(year from (item->>'starts_at')::timestamptz at time zone 'Asia/Tokyo')::text
         is distinct from v_event.season
     ) then
    raise exception 'official schedule year must match saved Koshien season' using errcode = '22023';
  end if;
$guard$;
BEGIN
 FOREACH signature IN ARRAY ARRAY[
  'public.sync_koshien_official_schedule(text,jsonb,text,timestamptz)'::regprocedure,
  'public.auto_sync_koshien_official_schedule(text,jsonb,text,timestamptz)'::regprocedure,
  'public.auto_sync_koshien_late_schedule(text,jsonb,text,timestamptz)'::regprocedure
 ] LOOP
  expected_hash:=CASE signature::text
    WHEN 'sync_koshien_official_schedule(text,jsonb,text,timestamp with time zone)' THEN 'f4d88cf0af5dc2ad05dbe9a4112e5c7a'
    WHEN 'auto_sync_koshien_official_schedule(text,jsonb,text,timestamp with time zone)' THEN '83e20d3234af222b63d747cf34230346'
    WHEN 'auto_sync_koshien_late_schedule(text,jsonb,text,timestamp with time zone)' THEN '068de18f22a1195cdca346daf5bbf4f5'
    ELSE NULL END;
  SELECT md5(prosrc) INTO actual_hash FROM pg_proc WHERE oid=signature;
  -- A rollback is permitted only when removing the exact injected block
  -- restores the reviewed original body hash. Any other edit aborts.
  SELECT replace(prosrc,E'\n'||guard,'') INTO restored_body FROM pg_proc WHERE oid=signature;
  IF expected_hash IS NULL OR restored_body IS NULL OR actual_hash=expected_hash
   OR md5(restored_body) IS DISTINCT FROM expected_hash THEN
   RAISE EXCEPTION 'schedule RPC rollback source drift: %',signature;
  END IF;
  original:=pg_get_functiondef(signature);
  anchor:=CASE WHEN signature::text LIKE '%late_schedule%' THEN
    E'    raise exception ''invalid late official schedule payload'';\n  end if;'
    ELSE E'    raise exception ''invalid official schedule payload'';\n  end if;' END;
  IF (length(original)-length(replace(original,anchor||E'\n'||guard,'')))<>length(anchor||E'\n'||guard) THEN RAISE EXCEPTION 'schedule rollback anchor changed: %',signature; END IF;
  modified:=replace(original,anchor||E'\n'||guard,anchor);
  EXECUTE modified;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid=signature) IS DISTINCT FROM expected_hash THEN
   RAISE EXCEPTION 'schedule RPC restoration hash mismatch: %',signature;
  END IF;
 END LOOP;
END $test$;
