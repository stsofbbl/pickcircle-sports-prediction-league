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

function snapshot(id = "event-id", leagueId = "league-id", userId = "user-id") {
  return { ok: true, currentUser: { id: userId }, league: { id: leagueId },
    event: { id, league_id: leagueId, preset_type: "koshien" }, predictions: [], results: null };
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function createSyncHarness({ loadedEventId = "", loadSnapshot, refreshError = null, switchLeagueAfterSave = false, phaseRefresh } = {}) {
  const saveCalls = [];
  const context = vm.createContext({
    console: { ...console, warn() {} },
    clearTimeout() {},
    currentKoshienParticipantName: () => "Admin",
    currentAuthUser: () => ({ id: context.actorId }), actorId: "user-id",
    baseTemplateId: () => "koshien",
    koshienHasScorableResults: () => false,
    koshienScoreRows: () => [],
    normalizeConnectionSettings: (value) => value,
    saveLocalStateOnly() {},
    renderConnectionSettings() {},
    refreshKoshienPhase2DraftState: async () => {
      if (refreshError) throw refreshError;
      if (phaseRefresh) await phaseRefresh();
    },
    refreshKoshienLaterPhaseState: async () => {},
    applyKoshienOnlineSnapshot(snapshot) {
      context.onlineLeagueId = snapshot.league.id;
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
          loadSnapshot: loadSnapshot || (async () => snapshot()),
          saveSnapshot: async (payload) => {
            saveCalls.push(payload);
            if (switchLeagueAfterSave) context.onlineLeagueId = "other-league";
            return { ok: true };
          },
        },
      },
      YosoDataServiceLocal: null,
    },
    localStorage: { setItem() {} },
    STORAGE_KEY: "yoso-state",
    onlineWorkspaceMode: true, scopedLocalWorkspace: null,
    isSupabaseAuthEnabled: () => true,
    syncActiveEvent() {},
    queueKoshienOnlineSave() {
      saveCalls.push({ automatic: true });
    },
    onlineLeagueId: "league-id",
    onlineKoshienEventId: "event-id",
    loadedKoshienOnlineEventId: loadedEventId,
    pendingKoshienSyncTimer: null,
    pendingKoshienLoadPromise: null,
    pendingKoshienLoadScope: null, onlineKoshienScopeVersion: 0,
    koshienPhase2LoadRequest: null, koshienLaterLoadRequest: null,
    koshienPhase2DraftLoading: false, koshienLaterPhaseLoading: false,
    koshienPhase2DraftSaving: false, koshienLaterPhaseSaving: false, koshienLaterAdminSaving: "",
    koshienPhase2DraftView: {}, koshienLaterPhaseView: {}, koshienOnlineRankingView: {},
    koshienPhase2DraftMessage: "", koshienPhase2DraftMessageKind: "",
    koshienLaterPhaseMessage: "", koshienLaterPhaseMessageKind: "",
    loadedKoshienResultRevision: "",
    lastKoshienOnlineLoadUserId: "",
  });

  vm.runInContext([
    section("function localWorkspaceIdentity()", "\nfunction saveLocalStateOnly"),
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
  assert.equal(afterLoad.saveCalls[0].leagueId, "league-id");
  assert.equal(afterLoad.saveCalls[0].userId, "user-id");
});

test("a save response from a previous club cannot mark the current workspace synced", async () => {
  const h = createSyncHarness({ loadedEventId: "event-id", switchLeagueAfterSave: true });
  const result = await h.context.saveKoshienOnlineNow();
  assert.equal(result.skipped, true);
  assert.equal(result.reason, "online Koshien save scope changed");
  assert.equal(h.context.state.connection.lastSyncAt, undefined);
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

test("ordinary reload rejects mismatched actor, league, preset and event ownership", async () => {
  for (const bad of [
    snapshot("event-id", "other-league"), snapshot("event-id", "league-id", "other-user"),
    { ...snapshot(), event: { ...snapshot().event, league_id: "other-league" } },
    { ...snapshot(), event: { ...snapshot().event, preset_type: "ranking_v1" } },
  ]) {
    const { context } = createSyncHarness({ loadedEventId: "event-id", loadSnapshot: async () => bad });
    const old = context.state.event;
    assert.equal(await context.loadKoshienOnlineState({ force: true }), null);
    assert.equal(context.state.event, old);
    assert.equal(context.loadedKoshienOnlineEventId, "");
  }
});

test("new scope can load immediately and old response cannot replace it or clear its gate", async () => {
  const old = deferred(), next = deferred();
  let calls = 0;
  const { context } = createSyncHarness({ loadSnapshot: () => (++calls === 1 ? old.promise : next.promise) });
  const first = context.loadKoshienOnlineState({ force: true });
  context.invalidateOnlineKoshienScope();
  context.onlineLeagueId = "other-league";
  const second = context.loadKoshienOnlineState({ force: true });
  next.resolve(snapshot("new-event", "other-league"));
  assert.equal((await second).ok, true);
  old.resolve(snapshot());
  assert.equal(await first, null);
  assert.equal(context.state.event.id, "new-event");
  assert.equal(context.loadedKoshienOnlineEventId, "new-event");
  assert.equal(calls, 2);
});

test("ABA switch invalidates an old response even when actor and club are restored", async () => {
  const d = deferred();
  const { context } = createSyncHarness({ loadSnapshot: () => d.promise });
  const first = context.loadKoshienOnlineState({ force: true });
  context.invalidateOnlineKoshienScope();
  context.actorId = "other-user";
  context.invalidateOnlineKoshienScope();
  context.actorId = "user-id";
  d.resolve(snapshot());
  assert.equal(await first, null);
  assert.equal(context.loadedKoshienOnlineEventId, "");
});

test("scope switch during secondary phase refresh never reopens the previous save gate", async () => {
  const phase = deferred(), entered = deferred();
  const { context } = createSyncHarness({ phaseRefresh: () => { entered.resolve(); return phase.promise; } });
  const first = context.loadKoshienOnlineState({ force: true });
  await entered.promise;
  context.invalidateOnlineKoshienScope();
  context.onlineLeagueId = "other-league";
  phase.resolve();
  assert.equal(await first, null);
  assert.equal(context.loadedKoshienOnlineEventId, "");
});

test("a load changing the selected event remains deduplicated during its phase refresh", async () => {
  const phase = deferred(), entered = deferred();
  let calls = 0;
  const { context } = createSyncHarness({
    loadSnapshot: async () => { calls++; return snapshot("new-event"); },
    phaseRefresh: () => { entered.resolve(); return phase.promise; },
  });
  const first = context.loadKoshienOnlineState({ force: true });
  await entered.promise;
  const second = context.loadKoshienOnlineState({ force: true });
  phase.resolve();
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true);
  assert.equal(calls, 1);
  assert.equal(context.loadedKoshienOnlineEventId, "new-event");
});

function phaseHarness() {
  const { context } = createSyncHarness();
  context.window.YosoKoshienPhase2Draft = { buildDraftViewState: value => value };
  vm.runInContext(section("function applyKoshienPhase2DraftResponse", "\nfunction createKoshienPhase2RequestId"), context);
  return context;
}

test("stale phase2 and later-phase responses cannot overwrite the new club state", async () => {
  const ctx = phaseHarness();
  const old2 = deferred(), oldLater = deferred();
  ctx.window.YosoDataService.koshien.loadPhase2DraftState = () => old2.promise;
  ctx.window.YosoDataService.koshien.loadLaterPhaseState = () => oldLater.promise;
  const p2 = ctx.refreshKoshienPhase2DraftState({ renderAfter: false });
  const pl = ctx.refreshKoshienLaterPhaseState({ renderAfter: false });
  ctx.invalidateOnlineKoshienScope();
  ctx.onlineLeagueId = "other-league";
  ctx.state.activeEventId = ctx.state.event.id = "new-event";
  ctx.window.YosoDataService.koshien.loadPhase2DraftState = async () => ({ tag: "new" });
  ctx.window.YosoDataService.koshien.loadLaterPhaseState = async () => ({ event_id: "new-event", tag: "new" });
  await ctx.refreshKoshienPhase2DraftState({ renderAfter: false });
  await ctx.refreshKoshienLaterPhaseState({ renderAfter: false });
  old2.resolve({ tag: "old" });
  oldLater.resolve({ event_id: "event-id", tag: "old" });
  await Promise.all([p2, pl]);
  assert.equal(ctx.koshienPhase2DraftView.tag, "new");
  assert.equal(ctx.koshienLaterPhaseView.tag, "new");
  assert.equal(ctx.koshienPhase2DraftLoading, false);
  assert.equal(ctx.koshienLaterPhaseLoading, false);
});

test("an older failed phase refresh cannot erase a newer success", async () => {
  const ctx = phaseHarness();
  const old2 = deferred(), oldLater = deferred();
  ctx.window.YosoDataService.koshien.loadPhase2DraftState = () => old2.promise;
  ctx.window.YosoDataService.koshien.loadLaterPhaseState = () => oldLater.promise;
  const p2 = ctx.refreshKoshienPhase2DraftState({ renderAfter: false });
  const pl = ctx.refreshKoshienLaterPhaseState({ renderAfter: false });
  ctx.window.YosoDataService.koshien.loadPhase2DraftState = async () => ({ tag: "new" });
  ctx.window.YosoDataService.koshien.loadLaterPhaseState = async () => ({ event_id: "event-id", tag: "new" });
  await ctx.refreshKoshienPhase2DraftState({ renderAfter: false });
  await ctx.refreshKoshienLaterPhaseState({ renderAfter: false });
  old2.reject(Error("old failure"));
  oldLater.reject(Error("old failure"));
  await Promise.all([p2, pl]);
  assert.equal(ctx.koshienPhase2DraftView.tag, "new");
  assert.equal(ctx.koshienLaterPhaseView.tag, "new");
  assert.equal(ctx.koshienPhase2DraftMessage, "");
  assert.equal(ctx.koshienLaterPhaseMessage, "");
});

function phaseWriteHarness() {
  const h=createSyncHarness(), c=h.context, calls=[];
  c.els={eventForm:{querySelector:()=>({value:"initial-choice"})}};
  c.createKoshienPhase2RequestId=()=>"fixture-request";
  c.koshienPhase2DraftView={eventId:"event-id",canViewerPick:true,draftId:"draft-id",currentTurn:{pickNo:1}};
  c.koshienLaterPhaseView={eventId:"event-id",loadedFromDb:true,rounds:{revenge:{version:3},zombie:{version:3},phase3:{version:3}}};
  c.applyKoshienPhase2DraftResponse=(response,eventId)=>calls.push(["phase2",response,eventId]);
  c.applyKoshienLaterPhaseResponse=(response,eventId)=>calls.push(["later",response,eventId]);
  c.refreshKoshienPhase2DraftState=async()=>{calls.push(["refresh2"]);return {loadedFromDb:true};};
  c.refreshKoshienLaterPhaseState=async()=>{calls.push(["refreshLater"]);return {loadedFromDb:true};};
  c.setKoshienMatchMessage=(message,kind)=>calls.push(["message",message,kind]);
  c.renderActiveEventManager=()=>{};
  c.koshienJapanInputToIso=x=>x;
  c.window.confirm=()=>true;
  c.render=()=>{c.els.eventForm.querySelector=()=>({value:"rerendered-default"});};
  vm.runInContext(section("async function confirmKoshienPhase2DraftPick()", "\nfunction koshienLoadSkipMessage"), c);
  return {c,calls};
}
test("phase2 old actor conflict cannot apply latest state or unset a new pending pick",async()=>{
  const {c,calls}=phaseWriteHarness(), first=deferred(), second=deferred();
  let count=0;
  c.window.YosoDataService.koshien.savePhase2DraftPick=()=>++count===1?first.promise:second.promise;
  const a=c.confirmKoshienPhase2DraftPick();
  c.invalidateOnlineKoshienScope();c.actorId="new-actor";
  c.koshienPhase2DraftView={eventId:"event-id",canViewerPick:true,draftId:"draft-id",currentTurn:{pickNo:1}};
  const b=c.confirmKoshienPhase2DraftPick(), newRequest=c.koshienPhase2DraftSaving;
  first.reject(Object.assign(Error("old conflict"),{latestState:{private:"old"}}));
  await a;
  assert.equal(c.koshienPhase2DraftSaving,newRequest);
  assert.equal(calls.length,0);
  second.resolve({private:"new"});await b;
  assert.deepEqual(calls,[["phase2",{private:"new"},"event-id"]]);
  assert.equal(c.koshienPhase2DraftSaving,false);
});
test("later choice sends the selected input before rerender and discards old actor success",async()=>{
  const {c,calls}=phaseWriteHarness(), wait=deferred();
  let sent;
  c.window.YosoDataService.koshien.saveRevengePick=x=>{sent=x;return wait.promise;};
  const pending=c.saveKoshienLaterChoice("revenge");
  assert.equal(sent.teamId,"initial-choice");
  c.invalidateOnlineKoshienScope();c.actorId="new-actor";
  wait.resolve({private:"old"});await pending;
  assert.equal(calls.length,0);
  assert.equal(c.koshienLaterPhaseMessage,"");
});
test("later admin response from old actor is not applied or followed by secondary requests",async()=>{
  const {c,calls}=phaseWriteHarness(), wait=deferred();
  c.window.YosoDataService.koshien.setLaterPhaseStatus=()=>wait.promise;
  const pending=c.setKoshienLaterPhaseStatus("zombie","open");
  c.invalidateOnlineKoshienScope();c.actorId="new-actor";
  calls.length=0;
  wait.resolve({private:"old"});await pending;
  assert.equal(calls.length,0);
  assert.equal(c.koshienLaterAdminSaving,"");
});
