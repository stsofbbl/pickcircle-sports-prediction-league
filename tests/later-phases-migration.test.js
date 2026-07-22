const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(__dirname, "..", "supabase", "migrations", "20260722190000_add_koshien_later_phases.sql");
const rosterMigrationPath = path.join(__dirname, "..", "supabase", "migrations", "20260722193000_scope_best16_to_submitted_roster.sql");
const lifecycleMigrationPath = path.join(__dirname, "..", "supabase", "migrations", "20260722200000_harden_koshien_later_phase_lifecycle.sql");

test("later-phase migration provides server-owned round snapshots and authenticated RPC writes", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /create table if not exists public\.koshien_later_rounds/i);
  assert.match(sql, /unique \(event_id, phase_key\)/i);
  assert.match(sql, /create table if not exists public\.koshien_revenge_eligibility/i);
  assert.match(sql, /create table if not exists public\.koshien_zombie_eligibility/i);
  assert.match(sql, /create or replace function public\.get_koshien_later_phase_state/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /clock_timestamp\(\) >= v_round\.deadline_at/i);
  assert.match(sql, /revoke execute on function public\.save_koshien_revenge_pick[\s\S]*from anon, public/i);
  assert.match(sql, /revoke execute on function public\.save_koshien_zombie_prediction[\s\S]*from anon, public/i);
  assert.match(sql, /revoke execute on function public\.save_koshien_phase3_prediction[\s\S]*from anon, public/i);
});

test("best 16 preparation ignores non-playing profiles and requires exactly eight phase 1 picks", () => {
  const sql = fs.readFileSync(rosterMigrationPath, "utf8");
  assert.match(sql, /public\.phase1_picks roster/);
  assert.match(sql, /roster\.event_id = p_event_id/);
  assert.match(sql, /roster\.player_id = p\.id\) = 8/);
  assert.match(sql, /roster2\.player_id = p2\.id\) = 8/);
});

test("admin preparation derives official best 16, best 4, and fixed finalists by team ID", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /create or replace function public\.prepare_koshien_best16_phases/i);
  assert.match(sql, /m\.round_key = 'R3'/i);
  assert.match(sql, /create or replace function public\.prepare_koshien_zombie_phase/i);
  assert.match(sql, /m\.round_key = 'SF'/i);
  assert.match(sql, /create or replace function public\.prepare_koshien_phase3/i);
  assert.match(sql, /m\.round_key = 'F'/i);
  assert.doesNotMatch(sql, /display_name\s*=/i);
  assert.doesNotMatch(sql, /md5\(p_event_id/i);
  assert.match(sql, /random\(\) as tie_key/i);
  assert.match(sql, /p_event_id, 'revenge', 'ready'/i);
  assert.match(sql, /p_event_id, 'zombie', 'ready'/i);
  assert.match(sql, /p_event_id, 'phase3', 'ready'/i);
  assert.match(sql, /zombieEnabled/i);
});

test("official score recomputation includes revenge baseline, zombie owner adjustment, and phase 3 nearest rule", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");
  assert.match(sql, /greatest\(0, public\.koshien_arrival_points\(public\.koshien_team_finish\([^)]+\)\) - 1\.5\)/i);
  assert.match(sql, /when count\(\*\) >= 2 then -40/i);
  assert.match(sql, /when count\(\*\) = 1 then -20/i);
  assert.match(sql, /create or replace function public\.koshien_phase3_points/i);
  assert.match(sql, /abs\(fsp\.predicted_score_a - v_score_a\) \+ abs\(fsp\.predicted_score_b - v_score_b\)/i);
});

test("later phases have explicit prepare open lock scheduling and result correction protection", () => {
  const sql = fs.readFileSync(lifecycleMigrationPath, "utf8");
  assert.match(sql, /random\(\) as tie_key/i);
  assert.match(sql, /create or replace function public\.refresh_koshien_phase_schedule/i);
  assert.match(sql, /create or replace function public\.set_koshien_later_phase_status/i);
  assert.match(sql, /p_action not in \('open','lock'\)/i);
  assert.match(sql, /formal phase 2 draft must be completed before lock/i);
  assert.match(sql, /zombieEnabled/i);
  assert.match(sql, /winner-changing result corrections are locked/i);
  assert.match(sql, /exactly four submitted players are required/i);
});
