# Official Koshien integrity — release candidates, not migrations

These SQL files are **not applied to Supabase** and must not be run outside an approved release. The disposable PostgreSQL CI expands the exact files into its transactions. This directory is outside `supabase/migrations`; no automatic migration applies it.

- `import-identity.sql`: add composite parent identity FKs, generated import year/preset, key/source checks, and FK-supporting indexes. Preserves existing RLS, history, and original delete actions. Official JHBF imports require a saved 2020–2035 summer season and Koshien preset. Existing seasonless events are not changed; official imports on them fail closed.
- `schedule-year.sql`: amend only the three existing schedule RPC bodies after their existing event lock and input-shape checks. Match the saved season, source URL and JST date year. Exact production body hashes from 2026-11-25 are preconditions; any drift aborts. Existing security/ACL preserved.
- `draft-open-permit.sql`: after the three draft lifecycle migrations, require a one-shot private event/actor/transaction permit for existing Koshien draft→open. The narrowly scoped definer RPC explicitly checks active league admin, event lock, revision and the original readiness trigger. It does not cover legacy direct open INSERT or arbitrary admin edits outside this transition; do not claim all admin mutation paths are closed.
- `rollback-draft-open-permit.sql`: restore the original #58 invoker opening RPC and remove only the permit objects. Reopens the reviewed-revision bypass by design; use only under explicit rollback approval after verifying live definitions. The original readiness trigger remains. CI tests the exact rollback inside a transaction and rolls the probe back.
- `rollback-import-identity.sql`: remove only added objects; existing history remains. The schedule rollback is `rollback-schedule-year.sql`, which reverses only the exact injected block and checks the reviewed original body hashes; it preserves the current function identity/ACL/security settings and refuses source drift. Never restore over newer changes.

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

## Local Auth integration
The disposable GitHub Actions HTTP fixture additionally starts a version-pinned GoTrue container and a separate empty Auth database on loopback, sharing only a freshly generated JWT secret with local PostgREST. The app uses the existing SDK and data service. Synthetic users are mapped to fixture memberships; no real email, cloud service, user data or production secrets. This checks actual password login, refresh, persisted sessions, authorization and logout, not production Auth configuration, OAuth, email verification or a full production schema. Stop and report any failed test; never substitute production writes.

## Production FK graph compatibility
The dedicated disposable graph fixture captures the live catalog's 70 public foreign keys and participating primary/unique keys, column types/nullability, club deletion/owner RPCs and five existing finalized child guards. Two synthetic clubs exercise the exact import identity candidate against the same baseline graph. This is not a complete schema clone: non-key columns, additional constraints/indexes and non-delete triggers are omitted. Any pre-existing deletion rejection is recorded, never repaired by silently weakening history protection.

## Read-only preflight
Run `preflight.sql` immediately before any explicitly approved release. All seven rows must be true: exact FK graph fingerprint, three schedule RPC bodies and effective ACLs, import identity, JST schedule year, explicit saved seasons, candidate-object collision check and private schema privileges. This SQL was executed against production in a read-only transaction on 2026-11-25 JST. It reports aggregates only; it is not a migration, does not repair data/history and does not authorize release. If any check changes, stop and review the reason. It is intentionally valid only before the #58 DB changes, not after them.

## Release execution order (approval required)
- Pin reviewed PR head and successful CI, confirm production branch still matches PR base. The observed live Vercel deployment is `dpl_FjsiVGYdCafxUo96d7N6ow72axJ4` (commit `6db64bf4417aa0a8f34634354eb42e9ea636c6d2`); refresh before any rollout. Live Edge versions observed: jhbf-schedule v1 (JWT verification true), jhbf-results v6 (true), koshien-auto-sync v5 (false; existing cron secret authorization). Capture actual deployed function source/configuration for rollback without printing secrets.
- Stop on unverified backup/recovery capability, unexpected traffic or schema drift. Run read-only preflight and `data-fingerprint.sql` before DB changes; keep counts/digests in restricted release notes. Avoid concurrent writes during the approved release window. Fingerprints are evidence of equality, not a backup.
- Apply only the three named lifecycle migrations, then draft-open-permit, import-identity and schedule-year as explicitly reviewed versioned migrations. Do not use bulk db push or repair migration history. Check transaction boundaries and lock timeout before applying. Generate formal filenames with the CLI; no automatic schema changes in this branch.
- Verify added constraints/triggers and effective permissions, compare all nine business table fingerprints before any new test writes, then deploy the three Edge functions preserving their current JWT settings. Stop if any gate fails. Release the approved application branch last and confirm Vercel commit/production alias and live smoke test.
- For an application regression, roll back the application deployment first; revert Edge source/config if needed. Prefer retaining compatible DB protections; DB rollback needs separate explicit approval and must never delete tournament data or overwrite a later function edit. Import/permit/schedule rollback candidates are independently tested; reverting the three lifecycle migrations is a separate reviewed change, not an automatic action. Do not assume Vercel rollback also rolls back DB or Edge Functions.
