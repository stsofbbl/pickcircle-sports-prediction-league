const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const preview = require(path.join(root, "js/koshien-later-phase-preview.js"));
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const previewSource = fs.readFileSync(path.join(root, "js/koshien-later-phase-preview.js"), "utf8");

test("preview state provides all five later-phase mobile screens with fixed dummy data", () => {
  const state = preview.createState();
  assert.deepEqual(preview.SCREEN_IDS, ["phase2", "revenge", "zombie", "phase3", "results"]);
  assert.equal(state.activeScreen, "phase2");
  assert.equal(state.players.length, 4);
  assert.equal(state.teams.length, 16);
  assert.equal(state.draft.snakeOrder.length, 16);
  assert.equal(state.ranking.length, 4);
});

test("preview interactions update isolated memory state and never require a persistence adapter", () => {
  const state = preview.createState();
  preview.selectScreen(state, "revenge");
  state.revenge.selectedTeamId = state.revenge.allowedTeamIds[0];
  preview.requestSave(state, "revenge");
  preview.confirmSave(state);

  assert.equal(state.activeScreen, "revenge");
  assert.equal(state.revenge.savedTeamId, state.revenge.allowedTeamIds[0]);
  assert.equal(state.pendingAction, null);
  assert.match(state.message, /プレビュー内/);
  assert.equal(preview.selectScreen(state, "unknown"), false);
});

test("phase 2 preview advances the dummy draft without changing the original fixture", () => {
  const first = preview.createState();
  const second = preview.createState();
  const available = preview.availableDraftTeams(first);

  first.draft.selectedTeamId = available[0].teamId;
  preview.requestSave(first, "phase2");
  preview.confirmSave(first);

  assert.equal(first.draft.picks.length, 5);
  assert.equal(first.draft.picks.at(-1).teamId, available[0].teamId);
  assert.equal(second.draft.picks.length, 4);
});

test("admin launcher and preview dialog are present but preview handlers cannot call production saves", () => {
  const previewScript = html.indexOf("./js/koshien-later-phase-preview.js");
  const application = html.indexOf("./app.js");
  assert.ok(previewScript >= 0 && previewScript < application);
  assert.match(html, /id="koshienLaterPreviewDialog"/);
  assert.match(html, /UIプレビュー／本番データには保存されません/);

  const launcherStart = app.indexOf("function koshienLaterPreviewLauncher");
  const launcherEnd = app.indexOf("function renderKoshienManagerPanel", launcherStart);
  assert.ok(launcherStart >= 0 && launcherEnd > launcherStart);
  assert.match(app.slice(launcherStart, launcherEnd), /isCurrentUserAdmin\(\)/);

  const previewStart = app.indexOf("function openKoshienLaterPreview");
  const previewEnd = app.indexOf("function renderKoshienLaterPreview", previewStart);
  assert.ok(previewStart >= 0 && previewEnd > previewStart);
  assert.match(app.slice(previewStart, previewEnd), /if \(!isCurrentUserAdmin\(\)\) return/);

  const previewHandlersStart = app.indexOf("function bindKoshienLaterPreview");
  const previewHandlersEnd = app.indexOf("function closeKoshienLaterPreview", previewHandlersStart);
  const previewHandlers = app.slice(previewHandlersStart, previewHandlersEnd);
  assert.doesNotMatch(previewHandlers, /YosoDataService|persist\(|saveKoshien|queueKoshienOnlineSave|render\(\)/);
  assert.match(previewHandlers, /YosoKoshienLaterPhases\.validateFinalScore/);
  assert.doesNotMatch(previewSource, /YosoDataService|localStorage|sessionStorage|fetch\(|XMLHttpRequest/);
});

test("preview reuses the existing YOSO cards and has a mobile-safe persistent warning", () => {
  assert.match(previewSource, /koshien-phase2-board/);
  assert.match(previewSource, /koshien-phase2-team-grid/);
  assert.match(previewSource, /koshien-later-participant/);
  assert.match(previewSource, /scoreboard/);
  assert.match(previewSource, /data-koshien-preview-save="phase2"/);
  assert.match(previewSource, /data-koshien-preview-save="phase3"/);
  assert.match(previewSource, /data-koshien-preview-detail/);
  assert.match(previewSource, /koshien-preview-confirm-sheet/);
  const state = preview.createState();
  preview.selectScreen(state, "revenge");
  assert.match(preview.renderMarkup(state), /data-koshien-preview-save="revenge"/);
  preview.selectScreen(state, "zombie");
  assert.match(preview.renderMarkup(state), /data-koshien-preview-save="zombie"/);
  assert.match(css, /\.koshien-preview-warning[\s\S]*position:\s*sticky/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.koshien-preview-dialog/);
});
