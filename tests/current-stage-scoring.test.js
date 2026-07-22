const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const migrationPath = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260723012000_use_current_koshien_stage_scoring.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");

test("current-stage scoring distinguishes progress from final placement", () => {
  assert.match(sql, /create or replace function public\.koshien_team_current_stage\(p_event_id text, p_team_id uuid\)/i);
  assert.match(sql, /when 'R1' then 'first_win_then_loss'/i);
  assert.match(sql, /when 'R2' then 'best16'/i);
  assert.match(sql, /when 'R3' then 'best8'/i);
  assert.match(sql, /when 'QF' then 'best4'/i);
  assert.match(sql, /when 'SF' then 'best4'/i);
  assert.match(sql, /when 'F' then 'champion'/i);
  assert.match(sql, /when 'F' then 'runner_up'/i);
});

test("phase 2 uses reached stages without pre-awarding runner-up points", () => {
  assert.match(sql, /when 'best8' then 20/i);
  assert.match(sql, /when 'best4' then 40/i);
  assert.match(sql, /when 'runner_up' then 60/i);
  assert.match(sql, /when 'champion' then 100/i);
  assert.doesNotMatch(sql, /when 'best4' then 60/i);
});

test("phase 1 and revenge use the current-stage helper", () => {
  assert.match(sql, /koshien_arrival_points\(public\.koshien_team_current_stage\(new\.event_id, p1\.team_id\)\)/i);
  assert.match(sql, /case when p1\.captain then 1\.2 else 1 end/i);
  assert.match(sql, /least\(coalesce\(p1\.sqrt_odds_snapshot,[\s\S]*?50\)/i);
  assert.match(sql, /koshien_arrival_points\(public\.koshien_team_current_stage\(new\.event_id, rp\.target_team_id\)\) - 1\.5/i);
});

test("zombie and phase 3 keep final-result semantics", () => {
  assert.match(sql, /public\.koshien_team_finish\(new\.event_id, dp\.team_id\) = 'best4'/i);
  assert.match(sql, /v_phase3 := public\.koshien_phase3_points\(new\.event_id, new\.player_id\)/i);
});

test("one consolidated score trigger replaces the two order-dependent triggers", () => {
  assert.match(sql, /drop trigger if exists scores_recompute_koshien_phase2 on public\.scores/i);
  assert.match(sql, /drop trigger if exists scores_recompute_koshien_later on public\.scores/i);
  assert.match(sql, /create trigger scores_recompute_koshien_current/i);
  assert.match(sql, /'\{scoring_basis\}'[\s\S]*?'current_stage'/i);
});
