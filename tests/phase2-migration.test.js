const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MIGRATION_PATH = path.join(
  __dirname,
  "..",
  "supabase",
  "migrations",
  "20260721023204_add_koshien_phase2_draft_foundation.sql",
);

test("phase 2 migration is additive, guarded, and explicitly exposed only to authenticated users", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /^begin;/i);
  assert.match(sql, /commit;\s*$/i);
  assert.match(sql, /create table if not exists public\.phase2_drafts/i);
  assert.match(sql, /alter table public\.phase2_drafts enable row level security/i);
  assert.match(sql, /alter table public\.phase2_draft_picks add column if not exists draft_id uuid/i);
  assert.match(sql, /alter table public\.phase2_draft_picks add column if not exists pick_no integer/i);
  assert.match(sql, /alter table public\.phase2_draft_picks add column if not exists request_id uuid/i);
  assert.match(sql, /phase2_draft_picks contains existing rows that require a reviewed conversion migration/i);
  assert.match(sql, /alter column draft_id set not null/i);
  assert.match(sql, /alter column pick_no set not null/i);
  assert.match(sql, /alter column request_id set not null/i);
  assert.match(sql, /grant select, update on public\.phase2_drafts to authenticated/i);
  assert.match(sql, /grant select, insert on public\.phase2_draft_picks to authenticated/i);
  assert.doesNotMatch(sql, /grant[^;]+to anon/i);
  assert.doesNotMatch(sql, /drop\s+table|truncate|delete\s+from/i);
});

test("phase 2 schema enforces 4 players, 16 teams, pick uniqueness, and ID references", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /cardinality\(ordered_player_ids\) = 4/i);
  assert.match(sql, /cardinality\(eligible_team_ids\) = 16/i);
  assert.match(sql, /public\.uuid_array_is_unique\(ordered_player_ids\)/i);
  assert.match(sql, /public\.uuid_array_is_unique\(eligible_team_ids\)/i);
  assert.match(sql, /unique \(event_id\)/i);
  assert.match(sql, /unique \(draft_id, pick_no\)/i);
  assert.match(sql, /unique \(draft_id, team_id\)/i);
  assert.match(sql, /unique \(draft_id, player_id, draft_round\)/i);
  assert.match(sql, /unique \(draft_id, player_id, request_id\)/i);
  assert.match(sql, /pick_no between 1 and 16/i);
  assert.match(sql, /draft_round between 1 and 4/i);
  assert.match(sql, /foreign key \(draft_id\)[\s\S]*references public\.phase2_drafts\(id\)/i);
  assert.match(sql, /foreign key \(event_id\)[\s\S]*references public\.events\(id\)/i);
  assert.match(sql, /foreign key \(player_id\)[\s\S]*references public\.players\(id\)/i);
  assert.match(sql, /foreign key \(team_id\)[\s\S]*references public\.teams\(id\)/i);
  assert.match(sql, /create or replace function public\.validate_koshien_phase2_draft_setup/i);
  assert.match(sql, /p\.league_id = v_league_id[\s\S]*p\.id = any \(new\.ordered_player_ids\)/i);
  assert.match(sql, /t\.event_id = new\.event_id[\s\S]*t\.id = any \(new\.eligible_team_ids\)/i);
  assert.match(sql, /cannot change fixed phase 2 draft setup after ready/i);
  assert.match(sql, /create trigger phase2_drafts_validate_setup/i);
});

test("atomic pick RPC locks, resolves auth player, validates turn, and advances only in one transaction", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /create or replace function public\.save_koshien_phase2_draft_pick\(\s*p_draft_id uuid,\s*p_team_id uuid,\s*p_expected_pick_no integer,\s*p_request_id uuid/i);
  assert.doesNotMatch(sql, /save_koshien_phase2_draft_pick\([^)]*p_player_id/i);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /set search_path = ''/i);
  assert.match(sql, /if auth\.uid\(\) is null/i);
  assert.match(sql, /from public\.phase2_drafts d[\s\S]*for update/i);
  assert.match(sql, /p\.profile_id = auth\.uid\(\)/i);
  assert.match(sql, /v_draft\.status <> 'drafting'/i);
  assert.match(sql, /clock_timestamp\(\) >= v_draft\.deadline_at/i);
  assert.match(sql, /p_expected_pick_no <> v_draft\.current_pick_no/i);
  assert.match(sql, /p_team_id = any \(v_draft\.eligible_team_ids\)/i);
  assert.match(sql, /insert into public\.phase2_draft_picks/i);
  assert.match(sql, /set current_pick_no = case/i);
  assert.match(sql, /status = case[\s\S]*then 'completed'/i);
  assert.match(sql, /set_config\('yoso\.phase2_rpc', 'save_pick', true\)/i);
  assert.ok(
    sql.indexOf("set_config('yoso.phase2_rpc', 'save_pick', true)") < sql.indexOf("for update;"),
    "RPC RLS context must be set before SELECT FOR UPDATE",
  );
  assert.doesNotMatch(sql, /public\.predictions|results\.payload/i);
});

test("RLS and function privileges exclude anon and direct phase 2 writes", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /drop policy if exists phase2_draft_picks_self_before_deadline/i);
  assert.match(sql, /create policy phase2_drafts_select_members[\s\S]*to authenticated/i);
  assert.match(sql, /create policy phase2_draft_picks_select_members[\s\S]*to authenticated/i);
  assert.match(sql, /create policy phase2_draft_picks_rpc_insert[\s\S]*current_setting\('yoso\.phase2_rpc', true\) = 'save_pick'/i);
  assert.match(sql, /create policy phase2_drafts_rpc_update[\s\S]*current_setting\('yoso\.phase2_rpc', true\) = 'save_pick'/i);
  assert.match(sql, /revoke execute on function public\.save_koshien_phase2_draft_pick[\s\S]*from anon, public/i);
  assert.match(sql, /grant execute on function public\.save_koshien_phase2_draft_pick[\s\S]*to authenticated/i);
  assert.match(sql, /revoke execute on function public\.get_koshien_phase2_draft_state[\s\S]*from anon, public/i);
  assert.match(sql, /grant execute on function public\.get_koshien_phase2_draft_state[\s\S]*to authenticated/i);
  assert.match(sql, /grant execute on function public\.is_league_member\(uuid\) to authenticated/i);
});

test("ready state freezes the draw snapshot and only allows forward transitions", () => {
  const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
  assert.match(sql, /create or replace function public\.koshien_phase2_ranking_snapshot_is_valid/i);
  assert.match(sql, /resolved_order_player_ids/i);
  assert.match(sql, /phase1_score/i);
  assert.match(sql, /v_players_valid is not true/i);
  assert.match(sql, /is not true then[\s\S]*ranking_snapshot must contain/i);
  assert.match(sql, /v_has_ties[\s\S]*jsonb_array_length\(p_snapshot -> 'tie_draws'\) = 0/i);
  assert.match(sql, /old\.status <> 'not_ready'[\s\S]*ranking_snapshot is distinct from new\.ranking_snapshot/i);
  assert.match(sql, /old\.status = 'not_ready' and new\.status = 'ready'/i);
  assert.match(sql, /old\.status = 'ready' and new\.status = 'drafting'/i);
  assert.match(sql, /old\.status = 'drafting' and new\.status = 'completed'/i);
  assert.match(sql, /old\.status = 'completed' and new\.status = 'locked'/i);
  assert.match(sql, /completed phase 2 draft requires exactly sixteen picks/i);
  assert.match(sql, /new\.version := old\.version \+ 1/i);
});
