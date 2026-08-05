const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migrationPath = path.join(
  __dirname,
  "../supabase/migrations/20260805130500_add_koshien_official_first_round_matches.sql",
);
const migration = fs.readFileSync(migrationPath, "utf8");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const importer = fs.readFileSync(path.join(__dirname, "../js/jhbf-result-import.js"), "utf8");

test("the admin RPC validates one complete 17-card official first round", () => {
  assert.match(migration, /create or replace function public\.get_koshien_external_import_context/);
  assert.match(migration, /'startRound', t\.start_round/);
  assert.match(migration, /create or replace function public\.register_koshien_official_first_round_matches/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /jsonb_array_length\(p_matches\)\s*<>\s*17/);
  assert.match(migration, /count\(distinct team_id\)\s*<>\s*34/);
  assert.match(migration, /start_round\s*<>\s*1/);
  assert.match(migration, /team does not belong to event or is not a first-round starter/);
  assert.match(migration, /public\.is_league_admin/);
  assert.match(migration, /generate_series\(1, 17\)/);
});

test("the official draw stores its source version and registration actor", () => {
  assert.match(migration, /'source_version'/);
  assert.match(migration, /'registered_by', auth\.uid\(\)/);
  assert.match(migration, /'registered_at'/);
});

test("the import context reads official cards only from public matches", () => {
  const contextFunction = migration.split("create or replace function public.register_koshien_official_first_round_matches")[0];
  assert.match(contextFunction, /from public\.matches m/);
  assert.doesNotMatch(contextFunction, /from public\.results r/);
});

test("the RPC is idempotent and refuses completed or conflicting saved cards", () => {
  assert.match(migration, /completed first-round match cannot be overwritten/);
  assert.match(migration, /different first-round draw is already saved/);
  assert.match(migration, /on conflict \(event_id, round_key, match_no\) do nothing/);
  assert.match(migration, /'idempotent'/);
});

test("the RPC writes only matches and the matching results payload slots", () => {
  assert.match(migration, /insert into public\.matches/);
  assert.match(migration, /update public\.results/);
  assert.match(migration, /jsonb_set/);
  assert.doesNotMatch(migration, /update public\.(teams|events|predictions|scores)/);
  assert.doesNotMatch(migration, /insert into public\.(predictions|scores)/);
});

test("the RPC remains admin-only and does not weaken existing RLS", () => {
  assert.match(migration, /revoke all on function[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated/);
});

test("official results prefill the existing manual editor and use its save button", () => {
  assert.match(app, /data-koshien-match-team=/);
  assert.match(app, /data-koshien-match-score=/);
  assert.match(app, /data-koshien-match-save=/);
  assert.match(app, /recordPendingImportForMatch/);
  assert.match(importer, /data-jhbf-prefill/);
  assert.match(importer, /prefillOfficialResult/);
});
