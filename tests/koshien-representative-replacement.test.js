const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260728095432_replace_koshien_representatives_atomically.sql"),
  "utf8",
);
const dataService = fs.readFileSync(path.join(__dirname, "../js/data-service.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const importer = fs.readFileSync(path.join(__dirname, "../js/jhbf-result-import.js"), "utf8");

test("representative replacement validates and atomically stores exactly 49 stable schools", () => {
  assert.match(migration, /create or replace function public\.replace_koshien_representatives/);
  assert.match(migration, /replace_koshien_representatives[\s\S]*?security definer[\s\S]*?set search_path = ''/);
  assert.match(migration, /jsonb_array_length\(p_rows\)\s*<>\s*49/);
  assert.match(migration, /representative_count_invalid/);
  assert.match(migration, /representative_districts_invalid/);
  assert.match(migration, /representative_schools_duplicate/);
  assert.match(migration, /district_key/);
  assert.match(migration, /representative_key/);
  assert.match(migration, /delete from public\.event_teams/);
  assert.match(migration, /delete from public\.teams/);
  assert.match(migration, /public\.is_league_admin/);
  assert.match(migration, /security invoker/i);
});

test("phase 1 persistence is event-scoped and enforced by one RPC", () => {
  assert.match(migration, /create or replace function public\.save_koshien_phase1_prediction/);
  assert.match(migration, /v_event\.status\s*<>\s*'open'/);
  assert.match(migration, /coalesce\(cardinality\(p_team_ids\), 0\)\s*<>\s*8/);
  assert.match(migration, /count\(\*\)\s+filter\s*\(where t\.start_round = 2\)/);
  assert.match(migration, /v_second_round_count\s*>\s*3/);
  assert.match(migration, /p_captain_team_id\s*=\s*any\(p_team_ids\)/);
  assert.match(dataService, /save_koshien_phase1_prediction/);
});

test("UI applies representatives and online loads against the selected event", () => {
  assert.match(importer, /replaceRepresentatives/);
  assert.match(importer, /view\.eventId[\s\S]*state\.event\?\.id/);
  assert.match(app, /loadSnapshot\(\{\s*eventId:/);
});

test("phase 1 save passes the displayed event id and shows the RPC error message", () => {
  assert.match(app, /onlineKoshienEventId\s*=\s*String\(eventRow\?\.id/);
  assert.match(app, /displayedEventId\s*=\s*String\(onlineKoshienEventId/);
  assert.match(app, /currentEventId\s*!==\s*displayedEventId[\s\S]*?activeEventId\s*!==\s*displayedEventId/);
  assert.match(app, /saveSnapshot\(\{[\s\S]*?event:\s*state\.event,[\s\S]*?eventId:\s*displayedEventId/);
  assert.match(
    app,
    /data-koshien-phase1-save[\s\S]*?catch \(error\) \{[\s\S]*?setKoshienPhase1Message\(name,\s*error\?\.message/,
  );
});
