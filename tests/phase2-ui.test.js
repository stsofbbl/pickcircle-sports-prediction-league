const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("phase 2 domain module loads before the data service and app", () => {
  const domainIndex = html.indexOf("./js/koshien-phase2-draft.js");
  const serviceIndex = html.indexOf("./js/data-service.js");
  const appIndex = html.indexOf("./app.js");
  assert.ok(domainIndex >= 0);
  assert.ok(domainIndex < serviceIndex);
  assert.ok(serviceIndex < appIndex);
});

test("phase 2 UI uses the dedicated DB load and atomic save boundaries", () => {
  assert.match(app, /loadPhase2DraftState\(requestedEventId\)/);
  assert.match(app, /savePhase2DraftPick\(\{/);
  assert.match(app, /YosoKoshienPhase2Draft\.buildDraftViewState/);
  assert.doesNotMatch(app, /data-koshien-draft-pick/);
});

test("phase 2 save waits for DB state and restores latest state on failure", () => {
  const start = app.indexOf("async function confirmKoshienPhase2DraftPick");
  const end = app.indexOf("\nfunction ", start + 20);
  const handler = app.slice(start, end);
  assert.ok(start >= 0);
  assert.match(handler, /await window\.YosoDataService\.koshien\.savePhase2DraftPick/);
  assert.match(handler, /error\?\.latestState/);
  assert.match(handler, /await refreshKoshienPhase2DraftState/);
  assert.doesNotMatch(handler, /phase2DraftPicks\s*=/);
  assert.doesNotMatch(handler, /persist\(|saveSnapshot|saveState\(/);
});

test("phase 2 controls expose pending, ownership, refresh and accessible status", () => {
  assert.match(app, /data-koshien-phase2-confirm/);
  assert.match(app, /data-koshien-phase2-refresh/);
  assert.match(app, /koshienPhase2DraftSaving/);
  assert.match(app, /ownerByTeamId/);
  assert.match(app, /role="status"/);
  assert.match(app, /aria-live="polite"/);
  assert.match(app, /startsBefore/);
  assert.match(app, /開始時刻前のため指名できません/);
});

test("formal DB draft never scores stale display-name keyed local picks", () => {
  assert.match(app, /function koshienFormalPhase2ScoringPending/);
  assert.match(app, /if \(koshienFormalPhase2ScoringPending\(\)\) return 0/);
  assert.match(app, /koshienPhase2DraftView\.formalDraftExists === true/);
  assert.match(app, /koshienPhase2DraftView\.eventId !== currentEventId/);
  assert.match(app, /if \(!isSupabaseAuthEnabled\(\)\) return false/);
  assert.match(app, /旧ローカル指名は正式得点に加算しません/);
});

test("failed conflict reload does not claim that formal state was restored", () => {
  assert.match(app, /最新状態を取得できず、手番は未確認です/);
  assert.match(app, /const restored = koshienPhase2DraftView\.status !== "error"/);
  assert.match(app, /refreshed\.loadedFromDb === true/);
});

test("phase 2 layout has a mobile single-column fallback", () => {
  assert.match(css, /\.koshien-phase2-board/);
  assert.match(css, /\.koshien-phase2-team-grid/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.koshien-phase2-team-grid[\s\S]*grid-template-columns:\s*1fr/);
});
