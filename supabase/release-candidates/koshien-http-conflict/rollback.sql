-- REVIEW CANDIDATE ONLY (#61). Not a migration. Run only after explicit approval.
-- All five changes are atomic, guarded by the exact captured source hashes.
DO $patch$
DECLARE row_data record; target oid; original jsonb; after_meta jsonb; definition text; source text;
BEGIN
 FOR row_data IN SELECT * FROM (VALUES
  ('public.finalize_koshien_admin_results(text,text)','cf158f20261603a3f50792cf24a00615','a667b0ac82723ee8caa8df701efc10cf'),
  ('public.save_koshien_phase2_draft_pick(uuid,uuid,integer,uuid)','8474c165ac9625e486bb99d6ae6323db','0fe43fa3fbaf333e2f93e44ef519c8c6'),
  ('public.save_koshien_phase3_prediction(text,integer,integer,integer,integer,bigint,uuid)','a4ceac4472ef4a53566a2d39db7c39f9','a898a5883e2e486ab026635cfdbfaeeb'),
  ('public.save_koshien_revenge_pick(text,uuid,bigint,uuid)','188d1dcad731be2c3854a6fafa021e88','ad82996fbb68741deb9cacea1b1aecf6'),
  ('public.save_koshien_zombie_prediction(text,uuid,bigint,uuid)','1bbd9b8cb1a9212fc380f88d50cdf933','6af9f2dee7a5c9a8ea4281a0e09979c3')
 ) AS v(signature,before_hash,after_hash) LOOP
  target:=to_regprocedure(row_data.signature);
  IF target IS NULL THEN RAISE EXCEPTION 'missing function: %',row_data.signature; END IF;
  SELECT to_jsonb(p)-'prosrc',p.prosrc,pg_get_functiondef(p.oid) INTO original,source,definition
   FROM pg_proc p WHERE p.oid=target;
  IF md5(source) IS DISTINCT FROM row_data.before_hash
   OR NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=target
    AND p.prosecdef AND pg_get_userbyid(p.proowner)='postgres'
    AND p.proconfig=ARRAY['search_path=""']::text[]
    AND p.proacl::text='{postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}')
   OR (length(source)-length(replace(source,'''PT409''','')))<>7
   OR has_function_privilege('anon',target,'EXECUTE')
  THEN RAISE EXCEPTION 'function drift: %',row_data.signature; END IF;
  EXECUTE replace(definition,'''PT409''','''40001''');
  SELECT to_jsonb(p)-'prosrc',p.prosrc INTO after_meta,source FROM pg_proc p WHERE p.oid=target;
  IF after_meta IS DISTINCT FROM original OR md5(source) IS DISTINCT FROM row_data.after_hash
   THEN RAISE EXCEPTION 'unexpected function change: %',row_data.signature; END IF;
 END LOOP;
END $patch$;
