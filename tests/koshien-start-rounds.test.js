const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260729000000_confirm_koshien_start_rounds.sql"),
  "utf8",
);
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const dataService = fs.readFileSync(path.join(__dirname, "../js/data-service.js"), "utf8");
const importer = fs.readFileSync(path.join(__dirname, "../js/jhbf-result-import.js"), "utf8");

test("start-round confirmation validates the complete official 34/15 draw", () => {
  assert.match(migration, /create or replace function public\.confirm_koshien_start_rounds/);
  assert.match(migration, /confirm_koshien_start_rounds[\s\S]*?security invoker/);
  assert.match(migration, /jsonb_array_length\(p_rows\)\s*<>\s*49/);
  assert.match(migration, /count\(\*\)\s+filter\s*\(where start_round = 1\)[\s\S]*?<>\s*34/);
  assert.match(migration, /count\(\*\)\s+filter\s*\(where start_round = 2\)[\s\S]*?<>\s*15/);
  assert.match(migration, /public\.is_league_admin/);
  assert.match(migration, /startRoundsConfirmed/);
  assert.match(migration, /update public\.teams/);
  assert.match(migration, /update public\.event_teams/);
  assert.match(migration, /grant execute[\s\S]*to authenticated/);
  assert.match(migration, /revoke all[\s\S]*from public, anon/);
  assert.match(migration, /v_event\.status not in \('draft', 'open'\)/);
  assert.match(migration, /clock_timestamp\(\) >= v_event\.prediction_deadline/);
  assert.match(migration, /invalidPredictionCount/);
  assert.doesNotMatch(migration, /existing_phase1_prediction_conflicts_with_start_rounds/);
});

test("representative replacement resets the draw to unconfirmed provisional data", () => {
  assert.match(migration, /rename to replace_koshien_representatives_base/);
  assert.match(migration, /create or replace function public\.replace_koshien_representatives/);
  assert.match(migration, /'startRoundsConfirmed', false/);
  assert.match(migration, /start rounds can no longer be changed/);
});

test("admin and prediction screens distinguish provisional and confirmed rounds", () => {
  assert.match(app, /開始ラウンド未確定/);
  assert.match(app, /data-koshien-start-rounds-save/);
  assert.match(app, /startRoundsConfirmed/);
  assert.match(dataService, /confirm_koshien_start_rounds/);
  assert.match(app, /state\.event\.config\.startRoundsConfirmed = true;[\s\S]*?renderEvent\(\);[\s\S]*?renderScoresOnly\(\);/);
  assert.match(app, /仮・1回戦スタート校/);
  assert.match(app, /仮・2回戦スタート校/);
  assert.match(app, /if \(duplicate \|\| round2Count > 3\)/);
});

test("provisional predictions remain writable and existing picks never block confirmation", () => {
  assert.doesNotMatch(migration, /create or replace function public\.save_koshien_phase1_prediction/);
  assert.doesNotMatch(app, /開始ラウンド確定後に保存/);
  assert.match(migration, /select count\(\*\) into v_invalid_prediction_count[\s\S]*?invalid_predictions/);
});

test("odds updates remain isolated from roster and start-round fields", () => {
  assert.match(migration, /create or replace function public\.update_koshien_odds/);
  assert.match(migration, /jsonb_array_length\(p_rows\) not between 1 and 49/);
  assert.match(migration, /update public\.teams t[\s\S]*?set odds = x\.odds/);
  assert.match(migration, /public\.is_league_admin/);
  assert.match(app, /saveKoshienOdds\(input\.dataset\.koshienTeamOdds\)/);
  assert.match(app, /endsWith\("代表"\)[\s\S]*?slice\(0, -"代表"\.length\)/);
  assert.doesNotMatch(
    migration.match(/create or replace function public\.update_koshien_odds[\s\S]*?end;\n\$\$;/)?.[0] || "",
    /set start_round/,
  );
});

test("backfill does not reopen expired Koshien events as unconfirmed", () => {
  assert.match(migration, /e\.prediction_deadline is null[\s\S]*?clock_timestamp\(\) < e\.prediction_deadline/);
});

test("explicit official rounds are not overwritten by the first-15 fallback", () => {
  assert.doesNotMatch(app, /Number\(current\.startRound\)\s*===\s*2\s*\|\|\s*index\s*<\s*15/);
  assert.doesNotMatch(dataService, /Number\(current\.startRound\)\s*===\s*2\s*\|\|\s*index\s*<\s*15/);
  assert.doesNotMatch(importer, /Number\(previous\.startRound\)\s*===\s*2\s*\|\|\s*index\s*<\s*15/);
});
