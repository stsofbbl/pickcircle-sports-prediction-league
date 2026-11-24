# Official Koshien integrity — release candidates, not migrations

These SQL files are **not applied to Supabase** and must not be run outside an approved release. The disposable PostgreSQL CI expands the exact files into its transactions. This directory is outside `supabase/migrations`; no automatic migration applies it.

- `import-identity.sql`: add composite parent identity FKs, generated import year/preset, key/source checks, and FK-supporting indexes. Preserves existing RLS, history, and original delete actions. Official JHBF imports require a saved 2020–2035 summer season and Koshien preset. Existing seasonless events are not changed; official imports on them fail closed.
- `schedule-year.sql`: amend only the three existing schedule RPC bodies after their existing event lock and input-shape checks. Match the saved season, source URL and JST date year. Exact production body hashes from 2026-11-25 are preconditions; any drift aborts. Existing security/ACL preserved.
- `rollback-import-identity.sql`: remove only added objects; existing history remains. The schedule rollback is restoration of the exact pre-change definitions in `tests/sql/fixtures/koshien-schedule-production-functions.sql`, after checking live candidate hashes and current ACL/ownership. Never restore over newer changes.

## Release gate
1. Obtain explicit production DB/migration/deploy approval. Check PR head and latest CI; verify candidate plus existing #58 migrations in disposable full-schema environment (not merely fixture).
2. Verify actual DB function definitions/ACLs, existing constraints, valid saved seasons and all import/schedule data. Do not infer legacy season or repair data automatically. Check club/event deletion behavior with full schema, transaction/concurrency and postgrest schema cache. Confirm advisory findings and no unintended grants.
3. Generate versioned migration via Supabase CLI using reviewed SQL; confirm migration order and transaction handling. Do not ship these files as unreviewed ad hoc production SQL. Take a recovery snapshot via approved existing resources; never create paid resources.
4. Deploy in dependency order: DB safeguards and required RPCs first, verify; then Edge Functions (including explicit pin update if needed), verify; then application branch after approval. Keep preview deploys minimal.
5. Run isolated authenticated E2E as admin/member and verify old finalized results/scores unchanged, no duplicate event, strict reload, valid prediction. No real tournament or user data writes without separate approval.

Known gap: direct writes to match dates/results do not pass through schedule RPC validation. The import FKs cover identity, not authenticity of scores or arbitrary date validity. Full-schema club deletion and genuine Supabase browser E2E remain release blockers. Candidate fixture tests alone are insufficient for production approval.
