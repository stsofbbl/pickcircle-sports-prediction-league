const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(__dirname, "..", "supabase", "migrations", "20260722190000_add_koshien_later_phases.sql");
const rosterMigrationPath = path.join(__dirname, "..", "supabase", "migrations", "20260722193000_scope_best16_to_submitted_roster.sql");
const lifecycleMigrationPath = path.join(__dirname, "..", "supabase", "migrations", "20260722200000_harden_koshien_later_phase_lifecycle.sql");
const triggerPermissionMigrationPath = path.join(__dirname, "..", "supabase", "migrations", "20260722202000_revoke_koshien_trigger_execution.sql");
const progressMigrationPath = path.join(__dirname, "..", "supabase", "migrations", "20260730043742_improve_koshien_later_phase_progress_ui.sql");
const phase3TiebreakMigrationPath = path.join(__dirname, "..", "supabase", "migrations", "20260820065700_add_koshien_phase3_tiebreak_prediction.sql");

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

test("the internal result protection trigger cannot be called as a public RPC", () => {
  const sql = fs.readFileSync(triggerPermissionMigrationPath, "utf8");
  assert.match(sql, /revoke all on function public\.protect_koshien_opened_later_results\(\) from anon, authenticated, public/i);
});

test("later-phase progress migration keeps scheduling and state changes server-owned", () => {
  const sql = fs.readFileSync(progressMigrationPath, "utf8");
  assert.match(sql, /add column if not exists start_mode text/i);
  assert.match(sql, /add column if not exists end_mode text/i);
  assert.match(sql, /create or replace function public\.prepare_koshien_later_phase/i);
  assert.match(sql, /create or replace function public\.update_koshien_later_phase_schedule/i);
  assert.match(sql, /create or replace function public\.get_koshien_later_phase_admin_progress/i);
  assert.match(sql, /public\.is_league_admin\(v_league_id\)/i);
  assert.match(sql, /clock_timestamp\(\)/i);
  assert.match(sql, /p_end_mode = 'automatic'/i);
  assert.match(sql, /revoke all on function public\.update_koshien_later_phase_schedule[\s\S]*from anon, public/i);
  assert.match(sql, /grant execute on function public\.update_koshien_later_phase_schedule[\s\S]*to authenticated/i);
});

test("phase 3 tiebreak migration stores both predictions and scores only the applicable one", () => {
  const sql = fs.readFileSync(phase3TiebreakMigrationPath, "utf8");
  assert.match(sql, /add column if not exists predicted_tiebreak_score_a integer/i);
  assert.match(sql, /add column if not exists predicted_tiebreak_score_b integer/i);
  assert.match(sql, /p_tiebreak_score_a integer/i);
  assert.match(sql, /p_tiebreak_score_b integer/i);
  assert.match(sql, /drop function if exists public\.save_koshien_phase3_prediction\(text, integer, integer, bigint, uuid\)/i);
  assert.match(sql, /jsonb_typeof\(m\.metadata->'used_tiebreak'\) = 'boolean'/i);
  assert.match(sql, /case when v_used_tiebreak then fsp\.predicted_tiebreak_score_a else fsp\.predicted_score_a end/i);
  assert.match(sql, /case when v_used_tiebreak then fsp\.predicted_tiebreak_score_b else fsp\.predicted_score_b end/i);
  assert.match(sql, /revoke all on function public\.save_koshien_phase3_prediction\(text,integer,integer,integer,integer,bigint,uuid\) from anon, public/i);
  assert.match(sql, /grant execute on function public\.save_koshien_phase3_prediction\(text,integer,integer,integer,integer,bigint,uuid\) to authenticated/i);
});

test("open phase deadline changes support extension and shortening without changing picks", () => {
  const sql = fs.readFileSync(progressMigrationPath, "utf8");
  assert.match(sql, /v_round\.status = 'open'[\s\S]*p_opens_at is distinct from v_round\.opens_at/i);
  assert.match(sql, /p_end_mode is distinct from v_round\.end_mode[\s\S]*only the deadline can be changed while reception is open/i);
  assert.match(sql, /deadline_at = case when p_end_mode = 'manual' then 'infinity'::timestamptz else p_deadline_at end/i);
  assert.doesNotMatch(sql, /delete from public\.(phase2_draft_picks|revenge_picks|zombie_predictions|final_score_predictions)/i);
  assert.doesNotMatch(sql, /update public\.scores|update public\.matches/i);
});

test("automatic transitions and participant writes use server time while manual modes remain explicit", () => {
  const sql = fs.readFileSync(progressMigrationPath, "utf8");
  assert.match(sql, /start_mode = 'automatic'[\s\S]*opens_at <= clock_timestamp\(\)/i);
  assert.match(sql, /end_mode = 'automatic'[\s\S]*deadline_at <= clock_timestamp\(\)/i);
  assert.match(sql, /v_round\.end_mode = 'automatic' and clock_timestamp\(\) >= v_round\.deadline_at/i);
  assert.match(sql, /set_config\('yoso\.phase2_rpc', 'manage_schedule', true\)/i);
});

test("phase 2 cannot close before all 16 draft picks are complete", () => {
  const sql = fs.readFileSync(progressMigrationPath, "utf8");
  assert.match(sql, /p_phase_key = 'best16' and not exists[\s\S]*d\.status in \('completed', 'locked'\)[\s\S]*formal phase 2 draft must be completed before lock/i);
  assert.match(sql, /phase_key <> 'revenge'[\s\S]*d\.status in \('completed', 'locked'\)/i);
});

test("repeated prediction request IDs return without mutating saved rows", () => {
  const sql = fs.readFileSync(progressMigrationPath, "utf8");
  assert.match(sql, /create table if not exists public\.koshien_later_prediction_requests/i);
  assert.match(sql, /primary key \(event_id, player_id, phase_key, request_id\)/i);
  assert.match(sql, /alter table public\.koshien_later_prediction_requests enable row level security/i);
  const idempotentReturns = sql.match(/if v_previous_payload is not null then[\s\S]*?return public\.get_koshien_later_phase_state\(p_event_id\);[\s\S]*?end if;/gi) || [];
  assert.equal(idempotentReturns.length, 3);
  assert.match(sql, /select h\.payload into v_previous_payload[\s\S]*if v_round\.status <> 'open'/i);
  assert.match(sql, /revoke all on table public\.koshien_later_prediction_requests from anon, authenticated/i);
});
