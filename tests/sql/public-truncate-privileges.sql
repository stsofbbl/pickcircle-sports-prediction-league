-- Disposable PostgreSQL privilege regression test. Never run on production.
-- PostgreSQL/RLS permissions are intentionally exercised against synthetic roles.
BEGIN;
CREATE ROLE yoso_acl_anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE yoso_acl_authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE SCHEMA yoso_acl_probe;
GRANT USAGE ON SCHEMA yoso_acl_probe TO yoso_acl_anon,yoso_acl_authenticated;
CREATE TABLE yoso_acl_probe.records(id integer PRIMARY KEY, secret text NOT NULL);
INSERT INTO yoso_acl_probe.records VALUES (1,'keep-one'),(2,'keep-two');
ALTER TABLE yoso_acl_probe.records ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_public_delete ON yoso_acl_probe.records
  FOR DELETE TO yoso_acl_anon,yoso_acl_authenticated USING (false);
GRANT SELECT,DELETE,TRUNCATE ON yoso_acl_probe.records
  TO yoso_acl_anon,yoso_acl_authenticated;

CREATE FUNCTION yoso_acl_probe.assert_true(p_ok boolean,p_label text)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
 IF p_ok IS DISTINCT FROM true THEN
   RAISE EXCEPTION 'FAIL: %',p_label;
 END IF;
 RAISE NOTICE 'PASS: %',p_label;
END;
$fn$;
SELECT yoso_acl_probe.assert_true(
  has_table_privilege('yoso_acl_anon','yoso_acl_probe.records','TRUNCATE')
  AND has_table_privilege('yoso_acl_authenticated','yoso_acl_probe.records','TRUNCATE'),
  'fixture roles start with TRUNCATE grant');

-- RLS disallows deleting even one row; it does not constrain TRUNCATE.
SET ROLE yoso_acl_anon;
DELETE FROM yoso_acl_probe.records;
RESET ROLE;
SELECT yoso_acl_probe.assert_true(
 (SELECT count(*)=2 FROM yoso_acl_probe.records),
 'DELETE is restricted by RLS despite table-level DELETE grant');

SAVEPOINT truncate_probe;
SET ROLE yoso_acl_anon;
TRUNCATE TABLE yoso_acl_probe.records;
RESET ROLE;
SELECT yoso_acl_probe.assert_true(
 (SELECT count(*)=0 FROM yoso_acl_probe.records),
 'TRUNCATE bypasses row-level DELETE policy');
ROLLBACK TO SAVEPOINT truncate_probe;
SELECT yoso_acl_probe.assert_true(
 (SELECT count(*)=2 FROM yoso_acl_probe.records),
 'rollback restores both rows after TRUNCATE');

-- The proposed current-table revocation changes no SELECT/DELETE privilege.
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA yoso_acl_probe
 FROM yoso_acl_anon,yoso_acl_authenticated;
SELECT yoso_acl_probe.assert_true(
  NOT has_table_privilege('yoso_acl_anon','yoso_acl_probe.records','TRUNCATE')
  AND NOT has_table_privilege('yoso_acl_authenticated','yoso_acl_probe.records','TRUNCATE')
  AND has_table_privilege('yoso_acl_anon','yoso_acl_probe.records','SELECT')
  AND has_table_privilege('yoso_acl_anon','yoso_acl_probe.records','DELETE'),
  'targeted REVOKE removes TRUNCATE but preserves SELECT/DELETE');

SET ROLE yoso_acl_anon;
DO $fn$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN EXECUTE 'TRUNCATE TABLE yoso_acl_probe.records';
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'TRUNCATE unexpectedly accepted for anon'; END IF;
END;
$fn$;
RESET ROLE;
SET ROLE yoso_acl_authenticated;
DO $fn$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN EXECUTE 'TRUNCATE TABLE yoso_acl_probe.records';
 EXCEPTION WHEN insufficient_privilege THEN rejected:=true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'TRUNCATE unexpectedly accepted for authenticated'; END IF;
END;
$fn$;
RESET ROLE;
SELECT yoso_acl_probe.assert_true(
 (SELECT count(*)=2 FROM yoso_acl_probe.records),
 'TRUNCATE rejected for both client roles without deleting rows');

-- PostgreSQL creator-specific default grants are a SEPARATE source of risk.
ALTER DEFAULT PRIVILEGES IN SCHEMA yoso_acl_probe
 GRANT TRUNCATE ON TABLES TO yoso_acl_anon,yoso_acl_authenticated;
CREATE TABLE yoso_acl_probe.auto_granted(id integer);
SELECT yoso_acl_probe.assert_true(
 has_table_privilege('yoso_acl_anon','yoso_acl_probe.auto_granted','TRUNCATE'),
 'creator default privilege can recreate TRUNCATE on a future table');
ALTER DEFAULT PRIVILEGES IN SCHEMA yoso_acl_probe
 REVOKE TRUNCATE ON TABLES FROM yoso_acl_anon,yoso_acl_authenticated;
CREATE TABLE yoso_acl_probe.auto_restricted(id integer);
SELECT yoso_acl_probe.assert_true(
 NOT has_table_privilege('yoso_acl_anon','yoso_acl_probe.auto_restricted','TRUNCATE')
 AND has_table_privilege('yoso_acl_anon','yoso_acl_probe.auto_granted','TRUNCATE'),
 'default privilege change affects only future tables');
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA yoso_acl_probe
 FROM yoso_acl_anon,yoso_acl_authenticated;
SELECT yoso_acl_probe.assert_true(
 NOT has_table_privilege('yoso_acl_anon','yoso_acl_probe.auto_granted','TRUNCATE'),
 'existing auto-granted table needs its own REVOKE');

ROLLBACK;
-- The roles, private test schema, and grants all disappear.
