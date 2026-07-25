const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const dataService = fs.readFileSync(path.join(__dirname, "..", "js", "data-service.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

test("completed Koshien matches expose a guarded atomic cancel action", () => {
  assert.match(app, /data-koshien-match-cancel/);
  assert.match(app, /async function cancelKoshienMatchResult/);
  assert.match(app, /後半フェーズ[\s\S]*取り消/);
  assert.match(dataService, /cancelKoshienMatchResult/);
  assert.match(dataService, /cancel_koshien_match_result/);
});

test("finalized event results can be reopened by an admin", () => {
  assert.match(app, /data-result-reopen/);
  assert.match(app, /async function reopenFinalizedResults/);
  assert.match(app, /await window\.YosoDataService\.koshien\.reopenKoshienResults/);
  assert.doesNotMatch(app.match(/async function reopenFinalizedResults[\s\S]*?\n}\n/)[0], /saveKoshienOnlineNow/);
  assert.match(app, /resultFlow\.status\s*=\s*"none"/);
  assert.match(app, /state\.event\.status\s*=\s*"resultWait"/);
  assert.match(app, /state\.event\.status\s*=\s*"finalized"/);
});

test("settings include online league administrator management", () => {
  assert.match(html, /id="leagueAdminManager"/);
  assert.match(app, /function renderLeagueAdminManager/);
  assert.match(app, /data-league-admin-toggle/);
  assert.match(dataService, /manageLeagueAdmin/);
  assert.match(dataService, /manage_league_admin/);
});
