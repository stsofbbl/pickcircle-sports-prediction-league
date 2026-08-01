const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const APP_PATH = path.join(__dirname, "..", "app.js");
const source = fs.readFileSync(APP_PATH, "utf8");

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} section must exist`);
  return source.slice(start, end);
}

function createSyncHarness({ loadedEventId = "", loadSnapshot, refreshError = null } = {}) {
  const saveCalls = [];
  const context = vm.createContext({
    console: { ...console, warn() {} },
    clearTimeout() {},
    currentKoshienParticipantName: () => "Admin",
    currentAuthUser: () => ({ id: "user-id" }),
    baseTemplateId: () => "koshien",
    koshienHasScorableResults: () => false,
    koshienScoreRows: () => [],
    normalizeConnectionSettings: (value) => value,
    saveLocalStateOnly() {},
    renderConnectionSettings() {},
    refreshKoshienPhase2DraftState: async () => {
      if (refreshError) throw refreshError;
    },
    refreshKoshienLaterPhaseState: async () => {},
    applyKoshienOnlineSnapshot(snapshot) {
      context.onlineKoshienEventId = snapshot.event.id;
      context.state.event = { id: snapshot.event.id, templateId: "koshien", results: { matches: [], finishes: {} } };
      context.state.activeEventId = snapshot.event.id;
    },
    render() {
      context.persist();
    },
    setConnectionMessage() {},
    koshienLoadSkipMessage: (reason) => reason,
    state: {
      activeEventId: "event-id",
      event: {
        id: "event-id",
        templateId: "koshien",
        predictions: { Admin: { teams: ["old-local-team"], captain: "old-local-team" } },
        results: { matches: [{ status: "completed" }], finishes: { "old-local-team": "best8" } },
      },
      connection: {},
    },
    window: {
      YosoDataService: {
        shouldAutoSaveKoshien: () => true,
        koshien: {
          loadSnapshot: loadSnapshot || (async () => ({
            ok: true,
            currentUser: { id: "user-id" },
            event: { id: "event-id" },
            predictions: [],
            results: null,
          })),
          saveSnapshot: async (payload) => {
            saveCalls.push(payload);
            return { ok: true };
          },
        },
      },
      YosoDataServiceLocal: null,
    },
    localStorage: { setItem() {} },
    STORAGE_KEY: "yoso-state",
    syncActiveEvent() {},
    queueKoshienOnlineSave() {
      saveCalls.push({ automatic: true });
    },
    onlineKoshienEventId: "event-id",
    loadedKoshienOnlineEventId: loadedEventId,
    pendingKoshienSyncTimer: null,
    pendingKoshienLoadPromise: null,
    lastKoshienOnlineLoadUserId: "",
  });

  vm.runInContext([
    section("function persist()", "\nfunction saveLocalStateOnly"),
    section("function saveLocalStateOnly()", "\nasync function saveKoshienOnlineNow"),
    section("async function saveKoshienOnlineNow", "\nasync function loadKoshienOnlineState"),
    section("async function loadKoshienOnlineState", "\nfunction applyKoshienPhase2DraftResponse"),
  ].join("\n"), context);

  return { context, saveCalls };
}

test("initial render and local persistence never schedule an online Koshien save", () => {
  const { context, saveCalls } = createSyncHarness();

  context.persist();

  assert.deepEqual(saveCalls, []);
});

test("an empty online snapshot replaces startup state without sending old local data", async () => {
  const { context, saveCalls } = createSyncHarness();

  await context.loadKoshienOnlineState({ force: true });

  assert.deepEqual(saveCalls, []);
  assert.equal(context.loadedKoshienOnlineEventId, "event-id");
});

test("an explicit save is allowed only after the formal online event has loaded", async () => {
  const beforeLoad = createSyncHarness();
  const skipped = await beforeLoad.context.saveKoshienOnlineNow();
  assert.equal(skipped?.skipped, true);
  assert.deepEqual(beforeLoad.saveCalls, []);

  const afterLoad = createSyncHarness({ loadedEventId: "event-id" });
  const saved = await afterLoad.context.saveKoshienOnlineNow();
  assert.equal(saved?.ok, true);
  assert.equal(afterLoad.saveCalls.length, 1);
});

test("a local state from another event is never sent to the formal event", async () => {
  const { context, saveCalls } = createSyncHarness({ loadedEventId: "event-id" });
  context.state.event.id = "other-event-id";
  context.state.activeEventId = "other-event-id";

  const result = await context.saveKoshienOnlineNow();

  assert.equal(result?.skipped, true);
  assert.deepEqual(saveCalls, []);
});

test("a failed online reload clears the save gate and cannot send stale local state", async () => {
  const { context, saveCalls } = createSyncHarness({
    loadedEventId: "event-id",
    loadSnapshot: async () => { throw new Error("offline"); },
  });

  await context.loadKoshienOnlineState({ force: true });
  const result = await context.saveKoshienOnlineNow();

  assert.equal(result?.skipped, true);
  assert.deepEqual(saveCalls, []);
});

test("a partially failed online refresh cannot leave saving enabled", async () => {
  const { context, saveCalls } = createSyncHarness({
    loadedEventId: "event-id",
    refreshError: new Error("later-phase refresh failed"),
  });

  await context.loadKoshienOnlineState({ force: true });
  const result = await context.saveKoshienOnlineNow();

  assert.equal(result?.skipped, true);
  assert.deepEqual(saveCalls, []);
});
