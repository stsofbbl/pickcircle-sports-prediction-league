-- READ-ONLY catalog audit. No mutations, no dynamic DDL, no user rows.
-- Only public table ACLs + creator-specific default grants. PostgreSQL 17+.
-- Running this file on production is safe but is NOT the approval to change it.

-- Actual TRUNCATE/other strong SQL privileges visible to each API role.
SELECT r.rolname AS role_name,
 count(*) AS public_tables,
 count(*) FILTER (WHERE pg_catalog.has_table_privilege(r.oid,c.oid,'TRUNCATE')) AS truncate_tables,
 count(*) FILTER (WHERE pg_catalog.has_table_privilege(r.oid,c.oid,'TRIGGER')) AS trigger_tables,
 count(*) FILTER (WHERE pg_catalog.has_table_privilege(r.oid,c.oid,'REFERENCES')) AS reference_tables,
 count(*) FILTER (WHERE pg_catalog.has_table_privilege(r.oid,c.oid,'MAINTAIN')) AS maintain_tables
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN pg_catalog.pg_roles r
WHERE n.nspname='public' AND c.relkind IN ('r','p')
  AND r.rolname IN ('anon','authenticated','service_role')
GROUP BY r.rolname ORDER BY r.rolname;

-- Preserve this manifest before any revocation. It is a list of SQL texts
-- to restore only ORIGINAL per-table TRUNCATE privileges if approved.
SELECT c.relname AS table_name,pg_catalog.pg_get_userbyid(c.relowner) AS table_owner,
 r.rolname AS recipient,
 pg_catalog.format('GRANT TRUNCATE ON TABLE %I.%I TO %I;',
  n.nspname,c.relname,r.rolname) AS selective_restore_statement
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN pg_catalog.pg_roles r
WHERE n.nspname='public' AND c.relkind IN ('r','p')
  AND r.rolname IN ('anon','authenticated')
  AND pg_catalog.has_table_privilege(r.oid,c.oid,'TRUNCATE')
ORDER BY c.relname,r.rolname;

-- New tables can obtain the same grants from different creating roles.
-- A per-role default setting is NOT modified by REVOKE on existing tables.
SELECT owner.rolname AS creating_role,grantee.rolname AS recipient,
 priv.privilege_type
FROM pg_catalog.pg_default_acl d
JOIN pg_catalog.pg_roles owner ON owner.oid=d.defaclrole
JOIN pg_catalog.pg_namespace n ON n.oid=d.defaclnamespace
CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) priv
JOIN pg_catalog.pg_roles grantee ON grantee.oid=priv.grantee
WHERE n.nspname='public' AND d.defaclobjtype='r'
 AND grantee.rolname IN ('anon','authenticated')
 AND priv.privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES','MAINTAIN')
ORDER BY owner.rolname,grantee.rolname,priv.privilege_type;
