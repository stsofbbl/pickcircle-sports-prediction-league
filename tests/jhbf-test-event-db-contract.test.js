const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const createMigration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260723060000_add_jhbf_minimal_import_test_event.sql"),
  "utf8",
);
const protectMigration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260723061000_protect_jhbf_test_event_marker.sql"),
  "utf8",
);

test("test event is isolated from the 2026 event and children cascade through event ownership", () => {
  assert.match(createMigration, /v_event_id := 'jhbf-import-test-' \|\| replace\(v_league_id::text, '-', ''\)/);
  assert.match(createMigration, /where e\.id = p_reference_event_id/);
  assert.match(createMigration, /insert into public\.events/);
  assert.match(createMigration, /insert into public\.event_teams/);
  assert.match(createMigration, /insert into public\.teams/);
  assert.match(createMigration, /insert into public\.results/);
  assert.doesNotMatch(createMigration, /update public\.events[\s\S]*p_reference_event_id/);
});

test("test event remains compatible with the existing result and import paths", () => {
  assert.match(createMigration, /'preset_type'[\s\S]*'koshien'|\n\s*'koshien',/);
  assert.match(createMigration, /'status', 'scheduled'/);
  assert.match(createMigration, /'team_a_id', '聖光学院'/);
  assert.match(createMigration, /'team_b_id', '山梨学院'/);
  assert.match(createMigration, /'score_a', ''/);
  assert.match(createMigration, /'score_b', ''/);
  assert.match(protectMigration, /old\.rules->'config'->'testHarness'/);
});
