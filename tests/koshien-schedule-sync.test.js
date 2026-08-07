const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const migration = fs.readFileSync(path.join(
  __dirname,
  "../supabase/migrations/20260808044500_sync_koshien_official_schedule.sql",
), "utf8");
const browser = fs.readFileSync(path.join(__dirname, "../js/koshien-schedule-sync.js"), "utf8");

test("schedule sync RPC is admin-only, validates all 33 R1/R2 slots, and updates starts_at", () => {
  assert.match(migration, /sync_koshien_official_schedule/);
  assert.match(migration, /is_league_admin/);
  assert.match(migration, /jsonb_array_length\(p_rows\) <> 33/);
  assert.match(migration, /schedule must contain R1=17 and R2=16/);
  assert.match(migration, /set starts_at = v_effective_starts_at/);
  assert.match(migration, /results payload schedule slot mismatch/);
  assert.match(migration, /schedule_source_url/);
});

test("browser integration requires 33 official rows and provides manual plus one-time automatic sync", () => {
  assert.match(browser, /normalized\.length !== 33/);
  assert.match(browser, /jhbf-schedule/);
  assert.match(browser, /sync_koshien_official_schedule/);
  assert.match(browser, /公式日程を反映/);
  assert.match(browser, /attemptAutoSync/);
  assert.match(browser, /次戦 \$\{short\}/);
});
