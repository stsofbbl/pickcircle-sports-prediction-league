const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260818100000_auto_prepare_koshien_zombie.sql"),
  "utf8",
);

test("automatic zombie preparation keeps the public admin RPC permission check", () => {
  assert.match(migration, /create or replace function public\.prepare_koshien_zombie_phase\(/);
  assert.match(migration, /auth\.uid\(\) is null/);
  assert.match(migration, /public\.is_league_admin\(v_league_id\)/);
  assert.match(migration, /league admin permission is required/);
});

test("automatic zombie preparation reuses a private internal setup function", () => {
  assert.match(migration, /prepare_koshien_zombie_phase_internal/);
  assert.match(migration, /returns void/);
  assert.match(migration, /revoke all on function public\.prepare_koshien_zombie_phase_internal[\s\S]*from anon, authenticated, public/);
  assert.match(migration, /perform public\.prepare_koshien_zombie_phase_internal\(new\.event_id, v_opens_at, v_deadline\)/);
});

test("automatic zombie preparation waits for two timed semifinal cards and four distinct teams", () => {
  assert.match(migration, /v_sf_match_count <> 2 or v_sf_timed_count <> 2/);
  assert.match(migration, /v_best4_count <> 4/);
  assert.match(migration, /min\(m\.starts_at\)/);
  assert.match(migration, /v_deadline <= v_opens_at/);
});

test("automatic zombie preparation is idempotent and opens only the newly prepared round", () => {
  assert.match(migration, /phase_key = 'zombie'/);
  assert.match(migration, /status = 'open'/);
  assert.match(migration, /start_mode = 'automatic'/);
  assert.match(migration, /end_mode = 'automatic'/);
  assert.match(migration, /and status = 'ready'/);
  assert.match(migration, /drop trigger if exists auto_prepare_koshien_zombie_from_sf/);
  assert.match(migration, /deferrable initially deferred/);
});
