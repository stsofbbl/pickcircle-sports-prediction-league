const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("later-phase domain loads before the data service and app", () => {
  const domain = html.indexOf("./js/koshien-later-phases.js");
  const service = html.indexOf("./js/data-service.js");
  const application = html.indexOf("./app.js");
  assert.ok(domain >= 0 && domain < service && service < application);
});

test("prediction UI renders only the authenticated viewer later-phase state", () => {
  assert.match(app, /koshienLaterPhaseView\.revenge\?\.eligibility/);
  assert.match(app, /koshienLaterPhaseView\.zombie\?\.eligibility/);
  assert.match(app, /koshienLaterPhaseView\.phase3\?\.prediction/);
  assert.match(app, /data-koshien-revenge-team/);
  assert.match(app, /data-koshien-zombie-team/);
  assert.match(app, /data-koshien-phase3-score="a"/);
  assert.doesNotMatch(app.slice(app.indexOf("function koshienRevengeBlock"), app.indexOf("function koshienPublicPredictions")), /state\.participants\.map/);
});

test("participant saves wait for the official RPC response and reload after errors", () => {
  const start = app.indexOf("async function saveKoshienLaterChoice");
  const end = app.indexOf("async function prepareKoshienLaterPhase", start);
  const handler = app.slice(start, end);
  assert.match(handler, /await service\.saveRevengePick/);
  assert.match(handler, /await service\.saveZombiePrediction/);
  assert.match(handler, /await service\.savePhase3Prediction/);
  assert.match(handler, /applyKoshienLaterPhaseResponse\(response/);
  assert.match(handler, /await refreshKoshienLaterPhaseState/);
  assert.doesNotMatch(handler, /prediction\.revengePick|prediction\.zombiePick|finalScorePrediction/);
});

test("admin can prepare the three official milestones with explicit schedules", () => {
  assert.match(app, /data-koshien-later-prepare="\$\{item\.phase\}"/);
  assert.match(app, /prepareLaterPhase\(\{/);
  assert.match(app, /phase: "best16"/);
  assert.match(app, /phase: "zombie"/);
  assert.match(app, /phase: "phase3"/);
});

test("later-phase admin controls collapse to one column on mobile", () => {
  assert.match(css, /\.koshien-later-admin-grid/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.koshien-later-admin-grid[\s\S]*grid-template-columns:\s*1fr/);
});
