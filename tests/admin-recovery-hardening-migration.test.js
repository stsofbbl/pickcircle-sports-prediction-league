const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "20260725190000_harden_admin_recovery_controls.sql"),
  "utf8",
);

test("a completed downstream match blocks cancellation of its feeder result", () => {
  assert.match(migration, /create trigger protect_completed_koshien_downstream_result/i);
  assert.match(migration, /old\.winner_team_id in \(downstream\.team1_id, downstream\.team2_id\)/i);
  assert.match(migration, /downstream\.status = 'completed'/i);
  assert.match(migration, /dependent completed match exists/i);
});

test("event result reopen is one authenticated locked and audited transaction", () => {
  assert.match(migration, /create table if not exists public\.koshien_result_reopens/i);
  assert.match(migration, /create or replace function public\.reopen_koshien_results/i);
  assert.match(migration, /auth\.uid\(\) is null/i);
  assert.match(migration, /public\.is_league_admin\(v_event\.league_id\)/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /insert into public\.koshien_result_reopens/i);
  assert.match(migration, /set status = 'resultWait'[\s\S]*jsonb_set/i);
  assert.match(migration, /grant execute on function public\.reopen_koshien_results\(text\) to authenticated/i);
});
