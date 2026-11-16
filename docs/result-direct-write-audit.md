# Direct result writes: approval-revision blocker

Verified 2026-11-16 against PR #47 head d11ab1d and production catalog (SELECT only).

## Evidence

- authenticated has INSERT/UPDATE/DELETE and TRUNCATE grants on events, matches, results and scores. RLS restricts normal row DML, but is not itself the revision protocol. This audit does not claim anonymous row access.
- events_update_admin checks is_league_admin(league_id) on both old/new rows; it does not reserve status or rules.resultFlow for approval RPCs.
- matches_admin_all and scores_admin_all permit a league admin's row writes. results_update_admin also requires updated_by=auth.uid().
- Catalog triggers include match correction/advancement, import-state sync, score recomputation and result-message stripping; none implements the new prototype revision protocol.
- js/data-service.js (same pinned HEAD), saveKoshienSnapshot: existing event settings directly UPDATE status before result RPC; initial event UPSERT includes rules.resultFlow; no-structured-result fallback directly UPSERTs results. Revoking all DML would break existing application paths.
- save_koshien_result_snapshot is SECURITY INVOKER. Revoking results writes also blocks this RPC. Changing the whole function to SECURITY DEFINER solely to work around that would remove its existing RLS boundary.

## Executable characterization

tests/sql/result-direct-dml-checks.sql runs after the existing save checks in a separate transaction with the existing minimal fixture and actual save prototype. It demonstrates admin direct changes on four relations without revision advancement, member UPDATE filtering, and the revoked-grant RPC failure with atomic rollback.

The assertions labelled KNOWN GAP describe the unsafe current prototype, not the desired future contract. Replace them with rejection assertions as the gate is implemented. UPDATE predicates are copied from catalog; read policies are deliberately simplified. Full production match/score triggers are absent: the score=99 assertion is NOT evidence that production accepts arbitrary scores. No production data was mutated. These tests do not cover deadline changes, concurrent approval or deferred trigger effects.

## Proposed smallest compatible gate (not implemented)

Keep the invoker save function and existing RLS. A private transaction-scoped write permit is a candidate: authorized entry locks event then revision before issuing an event-specific permit. Result-table triggers only verify that permit; they must not acquire event locks after match locks. Permit identity must be server-owned (transaction + event), not a user-settable GUC, role label or caller parameter. Bind both OLD/NEW event IDs or reject reassignment. Rollback must discard the permit/revision together; another transaction must not reuse it.

Before adopting this:
1. Route existing no-result fallback and direct match initialization through authorized, event-first write entry; cover create/delete and deferred advancement triggers.
2. Protect event status/rules/resultFlow separately. Name-only updates must remain compatible; insert, preset/league reassignment, rules replacement and reopening must not bypass approval.
3. Remove unnecessary TRUNCATE grants (RLS does not protect TRUNCATE) after checking role inheritance/default ACLs. This is a separate privilege gap, not a reason to revoke all invoker DML.
4. Test direct writes without permit, forged/stale/cross-event permits, save/cancel/auto paths, rollback, and two-connection contention. Include service_role and all production deferred/scoring triggers before migration.

Next implementation unit: prototype the private transaction permit and direct-write rejection for matches/results/scores, integrate the three existing writer entries, and preserve successful authorized saves in isolated tests.

No migration, runtime change, merge or deployment in this increment. Recovery: revert this test/documentation commit.
