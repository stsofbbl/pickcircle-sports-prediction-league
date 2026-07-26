const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.join(__dirname, "..", "supabase", "migrations", "20260723130000_add_admin_recovery_controls.sql"),
  "utf8",
);

test("admin role management is authenticated, league-scoped, and preserves a final admin", () => {
  assert.match(migration, /create or replace function public\.manage_league_admin/i);
  assert.match(migration, /auth\.uid\(\) is null/i);
  assert.match(migration, /public\.is_league_admin\(p_league_id\)/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /count\(\*\)[\s\S]*role = 'admin'/i);
  assert.match(migration, /last league admin cannot be removed/i);
  assert.match(migration, /create trigger protect_last_league_admin/i);
  assert.match(migration, /update public\.players[\s\S]*is_admin = p_make_admin/i);
  assert.match(migration, /revoke all on function public\.manage_league_admin/i);
  assert.match(migration, /grant execute on function public\.manage_league_admin[\s\S]*to authenticated/i);
  assert.doesNotMatch(migration, /service_role/i);
});

test("direct league-member role writes are replaced by the guarded RPC", () => {
  assert.match(migration, /drop policy if exists league_members_update_admin/i);
  assert.match(migration, /revoke update on public\.league_members from authenticated/i);
  assert.match(migration, /security definer/i);
  assert.match(migration, /set search_path = ''/i);
});

test("match result cancellation is atomic, audited, and blocks invalid downstream rewrites", () => {
  assert.match(migration, /create table if not exists public\.koshien_result_cancellations/i);
  assert.match(migration, /create or replace function public\.cancel_koshien_match_result/i);
  assert.match(migration, /status = 'scheduled'/i);
  assert.match(migration, /team1_score = null[\s\S]*winner_team_id = null[\s\S]*loser_team_id = null/i);
  assert.match(migration, /phase2_drafts[\s\S]*downstream phase is already prepared/i);
  assert.match(migration, /insert into public\.scores/i);
  assert.match(migration, /insert into public\.results/i);
  assert.match(migration, /insert into public\.koshien_result_cancellations/i);
  assert.match(migration, /grant execute on function public\.cancel_koshien_match_result[\s\S]*to authenticated/i);
});
