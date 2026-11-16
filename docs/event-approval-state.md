# Approval-state write boundary (prototype)

2026-11-16, based on PR #47 at 4c18707. Not a migration or a deployment candidate.

The current client updates name/status/prediction_deadline directly; initial creation includes rules.resultFlow. The existing identity guard does not reserve finalized or resultFlow. A before/after isolated fixture reproduces admin direct finalization and forged flow data, then installs a fail-closed trigger.

## Implemented boundary

- UPDATE into or out of finalized requires a future authorized transition. Direct resultFlow replacement, nested modification, removal, SQL NULL and JSON null changes are refused.
- Identical finalized/status/flow values remain accepted, including renaming an archived event. Existing non-final status changes and deadline updates are unchanged. This is compatibility, not validation of all state transitions.
- Result writer permits and user-settable session flags do not authorize approval transitions.
- SECURITY INVOKER, empty search_path, no new locks, no public transition function. RLS still handles user/club permissions.

## Required transition design before release

A separate server-only transition entry must lock the event, validate the submission/revision/voter threshold or authorized reopen, and allow only the exact old/new status and resultFlow for that transaction and actor. Do not grant authenticated users an arbitrary target-status/flow setter or reuse begin_result_write. Consume the permission in the same transaction and reject stale/cross-event permissions. Reopen must preserve its audit and invalidate approval/revision atomically.

This prototype deliberately blocks the existing reopen/finalize update until that entry is integrated. Do not deploy it alone. Existing finalized data is not migrated or rewritten.

Creation/UPSERT conflict paths, delete/recreate/TRUNCATE, approvalPolicy/config edits, membership races, full production triggers and two-session state-transition tests remain open. INSERT is not covered by this UPDATE trigger. Client creation must stop treating local votes as server authority. Remaining non-final status transitions are not newly authorized by this work.

Tests use existing minimal fixture + identity guard + permit gate. They cover before/after reproduction, atomic failed update, normal settings across deadline, unchanged finalized rename, result saving without approval authority, and member RLS. The full production schema is not reproduced.

Next: implement the internal exact-transition permission and integrate the existing reopen RPC with audit/revision rollback tests. Recovery: revert this prototype/test commit; no production changes.
