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

test("admin cards show progress, schedules, submission status, and state-specific actions", () => {
  assert.match(app, /data-koshien-later-prepare="\$\{item\.phase\}"/);
  assert.match(app, /prepareLaterPhase\(\{/);
  assert.match(app, /phase: "best16"/);
  assert.match(app, /phase: "zombie"/);
  assert.match(app, /phase: "phase3"/);
  assert.match(app, /待機中/);
  assert.match(app, /未準備/);
  assert.match(app, /受付前/);
  assert.match(app, /受付中/);
  assert.match(app, /終了/);
  assert.match(app, /提出状況/);
  assert.match(app, /未提出/);
  assert.match(app, /次に行う操作/);
  assert.match(app, /受付を開始/);
  assert.match(app, /締切日時を変更/);
  assert.match(app, /受付を終了/);
  assert.match(app, /提出内容を確認/);
  assert.match(app, /参加者にはまだ公開されません/);
});

test("admin scheduling uses Japan time and supports manual or automatic start and end", () => {
  assert.match(app, /Asia\/Tokyo/);
  assert.match(app, /data-koshien-later-start-mode/);
  assert.match(app, /data-koshien-later-end-mode/);
  assert.match(app, /手動開始/);
  assert.match(app, /日時で自動開始/);
  assert.match(app, /手動終了/);
  assert.match(app, /日時で自動終了/);
  assert.match(app, /updateLaterPhaseSchedule/);
  const openFields = app.slice(app.indexOf('if (adminState === "open")'), app.indexOf('if (!["unprepared", "before"]', app.indexOf('if (adminState === "open")')));
  assert.doesNotMatch(openFields, /data-koshien-later-end-mode/);
  assert.match(openFields, /data-koshien-later-deadline/);
});

test("participant later-phase cards explain before-open, open, and ended states", () => {
  assert.match(app, /受付開始までお待ちください/);
  assert.match(app, /受付終了/);
  assert.match(app, /締切日時/);
  assert.match(app, /日本時間/);
  assert.match(app, /view\.status === "ready" \|\| receptionRound\?\.status === "ready"/);
  assert.match(app, /提出内容:/);
  assert.match(app, /prediction \? `\$\{prediction\.predicted_score_a\} - \$\{prediction\.predicted_score_b\}` : "未提出"/);
});

test("not-ready persisted rounds remain unprepared in the five-state admin UI", () => {
  const start = app.indexOf("function koshienLaterAdminState");
  const end = app.indexOf("function koshienLaterSubmissionSummary", start);
  assert.match(app.slice(start, end), /round\.status === "not_ready"\) return "unprepared"/);
});

test("an incomplete phase 2 automatic deadline tells the admin to extend instead of showing an unsafe close action", () => {
  assert.match(app, /function koshienLaterDeadlineExpired/);
  assert.match(app, /締切を超過しています。締切を延長し、ドラフト完了後に受付を終了してください。/);
  assert.match(app, /phase2NeedsExtension \? "" : `<button class="primary-button"/);
});

test("admin state is applied only after a successful DB response", () => {
  const start = app.indexOf("async function setKoshienLaterPhaseStatus");
  const end = app.indexOf("function koshienLoadSkipMessage", start);
  const handler = app.slice(start, end);
  assert.match(handler, /await window\.YosoDataService\.koshien\.setLaterPhaseStatus/);
  assert.match(handler, /applyKoshienLaterPhaseResponse\(response/);
  const catchBlock = handler.slice(handler.indexOf("catch"), handler.indexOf("finally"));
  assert.doesNotMatch(catchBlock, /applyKoshienLaterPhaseResponse/);
});

test("later-phase admin controls collapse to one column on mobile", () => {
  assert.match(css, /\.koshien-later-admin-grid/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.koshien-later-admin-grid[\s\S]*grid-template-columns:\s*1fr/);
});
