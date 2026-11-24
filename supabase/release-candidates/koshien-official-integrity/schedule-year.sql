-- REVIEW CANDIDATE, not a migration. Only apply in an approved transaction.
-- Change only captured function bodies; preserve owner, ACL and security mode.
-- Fail closed on source-body drift before modifying any function.
DO $test$ DECLARE signature regprocedure; original text; modified text; anchor text; expected_hash text; actual_hash text;
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
  IF expected_hash IS NULL OR actual_hash IS DISTINCT FROM expected_hash THEN
   RAISE EXCEPTION 'schedule RPC source drift: %',signature;
  END IF;
  original:=pg_get_functiondef(signature);
  anchor:=CASE WHEN signature::text LIKE '%late_schedule%' THEN
    E'    raise exception ''invalid late official schedule payload'';\n  end if;'
    ELSE E'    raise exception ''invalid official schedule payload'';\n  end if;' END;
  IF (length(original)-length(replace(original,anchor,'')))<>length(anchor) THEN RAISE EXCEPTION 'captured function anchor changed: %',signature; END IF;
  modified:=replace(original,anchor,anchor||E'\n'||guard);
  EXECUTE modified;
 END LOOP;
END $test$;
