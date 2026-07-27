const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "supabase",
    "migrations",
    "20260727050621_fix_review_club_join_request_ambiguous_conflict.sql",
  ),
  "utf8",
);

test("approval RPC uses the membership primary key as an unambiguous conflict arbiter", () => {
  assert.match(migration, /create or replace function public\.review_club_join_request/i);
  assert.match(migration, /on conflict on constraint league_members_pkey do update/i);
  assert.doesNotMatch(migration, /on conflict\s*\(\s*league_id\s*,\s*user_id\s*\)/i);
});

test("approval RPC keeps authenticated-only execution", () => {
  assert.match(
    migration,
    /revoke all on function public\.review_club_join_request\(uuid, boolean\) from public, anon/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.review_club_join_request\(uuid, boolean\) to authenticated/i,
  );
});
