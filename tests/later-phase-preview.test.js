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

test("phase 2 preview renders the specified four-row snake order with crest placeholders", () => {
  const state = preview.createState();
  const markup = preview.renderMarkup(state);

  assert.deepEqual(state.draft.snakeOrder, [
    "takumi", "wada", "ino", "ginji",
    "ginji", "ino", "takumi", "wada",
    "takumi", "wada", "ino", "ginji",
    "ginji", "ino", "takumi", "wada",
  ]);
  assert.equal((markup.match(/class="koshien-preview-draft-round"/g) || []).length, 4);
  assert.equal((markup.match(/class="koshien-preview-school-crest"/g) || []).length, 16);
  assert.match(markup, /data-pick-no="8"[\s\S]*?わだ[\s\S]*?data-pick-no="7"[\s\S]*?たくみ[\s\S]*?data-pick-no="6"[\s\S]*?いの[\s\S]*?data-pick-no="5"[\s\S]*?ぎんじ/);
  assert.match(markup, /data-pick-no="16"[\s\S]*?わだ[\s\S]*?data-pick-no="15"[\s\S]*?たくみ[\s\S]*?data-pick-no="14"[\s\S]*?いの[\s\S]*?data-pick-no="13"[\s\S]*?ぎんじ/);
  assert.doesNotMatch(markup, /の手番です/);
  assert.match(markup, /data-koshien-preview-save="phase2"/);
  assert.match(markup, /data-koshien-preview-reset/);
});

test("only the platform admin can display, open, and operate the preview", () => {
  const platformAdminUid = "d72f73b0-c429-4609-8311-17ae8d8dca85";
  const platformAdminStart = app.indexOf("function isPlatformAdmin");
  const platformAdminEnd = app.indexOf("\n}", platformAdminStart) + 2;
  assert.ok(platformAdminStart >= 0 && platformAdminEnd > platformAdminStart);
  const createPlatformAdminCheck = new Function(
    "isSupabaseAuthEnabled",
    "currentAuthUser",
    `${app.slice(platformAdminStart, platformAdminEnd)}; return isPlatformAdmin;`,
  );
  assert.equal(createPlatformAdminCheck(() => true, () => ({ id: platformAdminUid, clubRole: "member" }))(), true);
  assert.equal(createPlatformAdminCheck(() => true, () => ({ id: "club-owner", clubRole: "owner" }))(), false);
  assert.equal(createPlatformAdminCheck(() => true, () => ({ id: "club-co-owner", clubRole: "co_owner" }))(), false);
  assert.equal(createPlatformAdminCheck(() => false, () => ({ id: platformAdminUid, clubRole: "owner" }))(), false);

  const previewScript = html.indexOf("./js/koshien-later-phase-preview.js");
  const application = html.indexOf("./app.js");
  assert.ok(previewScript >= 0 && previewScript < application);
  assert.match(html, /id="koshienLaterPreviewDialog"/);
  assert.match(html, /UIプレビュー／本番データには保存されません/);

  const launcherStart = app.indexOf("function koshienLaterPreviewLauncher");
  const launcherEnd = app.indexOf("function renderKoshienManagerPanel", launcherStart);
  assert.ok(launcherStart >= 0 && launcherEnd > launcherStart);
  assert.match(app.slice(launcherStart, launcherEnd), /isPlatformAdmin\(\)/);
  assert.doesNotMatch(app.slice(launcherStart, launcherEnd), /isCurrentUserAdmin\(\)/);

  const previewStart = app.indexOf("function openKoshienLaterPreview");
  const previewEnd = app.indexOf("function renderKoshienLaterPreview", previewStart);
  assert.ok(previewStart >= 0 && previewEnd > previewStart);
  assert.match(app.slice(previewStart, previewEnd), /if \(!isPlatformAdmin\(\)\) return/);

  const previewHandlersStart = app.indexOf("function bindKoshienLaterPreview");
  const previewHandlersEnd = app.indexOf("function closeKoshienLaterPreview", previewHandlersStart);
  const previewHandlers = app.slice(previewHandlersStart, previewHandlersEnd);
  assert.match(previewHandlers, /if \(!isPlatformAdmin\(\)\)/);
  assert.match(previewHandlers, /guardPlatformAdmin/);
  assert.doesNotMatch(previewHandlers, /isCurrentUserAdmin\(\)/);
  assert.doesNotMatch(previewHandlers, /YosoDataService|persist\(|saveKoshien|queueKoshienOnlineSave|render\(\)/);
  assert.match(previewHandlers, /YosoKoshienLaterPhases\.validateFinalScore/);
  assert.doesNotMatch(previewSource, /YosoDataService|localStorage|sessionStorage|fetch\(|XMLHttpRequest/);

  const launcherBindingStart = app.indexOf('root.querySelectorAll("[data-koshien-preview-open]")');
  const launcherBindingEnd = app.indexOf('root.querySelectorAll("[data-koshien-later-prepare]")', launcherBindingStart);
  assert.ok(launcherBindingStart >= 0 && launcherBindingEnd > launcherBindingStart);
  assert.match(app.slice(launcherBindingStart, launcherBindingEnd), /isPlatformAdmin\(\)/);
  assert.doesNotMatch(app.slice(launcherBindingStart, launcherBindingEnd), /isCurrentUserAdmin\(\)/);
});

test("preview reuses the existing YOSO cards and has a mobile-safe persistent warning", () => {
  assert.match(previewSource, /koshien-phase2-board/);
  assert.match(previewSource, /koshien-preview-draft-rounds/);
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
  assert.match(css, /\.koshien-preview-draft-row[\s\S]*grid-template-columns:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/);
  const draftRowCss = css.slice(
    css.indexOf(".koshien-preview-draft-row {"),
    css.indexOf(".koshien-preview-draft-card {"),
  );
  assert.doesNotMatch(draftRowCss, /overflow-x:\s*(auto|scroll)/);
});
