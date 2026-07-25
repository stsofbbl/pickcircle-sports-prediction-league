const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "20260725200000_reopen_canceled_jhbf_imports.sql"),
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
