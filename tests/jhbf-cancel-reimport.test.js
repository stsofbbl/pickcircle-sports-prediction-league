const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "20260725200000_reopen_canceled_jhbf_imports.sql"),
  "utf8",
);
const correctedImportMigration = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "20260725203000_update_canceled_jhbf_imports.sql"),
  "utf8",
);
const importer = fs.readFileSync(path.join(__dirname, "..", "js", "jhbf-result-import.js"), "utf8");

test("canceling an imported match preserves audit history and allows re-import", () => {
  assert.match(migration, /check \(status in \('confirmed', 'canceled'\)\)/i);
  assert.match(migration, /old\.status = 'completed' and new\.status = 'scheduled'/i);
  assert.match(migration, /set status = 'canceled'/i);
  assert.match(migration, /old\.status = 'scheduled' and new\.status = 'completed'/i);
  assert.match(migration, /set status = 'confirmed'/i);
  assert.match(migration, /normalized_payload->>'winnerTeamId'[\s\S]*new\.winner_team_id/i);
  assert.match(importer, /existingImport && existingImport\.status !== "canceled"/);
});

test("a corrected official result replaces only a canceled import ledger row", () => {
  assert.match(correctedImportMigration, /if v_existing\.status = 'canceled'/i);
  assert.match(correctedImportMigration, /normalized_payload = v_payload/i);
  assert.match(correctedImportMigration, /status = 'confirmed'/i);
  assert.match(correctedImportMigration, /canceled_at = null[\s\S]*canceled_by = null/i);
  assert.match(correctedImportMigration, /saved match does not match external import payload/i);
  assert.match(correctedImportMigration, /external import payload conflict/i);
});
