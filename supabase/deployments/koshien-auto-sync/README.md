# koshien-auto-sync deployment

This wrapper preserves the deployed v4 worker and its parser dependencies at
`d0736692446a4b6b0cb0ed6e5dcb72e4f0e4f8f6`.
The import map replaces only koshien-auto-sync-core.mjs with the tested
`2510ca0bc737796d6345420ca806d4f81e72cda2` completion guard.

Deploy these index.ts and deno.json as the function's root files, with
import_map_path=deno.json and the existing verify_jwt=false setting.
Authentication remains in the unchanged worker's automation-token check.
No request containing a production automation token is needed for validation.

CI checks this exact wrapper and executes the mapped module's completed/reopened
behavior. The normal repository worker uses the newer schedule parser; this
deployment intentionally retains the previous parser to avoid mixing releases.

Rollback: redeploy the same index.ts with `{"imports":{}}` as deno.json
(the v4 deployment configuration). No data migration or event finalization occurs.
Deployment version/status and observed checks are recorded in PR #46 and Issue #42.
