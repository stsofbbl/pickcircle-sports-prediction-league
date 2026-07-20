const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MIGRATION_PATH = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260720050030_align_koshien_match_results.sql",
);

test("Koshien match migration is additive, status-aware, and refreshes PostgREST", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /add column if not exists loser_team_id uuid/i);
  assert.match(sql, /foreign key \(loser_team_id\)[\s\S]*references public\.teams\(id\)[\s\S]*on delete set null/i);
  assert.match(sql, /set status = 'completed'[\s\S]*where status = 'final'/i);
  assert.match(sql, /status in \('scheduled', 'completed'\)/i);
  assert.match(sql, /notify pgrst, 'reload schema'/i);
  assert.match(sql, /c\.conkey = array\[v_status_attnum\]::smallint\[\]/i);
  assert.doesNotMatch(sql, /pg_get_constraintdef[\s\S]*ilike\s+'%status%'/i);
  assert.match(sql, /create or replace function public\.save_koshien_result_snapshot/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /insert into public\.matches[\s\S]*insert into public\.scores[\s\S]*insert into public\.results/i);
  assert.match(sql, /on conflict \(event_id, round_key, match_no\) do update/i);
  assert.match(sql, /on conflict \(event_id, player_id\) do update/i);
  assert.match(sql, /grant execute on function public\.save_koshien_result_snapshot[\s\S]*to authenticated/i);
  assert.match(sql, /not public\.is_league_admin\(v_league_id\)/i);
  assert.match(sql, /item->>'team1_score' !~ '\^\[0-9\]\+\$'/i);
  assert.match(sql, /x\.team1_id = x\.team2_id/i);
  assert.match(sql, /x\.team1_score < 0[\s\S]*x\.team2_score < 0[\s\S]*x\.team1_score = x\.team2_score/i);
  assert.match(sql, /x\.winner_team_id not in \(x\.team1_id, x\.team2_id\)/i);
  assert.match(sql, /x\.team1_score > x\.team2_score[\s\S]*x\.winner_team_id <> x\.team1_id/i);
  assert.doesNotMatch(sql, /drop\s+table|truncate|delete\s+from/i);
  assert.ok(sql.indexOf("drop constraint %I") < sql.indexOf("set status = 'completed'"));
});
