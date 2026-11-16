# Result writer permit prototype

2026-11-16; extends the direct-DML audit at ea4e982. Prototype only, not a migration.

## Implemented and scope

- Private write_permits has one row per event, bound to PostgreSQL transaction ID and auth.uid(). No client table or issuer EXECUTE grants. RLS enabled with no client policies.
- The authorized begin_result_write entry locks event then revision, re-reads league ownership after waiting, advances revision and issues a permit. The existing save RPC remains SECURITY INVOKER and retains its RLS.
- BEFORE INSERT/UPDATE/DELETE triggers on matches/results/scores check permits without acquiring an event lock after a child row lock. Missing events and event reassignment are rejected. Other presets retain ordinary row behavior except event reassignment.
- Permits and revision are in the same transaction as writes, so errors/savepoint rollback discard them. A committed permit is stale in another transaction; the next authorized entry replaces it. No cleanup job or unbounded per-transaction history is introduced.
- This permission means "authorized event-first write transaction", not "only this SQL function may write". After begin_result_write, additional same-event writes in that transaction are permitted and covered by the advanced revision.

## Verification

The existing isolated runner executes a third transaction with fixture, actual save prototype, permit prototype and focused checks. Covers direct insertion on each table, issuer/table access denial, ignored fake GUC, normal match/result/score saving, invalid-payload rollback, stale transaction/other actor/cross-event rejection, deletes, reassignment, savepoint rollback, member/anon denial and late-stage RLS rejection. Stale transaction tests deliberately replace the stored ID; they are not a two-connection concurrency test. Existing save tests continue to cover prediction-deadline semantics unchanged.

## Unresolved release gates

- Cancellation and automatic import have NOT been installed/tested with this gate. The cancel entry already calls begin_result_write, but this is not an integration claim. Automatic import must explicitly issue a permit after its event/revision locks, before child writes, while preserving skip/block no-increment behavior.
- Existing child initialization, fallback results UPSERT and deferred advancement/scoring triggers still need compatible entries and full integration tests.
- Event status/rules/preset/league changes, membership races, TRUNCATE grants and role/default privileges remain unresolved. The row triggers do not guard TRUNCATE or prevent changing an event's preset to evade the Koshien check.
- Public submission/voting and UI are unfinished. No production deployment or closure of the overall bypass issue is claimed.

Next: install this gate in the existing cancellation/automatic-import integration fixtures, add the automatic writer permit, and run existing two-session races through the gate. Do not migrate before all writer and event-state gaps are covered.

Rollback: this gate is loaded only inside disposable test transactions and rolled back. Revert the commit to remove the prototype/tests.
