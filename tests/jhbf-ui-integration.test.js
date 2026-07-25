const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const moduleSource = fs.readFileSync(path.join(__dirname, "../js/jhbf-result-import.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");

test("admin manager loads the semi-automatic JHBF result module", () => {
  assert.match(indexSource, /js\/jhbf-result-import\.js/);
  assert.match(moduleSource, /最新結果を取得/);
  assert.match(moduleSource, /選択した結果を反映/);
  assert.match(moduleSource, /手動入力も引き続き利用できます/);
  assert.match(moduleSource, /browserInstalled/);
  assert.match(moduleSource, /MutationObserver/);
  assert.match(moduleSource, /manager\.querySelector\("\.koshien-jhbf-import"\)/);
});

test("manager extensions load deterministically after app.js", () => {
  const scripts = [
    "app.js",
    "js/koshien-current-stage.js",
    "js/jhbf-result-import.js",
    "js/jhbf-admin-visibility.js",
    "js/jhbf-test-event.js",
  ];
  const positions = scripts.map((script) => indexSource.indexOf(`src="./${script}`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("browser integration invokes only fixed Edge Function and audited RPCs", () => {
  assert.match(moduleSource, /functions\.invoke\("jhbf-results"/);
  assert.match(moduleSource, /kind: "representatives"/);
  assert.match(moduleSource, /代表校を取得/);
  assert.match(moduleSource, /49代表校へ反映/);
  assert.match(moduleSource, /get_koshien_external_import_context/);
  assert.match(moduleSource, /save_koshien_external_team_alias/);
  assert.match(moduleSource, /record_koshien_external_imports/);
  assert.doesNotMatch(moduleSource, /fetch\s*\(\s*["'`]https:\/\/www\.jhbf/);
});

test("tournament cards expose a shortcut to the reused official data panel", () => {
  assert.match(appSource, /data-jhbf-open-panel/);
  assert.match(appSource, /公式データ取得/);
  assert.match(appSource, /canOpenOfficialDataForEvent/);
  assert.match(moduleSource, /scrollToImportPanel/);
});

test("browser installer retries when app manager globals become ready after load", () => {
  let loadHandler;
  const timers = [];
  const context = {
    console,
    document: { readyState: "loading" },
    addEventListener(event, handler) {
      if (event === "load") loadHandler = handler;
    },
    setTimeout(handler) {
      timers.push(handler);
      return timers.length;
    },
  };
  context.window = context;
  context.globalThis = context;

  vm.runInNewContext(moduleSource, context);
  assert.equal(typeof loadHandler, "function");

  loadHandler();
  timers.shift()();
  timers.shift()();
  timers.shift()();

  context.state = {
    event: {
      id: "jhbf-test-event",
      config: { externalResults: { competitionType: "summer", year: 2025 } },
    },
  };
  context.renderKoshienManagerPanel = () => "base panel";
  context.bindActiveEventManagerInputs = () => {};
  context.renderActiveEventManager = () => {};

  for (let attempt = 0; attempt < 5 && timers.length; attempt += 1) {
    timers.shift()();
  }

  assert.equal(context.renderKoshienManagerPanel.name, "renderKoshienManagerPanelWithJhbf");
  assert.match(
    context.renderKoshienManagerPanel({ canEditResults: true }),
    /data-jhbf-fetch/,
  );
});

test("manager observer adds JHBF controls only to an editable Koshien event", () => {
  const timers = [];
  let inserted = 0;
  let finalized = false;
  let observerCallback;
  const manager = {
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    insertAdjacentHTML() {
      inserted += 1;
    },
  };
  const context = {
    console,
    document: {
      readyState: "complete",
      querySelector(selector) {
        return selector === "#activeEventManager" ? manager : null;
      },
    },
    state: { event: { id: "world-cup", templateId: "worldCup" } },
    isCurrentUserAdmin: () => true,
    baseTemplateId: (templateId) => templateId,
    isResultFinalized: () => finalized,
    renderKoshienManagerPanel: () => "base panel",
    bindActiveEventManagerInputs: () => {},
    renderActiveEventManager: () => {},
    MutationObserver: class {
      constructor(callback) {
        observerCallback = callback;
      }
      observe() {
        observerCallback();
      }
    },
    addEventListener() {},
    setTimeout(handler) {
      timers.push(handler);
      return timers.length;
    },
  };
  context.window = context;
  context.globalThis = context;

  vm.runInNewContext(moduleSource, context);
  while (timers.length) timers.shift()();

  assert.equal(inserted, 0);

  context.state.event = { id: "finalized-koshien", templateId: "koshien" };
  finalized = true;
  observerCallback();
  while (timers.length) timers.shift()();
  assert.equal(inserted, 0);

  context.state.event = { id: "editable-koshien", templateId: "koshien" };
  finalized = false;
  observerCallback();
  while (timers.length) timers.shift()();
  assert.equal(inserted, 1);
});
