-- Read-only baseline gate for ranking_v1, before any #58/#60 production changes.
-- Use the reviewed production search_path public,extensions; any drift requires review.
-- This is not a migration or a complete schema backup.
WITH t AS (SELECT c.oid,c.relname,c.relrowsecurity,c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('events','predictions','results','scores','players','league_members')), inventory AS (
 SELECT 'columns' AS category,count(*) AS n,md5(jsonb_agg(jsonb_build_array(t.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,pg_get_expr(d.adbin,d.adrelid)) ORDER BY t.relname,a.attnum)::text) AS fingerprint FROM t JOIN pg_attribute a ON a.attrelid=t.oid LEFT JOIN pg_attrdef d ON d.adrelid=t.oid AND d.adnum=a.attnum WHERE a.attnum>0 AND NOT a.attisdropped
 UNION ALL SELECT 'constraints',count(*),md5(jsonb_agg(jsonb_build_array(t.relname,c.conname,pg_get_constraintdef(c.oid),c.convalidated,c.condeferrable,c.condeferred) ORDER BY t.relname,c.conname)::text) FROM t JOIN pg_constraint c ON c.conrelid=t.oid
 UNION ALL SELECT 'policies',count(*),md5(jsonb_agg(jsonb_build_array(tablename,policyname,permissive,roles,cmd,qual,with_check) ORDER BY tablename,policyname)::text) FROM pg_policies WHERE schemaname='public' AND tablename IN(SELECT relname FROM t)
 UNION ALL SELECT 'triggers',count(*),md5(jsonb_agg(jsonb_build_array(t.relname,g.tgname,g.tgenabled,pg_get_triggerdef(g.oid),md5(p.prosrc),p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner)) ORDER BY t.relname,g.tgname)::text) FROM t JOIN pg_trigger g ON g.tgrelid=t.oid JOIN pg_proc p ON p.oid=g.tgfoid WHERE NOT g.tgisinternal
 UNION ALL SELECT 'table_security',count(*),md5(jsonb_agg(jsonb_build_array(t.relname,r.rolname,t.relrowsecurity,t.relforcerowsecurity,ARRAY(SELECT v FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) v WHERE has_table_privilege(r.oid,t.oid,v))) ORDER BY t.relname,r.rolname)::text) FROM t CROSS JOIN pg_roles r WHERE r.rolname IN('anon','authenticated','service_role')
 UNION ALL SELECT 'helpers',count(*),md5(jsonb_agg(jsonb_build_array(p.proname,pg_get_function_identity_arguments(p.oid),md5(p.prosrc),p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner),has_function_privilege('anon',p.oid,'EXECUTE'),has_function_privilege('authenticated',p.oid,'EXECUTE'),has_function_privilege('service_role',p.oid,'EXECUTE')) ORDER BY p.proname,pg_get_function_identity_arguments(p.oid))::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('is_league_member','is_league_admin','is_league_owner','is_prediction_open','is_prediction_public','archive_deleted_account','prevent_owner_account_deletion','remove_club_member','delete_club')
), expected(category,n,fingerprint) AS (VALUES
 ('columns',49,'402a8dbbb28e485f378cf1e7c8e2f051'),
 ('constraints',25,'325932d6e84d821f3cb2042df83abc2e'),
 ('helpers',9,'8a7006091e33b738597199f012cd48ac'),
 ('policies',17,'fc0570b259ba80e092296ac4d57f316c'),
 ('table_security',18,'6597292384f0fd7c4edfbb8f4ecadc6b'),
 ('triggers',8,'7d39cdbb53c88bdd823c8990d10fc349')
), counts AS (
 SELECT 'ranking_schema_collision' AS category,count(*) AS n FROM pg_namespace WHERE nspname='ranking_v1_private'
 UNION ALL SELECT 'ranking_rpc_collision',count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND left(p.proname,11)='ranking_v1_'
 UNION ALL SELECT 'ranking_trigger_collision',count(*) FROM pg_trigger WHERE NOT tgisinternal AND left(tgname,11)='ranking_v1_'
 UNION ALL SELECT 'ranking_policy_collision',count(*) FROM pg_policies WHERE schemaname='public' AND left(policyname,11)='ranking_v1_'
 UNION ALL SELECT 'ranking_constraint_collision',count(*) FROM pg_constraint WHERE connamespace='public'::regnamespace AND left(conname,11)='ranking_v1_'
 UNION ALL SELECT 'existing_ranking_events',count(*) FROM public.events WHERE preset_type='ranking_v1'
 UNION ALL SELECT 'active_members_missing_player',count(*) FROM public.league_members lm WHERE lm.membership_status='active' AND NOT EXISTS(SELECT 1 FROM public.players p WHERE p.league_id=lm.league_id AND p.profile_id=lm.user_id)
 UNION ALL SELECT 'active_members_deleted_or_missing_profile',count(*) FROM public.league_members lm LEFT JOIN public.profiles p ON p.id=lm.user_id WHERE lm.membership_status='active' AND (p.id IS NULL OR p.deleted_at IS NOT NULL OR p.auth_user_id IS NULL)
 UNION ALL SELECT 'core_tables_rls_disabled',count(*) FROM t WHERE NOT relrowsecurity
), checks AS (
 SELECT e.category,coalesce(i.n=e.n AND i.fingerprint=e.fingerprint,false) AS ok,coalesce(i.n::text,'missing') AS observed FROM expected e LEFT JOIN inventory i USING(category)
 UNION ALL SELECT category,n=0,n::text FROM counts
 UNION ALL SELECT 'search_path',current_schemas(false)::text='{public,extensions}',current_schemas(false)::text
)
SELECT category,ok,observed FROM checks ORDER BY category;
