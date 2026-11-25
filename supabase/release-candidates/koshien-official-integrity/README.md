# Official Koshien integrity — release candidates, not migrations

These SQL files are **not applied to Supabase** and must not be run outside an approved release. The disposable PostgreSQL CI expands the exact files into its transactions. This directory is outside `supabase/migrations`; no automatic migration applies it.

- `import-identity.sql`: add composite parent identity FKs, generated import year/preset, key/source checks, and FK-supporting indexes. Preserves existing RLS, history, and original delete actions. Official JHBF imports require a saved 2020–2035 summer season and Koshien preset. Existing seasonless events are not changed; official imports on them fail closed.
- `schedule-year.sql`: amend only the three existing schedule RPC bodies after their existing event lock and input-shape checks. Match the saved season, source URL and JST date year. Exact production body hashes from 2026-11-25 are preconditions; any drift aborts. Existing security/ACL preserved.
- `draft-open-permit.sql`: after the three draft lifecycle migrations, require a one-shot private event/actor/transaction permit for existing Koshien draft→open. The narrowly scoped definer RPC explicitly checks active league admin, event lock, revision and the original readiness trigger. It does not cover legacy direct open INSERT or arbitrary admin edits outside this transition; do not claim all admin mutation paths are closed.
- `rollback-draft-open-permit.sql`: restore the original #58 invoker opening RPC and remove only the permit objects. Reopens the reviewed-revision bypass by design; use only under explicit rollback approval after verifying live definitions. The original readiness trigger remains. CI tests the exact rollback inside a transaction and rolls the probe back.
- `rollback-import-identity.sql`: remove only added objects; existing history remains. The schedule rollback is restoration of the exact pre-change definitions in `tests/sql/fixtures/koshien-schedule-production-functions.sql`, after checking live candidate hashes and current ACL/ownership. Never restore over newer changes.

## Release gate
1. Obtain explicit production DB/migration/deploy approval. Check PR head and latest CI; verify candidate plus existing #58 migrations in disposable full-schema environment (not merely fixture).
2. Verify actual DB function definitions/ACLs, existing constraints, valid saved seasons and all import/schedule data. Do not infer legacy season or repair data automatically. Check club/event deletion behavior with full schema, transaction/concurrency and postgrest schema cache. Confirm advisory findings and no unintended grants.
3. Generate versioned migration via Supabase CLI using reviewed SQL; confirm migration order and transaction handling. Do not ship these files as unreviewed ad hoc production SQL. Take a recovery snapshot via approved existing resources; never create paid resources.
4. Deploy in dependency order: DB safeguards and required RPCs first, verify; then Edge Functions (including explicit pin update if needed), verify; then application branch after approval. Keep preview deploys minimal.
5. Run isolated authenticated E2E as admin/member and verify old finalized results/scores unchanged, no duplicate event, strict reload, valid prediction. No real tournament or user data writes without separate approval.

Known gap: direct writes to match dates/results do not pass through schedule RPC validation. The import FKs cover identity, not authenticity of scores or arbitrary date validity. Full-schema club deletion and genuine Supabase browser E2E remain release blockers. Candidate fixture tests alone are insufficient for production approval.

## Migration history drift (read-only inventory, 2026-11-25 JST)

At branch `8b8150f`, GitHub contained 54 migration files; production history contained 57 recorded migrations. By migration name: 3 exact version matches, 47 same-name entries with different versions, 4 Git-only names and 7 DB-only names. A name match alone does not prove equal SQL. **Never run a bulk `db push`, replay all repo migrations or repair historical versions blindly.** First reconcile history and effective definitions in isolation; do not alter production migration history as part of this PR.

The three PR #58 draft lifecycle SQL files not yet present by name in production history are:
- `20261124100000_guard_koshien_draft_open.sql`
- `20261124110000_keep_open_koshien_rounds_confirmed.sql`
- `20261124120000_keep_confirmed_koshien_start_rounds.sql`

The fourth Git-only name is `allow_cron_automation_secret`; production has `allow_cron_to_read_automation_secret`. This is a prior history discrepancy, not a #58 migration; confirm live privilege rather than replaying it. Do not assume the listed three are absent from effective DB solely from their names; verify definitions/trigger inventory before approved application.

The auto-sync deployment wrapper on the draft branch pins the reviewed worker at `c6ad7ceff3a53f3855c9dd89e08cff45a93f069f`. Existing core override at `2510ca0bc737796d6345420ca806d4f81e72cda2` is retained (identical Git blob to the new worker's core). Deno CI verifies this immutable dependency. Updating the draft pin does not deploy the Edge Function; actual deployment and post-deploy verification remain separate approval gates.
