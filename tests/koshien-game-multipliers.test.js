const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "../supabase/migrations/20260729120000_add_koshien_game_multipliers.sql",
);
const migration = fs.existsSync(migrationPath) ? fs.readFileSync(migrationPath, "utf8") : "";
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const dataService = fs.readFileSync(path.join(__dirname, "../js/data-service.js"), "utf8");

test("database stores only valid optional game multipliers and exposes one admin-only 49-school save", () => {
  assert.match(migration, /add column if not exists game_multiplier numeric\(10,\s*4\)/i);
  assert.match(migration, /game_multiplier is null or \(game_multiplier > 0 and game_multiplier <= 50\)/i);
  assert.match(migration, /create or replace function public\.update_koshien_game_multipliers/i);
  assert.match(migration, /jsonb_array_length\(p_rows\)\s*<>\s*49/i);
  assert.match(migration, /public\.is_league_admin\(v_event\.league_id\)/i);
  assert.match(migration, /v_event\.status not in \('draft', 'open'\)/i);
  assert.match(migration, /clock_timestamp\(\) >= v_event\.prediction_deadline/i);
  assert.match(migration, /x\.game_multiplier is not null[\s\S]*?x\.game_multiplier <= 0[\s\S]*?x\.game_multiplier > 50/i);
  assert.match(migration, /update public\.teams t[\s\S]*?set game_multiplier = x\.game_multiplier/i);
  assert.match(migration, /update public\.scores s[\s\S]*?set updated_at = now\(\)[\s\S]*?where s\.event_id = p_event_id/i);
  assert.match(migration, /grant execute on function public\.update_koshien_game_multipliers\(text, jsonb\) to authenticated/i);
  assert.match(migration, /revoke all on function public\.update_koshien_game_multipliers\(text, jsonb\) from public, anon/i);
});

test("phase-one database scoring uses the stored team multiplier", () => {
  assert.match(migration, /koshien_arrival_points\(public\.koshien_team_current_stage\(new\.event_id, p1\.team_id\)\)[\s\S]*?coalesce\(t\.game_multiplier,\s*0\)/i);
  const scoringFunction = migration.match(
    /create or replace function public\.recompute_koshien_current_scores\(\)[\s\S]*?end;\n\$\$;/i,
  )?.[0] || "";
  const phase1Scoring = scoringFunction.slice(
    scoringFunction.indexOf("select coalesce(sum("),
    scoringFunction.indexOf("if exists (", scoringFunction.indexOf("select coalesce(sum(")),
  );
  assert.doesNotMatch(phase1Scoring, /p1\.sqrt_odds_snapshot|sqrt\(p1\.odds_snapshot\)|t\.sqrt_odds/i);
});

test("admin edits and saves the complete 49-school multiplier list", () => {
  assert.match(app, /data-koshien-game-multiplier=/);
  assert.match(app, /data-koshien-game-multipliers-save/);
  assert.match(app, /saveKoshienGameMultipliers/);
  assert.match(dataService, /update_koshien_game_multipliers/);
  assert.match(dataService, /normalizedRows\.length !== 49/);
});

test("phase-one choices show a saved multiplier or the explicit unset state", () => {
  assert.match(app, /gameMultiplier[^]*?倍率未設定/);
  assert.match(app, /`\$\{team\}（\$\{formatScore\(gameMultiplier\)\}倍）`/);
});
