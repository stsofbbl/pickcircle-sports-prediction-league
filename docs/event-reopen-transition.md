# Exact reopen transition prototype

Production reopen_koshien_results definition and ACL read via catalog SELECT on 2026-11-16. No production RPC call or write.

The prototype keeps existing authentication, Koshien lookup, event lock, admin check, finalized-status/legacy-flow acceptance, prior-event audit and returned payload. Before its existing UPDATE it advances approval revision and inserts a private capability bound to event, transaction, actor, exact OLD/NEW status and resultFlow. The approval trigger consumes only an exact match. It acquires no event lock, and now uses SECURITY DEFINER solely to delete the private capability. No public arbitrary transition issuer exists. The result-write permit is not used.

The existing authenticated/service_role EXECUTE boundary is retained on replacement; anon/PUBLIC remain denied. Isolated roles exercise authenticated/anon only; actual Supabase role/default ACL integration remains required.

Tests cover unauthorized callers, missing/non-finalized events, normal reopen with audit/revision, consumed permit, direct refinalization and repeated reopen rejection, savepoint rollback, late-trigger failure rollback, stale transaction, other actor, wrong target status/flow and successful retry. Fixtures are minimal; stored old transaction ID is not a two-connection race test. No production scoring or complete constraint/trigger reproduction.

Reopen continues existing behavior regardless of prediction deadline; this does not change prediction submission rights. Shared submission/vote tables do not exist yet, so their invalidation is NOT implemented; revision advancement alone is not the completed approval lifecycle.

Next: race reopen against result-save/cancel under the event lock and test legacy flow-only finalized state plus inactive membership. Migration, production deployment and approval UI remain blocked by these and creation/delete/TRUNCATE/config/full-trigger gaps. Restore by reverting this prototype/test commit.
