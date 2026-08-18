const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const homeToday = require("../js/home-today-all-phases.js");
const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260819004000_publish_koshien_zombie_infection.sql"),
  "utf8",
);

test("rest day markup is explicit instead of showing a phantom game", () => {
  const html = homeToday.todaysYosoMarkup({
    eventName: "夏の甲子園2026 YOSO",
    phase1Rows: [],
    phase2Rows: [],
    restDay: true,
  });
  assert.match(html, /本日のYOSO/);
  assert.match(html, /本日は休養日です/);
  assert.doesNotMatch(html, /10:30/);
});

test("public zombie status identifies infected team and source", () => {
  const html = homeToday.zombieHeroMarkup([{ team_name: "天理", display_name: "50銭" }]);
  assert.match(html, /ゾンビモード発動/);
  assert.match(html, /ゾンビウイルス感染中/);
  assert.match(html, /天理/);
  assert.match(html, /感染源：50銭/);
});

test("zombie status uses a stable signature and does not restore per-team mutation badges", () => {
  const rows = [{
    player_id: "p1",
    team_id: "t1",
    team_name: "天理",
    updated_at: "2026-08-19T00:00:00Z",
  }];
  assert.equal(homeToday.zombiePublicSignature(rows), homeToday.zombiePublicSignature(rows));
  const source = fs.readFileSync(path.join(__dirname, "../js/home-today-all-phases.js"), "utf8");
  assert.match(source, /existing\?\.dataset\?\.zombiePublicSignature === signature/);
  assert.doesNotMatch(source, /zombie-infected-badge/);
});

test("later phase state publishes only the zombie public prediction summary alongside viewer state", () => {
  assert.match(migration, /'public_predictions'/);
  assert.match(migration, /'display_name', p\.display_name/);
  assert.match(migration, /'team_name', t\.name/);
  assert.match(migration, /where zp\.event_id = p_event_id/);
  assert.match(migration, /and x\.player_id = v_player_id/);
});
