const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20260723040000_add_jhbf_result_import.sql"), "utf8");

test("creates auditable JHBF alias, fetch, and import tables with RLS", () => {
  for (const table of ["external_team_aliases", "external_result_fetches", "external_match_imports"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /unique \(event_id, source, external_key\)/);
  assert.match(migration, /unique \(event_id, source, normalized_external_name\)/);
});

test("enforces admin-only RPCs, cooldown, allowlist, and saved-match verification", () => {
  for (const fn of [
    "request_koshien_external_fetch",
    "complete_koshien_external_fetch",
    "get_koshien_external_import_context",
    "save_koshien_external_team_alias",
    "record_koshien_external_imports",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${fn}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}`));
  }
  assert.match(migration, /interval '5 minutes'/);
  assert.match(migration, /jhbf\\\.or\\\.jp/);
  assert.match(migration, /saved match does not match external import payload/);
  assert.match(migration, /public\.is_league_admin/);
  assert.doesNotMatch(migration, /service_role/i);
});

test("RPCs use caller permissions instead of SECURITY DEFINER", () => {
  const functionBlocks = migration.match(/create or replace function[\s\S]*?\$\$;/g) || [];
  assert.equal(functionBlocks.length, 5);
  functionBlocks.forEach((block) => {
    assert.match(block, /security invoker/i);
    assert.doesNotMatch(block, /security definer/i);
  });
});
