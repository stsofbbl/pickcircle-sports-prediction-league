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
  assert.match(app, /loadPhase2DraftState\(state\.event\.id\)/);
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
});

test("phase 2 layout has a mobile single-column fallback", () => {
  assert.match(css, /\.koshien-phase2-board/);
  assert.match(css, /\.koshien-phase2-team-grid/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*\.koshien-phase2-team-grid[\s\S]*grid-template-columns:\s*1fr/);
});
