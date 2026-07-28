const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260728105636_rebuild_koshien_phase1_event.sql"),
  "utf8",
);

test("live Koshien rebuild is event-scoped, exact-49, and rerunnable", () => {
  assert.match(migration, /27dbc2eb-3a6f-4b1a-9d2c-caf05a0b3b2d/);
  assert.match(migration, /2930e8b6-0fe7-45c4-bcf6-edeb8b1407f0/);
  assert.match(migration, /representative_key[\s\S]*?district_key[\s\S]*?49/);
  assert.match(migration, /delete from public\.events[\s\S]*?where id in \(v_old_event_id, v_event_id\)/);
  assert.match(migration, /insert into public\.events[\s\S]*?'open'/);
  assert.match(migration, /insert into public\.event_teams/);
  assert.match(migration, /insert into public\.teams/);
  assert.match(migration, /status = 'open'[\s\S]*?count\(\*\)[\s\S]*?= 49[\s\S]*?return/);
  assert.doesNotMatch(migration, /delete from (public\.)?(leagues|league_members|profiles|auth\.users)/i);
});
