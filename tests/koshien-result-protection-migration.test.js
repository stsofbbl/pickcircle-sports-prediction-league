const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migrationPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260815074000_allow_initial_koshien_result_after_later_phase.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

test("Koshien result protection allows only the first scheduled-to-completed result finalization", () => {
  assert.match(sql, /old\.status = 'scheduled'/);
  assert.match(sql, /new\.status = 'completed'/);
  assert.match(sql, /old\.team1_id is not distinct from new\.team1_id/);
  assert.match(sql, /old\.team2_id is not distinct from new\.team2_id/);
  assert.match(sql, /old\.winner_team_id is null/);
  assert.match(sql, /old\.loser_team_id is null/);
  assert.match(sql, /new\.team1_score <> new\.team2_score/);
  assert.match(sql, /if not v_initial_completion/);
});

test("Koshien result protection still blocks later winner or bracket corrections", () => {
  assert.match(sql, /winner-changing result corrections are locked after a later phase opens/);
  assert.match(sql, /koshien_later_rounds/);
  assert.match(sql, /phase2_drafts/);
  assert.match(sql, /\(old\.winner_team_id, old\.loser_team_id\) is distinct from \(new\.winner_team_id, new\.loser_team_id\)/);
});
