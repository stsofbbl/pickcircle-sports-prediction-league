const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20260723043000_support_jhbf_import_before_first_result.sql"), "utf8");
const importer = fs.readFileSync(path.join(__dirname, "../js/jhbf-result-import.js"), "utf8");

test("uses the saved result snapshot as match context before structured match rows exist", () => {
  assert.match(migration, /jsonb_array_elements\(coalesce\(r\.payload->'matches'/);
  assert.match(migration, /not exists \(\s*select 1 from public\.matches/s);
  assert.match(migration, /null::uuid as match_id/);
});

test("reloads structured match IDs after saving before recording import audit", () => {
  assert.match(importer, /const savedContext = await loadContext\(view\.eventId\)/);
  assert.match(importer, /if \(!savedMatch\?\.matchId\)/);
  assert.match(importer, /await recordImports\(view\.eventId, auditRows\)/);
});
