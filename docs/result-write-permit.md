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

- Cancellation and automatic import are now included in the gate integration fixtures described below. Full production scoring/advancement triggers remain outside these minimal fixtures.
- Existing child initialization, fallback results UPSERT and deferred advancement/scoring triggers still need compatible entries and full integration tests.
- Event status/rules/preset/league changes, membership races, TRUNCATE grants and role/default privileges remain unresolved. The row triggers do not guard TRUNCATE or prevent changing an event's preset to evade the Koshien check.
- Public submission/voting and UI are unfinished. No production deployment or closure of the overall bypass issue is claimed.

Next: protect event status/rules/preset/league changes and route existing client event writes through a compatible authorized entry. Do not migrate before all writer and event-state gaps are covered.

Rollback: this gate is loaded only inside disposable test transactions and rolled back. Revert the commit to remove the prototype/tests.

## 2026-11-16: cancellation/automatic import integration

The save/cancel concurrency runner installs the gate after seed/authorization checks and before all four real RPC races. The same committed gate remains installed for automatic-import checks and the five service/manual races. Fixture seed/reset operations use an explicit trusted permit inside a transaction and remove that permit/revision before test actions; triggers are never disabled.

Automatic apply now advances revision and issues its permit once, immediately before the first actual match update. It already holds event/revision locks; the issuer reacquires only locks held by the same transaction. The former end-of-batch advance is removed. Failures still roll back the whole batch; skip/block do not issue a permit or increment revision. This avoids granting unversioned write permission on a no-op call. Service execution keeps its original EXECUTE ACL and does not impersonate an auth UID.

Added checks cover failed-batch permit rollback, service permit actor=NULL, no-op permit absence and rejection of direct writes from a fresh connection after every race. Existing races observe actual lock waits and compare revision/match/result/import/audit outcomes on commit and rollback. This is still prototype validation; event-state bypass, TRUNCATE, membership changes and complete production triggers remain release blockers.
