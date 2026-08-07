const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const migration = fs.readFileSync(path.join(
  __dirname,
  "../supabase/migrations/20260807111000_add_koshien_official_second_round_slots.sql",
), "utf8");

test("the admin RPC validates exactly 16 R2 matches, 15 starters, and 17 unique R1 feeders", () => {
  assert.match(migration, /register_koshien_official_second_round_slots/);
  assert.match(migration, /jsonb_array_length\(p_matches\)\s*<>\s*16/);
  assert.match(migration, /count\(distinct team_id\)\s*<>\s*15/);
  assert.match(migration, /count\(distinct source_match_no\)\s*<>\s*17/);
  assert.match(migration, /start_round\s*<>\s*2/);
  assert.match(migration, /generate_series\(1, 16\)/);
  assert.match(migration, /generate_series\(1, 17\)/);
});

test("R2 registration protects completed cards and is idempotent", () => {
  assert.match(migration, /completed second-round match cannot be overwritten/);
  assert.match(migration, /different second-round draw is already saved/);
  assert.match(migration, /on conflict \(event_id, round_key, match_no\) do update/);
  assert.match(migration, /where target\.team1_id is distinct from excluded\.team1_id/);
  assert.match(migration, /if v_result\.payload is distinct from v_result_payload then/);
  assert.match(migration, /continue;/);
  assert.match(migration, /'idempotent'/);
});

test("R1 completion synchronizes the official feeder side in matches and results", () => {
  assert.match(migration, /sync_koshien_official_second_round_advancement/);
  assert.match(migration, /new\.round_key = 'R1'/i);
  assert.match(migration, /new\.winner_team_id/);
  assert.match(migration, /team1_source_match_no/);
  assert.match(migration, /team2_source_match_no/);
  assert.match(migration, /case when new\.status = 'completed' then new\.winner_team_id else null end/);
  assert.match(migration, /order by m\.match_no\s+for update/);
  assert.match(migration, /update public\.results/);
  assert.match(migration, /create constraint trigger/);
  assert.match(migration, /deferrable initially deferred/);
});

test("the new database path stays admin-scoped and does not touch scoring or predictions", () => {
  assert.match(migration, /security invoker/);
  assert.match(migration, /public\.is_league_admin/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon/);
  assert.doesNotMatch(migration, /update public\.(teams|events|predictions|scores)/);
  assert.doesNotMatch(migration, /insert into public\.(predictions|scores)/);
});
