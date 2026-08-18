const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const guardSource = fs.readFileSync(path.join(__dirname, "../js/jhbf-admin-visibility.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");

test("JHBF result controls are removed from non-admin manager screens", () => {
  assert.match(indexSource, /js\/jhbf-admin-visibility\.js/);
  assert.match(guardSource, /canCurrentUserManageLeague/);
  assert.match(guardSource, /isCurrentUserAdmin/);
  assert.match(guardSource, /\.koshien-jhbf-import/);
  assert.match(guardSource, /panel\.remove\(\)/);
});

test("confirmed zombie status is shown before the final best 4 school is known", () => {
  assert.match(guardSource, /deriveZombiePreEligibility/);
  assert.match(guardSource, /data-koshien-zombie-preconfirmed/);
  assert.match(guardSource, /ゾンビ対象が確定しました/);
  assert.match(guardSource, /ベスト4が4校出揃い次第/);
});

test("early zombie status resolves real snapshots that mix loser UUIDs and school names", () => {
  assert.match(guardSource, /view\?\.eligibleTeams/);
  assert.match(guardSource, /metadata\?\.loser_team_id/);
  assert.match(guardSource, /metadata\?\.loser_name/);
  assert.match(guardSource, /match\?\.loser_id/);
  assert.match(guardSource, /completedLoserTeamIds\(event, view\)/);
});

test("eligible zombie input is also rendered on the Phase 2 screen", () => {
  assert.match(guardSource, /koshienLaterPhaseView\?\.zombie\?\.eligibility/);
  assert.match(guardSource, /eligibility\?\.eligible/);
  assert.match(guardSource, /return `\$\{koshienZombieBlock\(\)\}\$\{draftHtml\}`/);
});
