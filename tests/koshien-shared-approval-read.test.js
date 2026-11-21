const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const dataService = fs.readFileSync(path.join(__dirname, "../js/data-service.js"), "utf8");

function sliceBetween(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, "expected source section");
  return source.slice(a, b);
}

function stateHarness(load) {
  const logs = [];
  let calls = [];
  const context = vm.createContext({
    state: { event: { id: "event-a", templateId: "koshien" } },
    koshienSharedApprovalView: { eventId: "", loadedFromDb: false },
    baseTemplateId: (id) => id,
    user: { id: "signed-in-user" },
    currentAuthUser: () => context.user,
    window: { YosoDataService: { koshien: {
      loadSharedApprovalState: async (id) => {
        calls.push(id);
        return load(id);
      },
    } } },
    renderCount: 0,
    render: () => { context.renderCount++; },
    console: { warn: (...items) => logs.push(items) },
  });
  vm.runInContext(sliceBetween(app,
    "async function refreshKoshienSharedApprovalState(",
    "async function refreshKoshienPhase2DraftState("), context);
  return { context, calls, logs };
}

test("shared approval read returns server state only for the requested event", async () => {
  const { context, calls } = stateHarness(async (id) => ({
    event_id: id, submission_status: "submitted", approved_count: 2,
    required_count: 4, current_user_eligible: true, current_user_voted: false,
  }));
  const value = await context.refreshKoshienSharedApprovalState({ renderAfter: false });
  assert.equal(value.loadedFromDb, true);
  assert.equal(value.eventId, "event-a");
  assert.equal(value.approved_count, 2);
  assert.deepEqual(calls, ["event-a"]);
  assert.equal(context.renderCount, 0);
});

test("server response with a different event ID is never shown", async () => {
  const { context, logs } = stateHarness(async () => ({
    event_id: "different-event", submission_status: "finalized",
  }));
  await context.refreshKoshienSharedApprovalState();
  assert.equal(context.koshienSharedApprovalView.loadedFromDb, false);
  assert.equal(context.koshienSharedApprovalView.eventId, "event-a");
  assert.equal(context.renderCount, 1);
  assert.equal(logs.length, 1);
});

test("missing session or failing RPC does not resurrect cached votes", async () => {
  const { context, calls } = stateHarness(async () => {
    throw Object.assign(new Error("RPC not installed"), { code: "PGRST202" });
  });
  context.koshienSharedApprovalView = {
    eventId: "event-a", loadedFromDb: true, approved_count: 99,
  };
  context.user = null;
  await context.refreshKoshienSharedApprovalState({ renderAfter: false });
  assert.equal(calls.length, 0);
  assert.equal(context.koshienSharedApprovalView.loadedFromDb, false);
  context.user = { id: "signed-in-user" };
  await context.refreshKoshienSharedApprovalState({ renderAfter: false });
  assert.deepEqual(calls, ["event-a"]);
  assert.equal(context.koshienSharedApprovalView.loadedFromDb, false);
  assert.equal(context.koshienSharedApprovalView.approved_count, undefined);
});

test("late response for an older event cannot replace the new event state", async () => {
  let completeOld;
  const oldRequest = new Promise((resolve) => { completeOld = resolve; });
  const { context, calls } = stateHarness((id) => id === "event-a"
    ? oldRequest : Promise.resolve({ event_id: "event-b", approved_count: 1 }));
  const pending = context.refreshKoshienSharedApprovalState({ renderAfter: false });
  context.state.event.id = "event-b";
  await context.refreshKoshienSharedApprovalState({ renderAfter: false });
  completeOld({ event_id: "event-a", approved_count: 9 });
  await pending;
  assert.deepEqual(calls, ["event-a", "event-b"]);
  assert.equal(context.koshienSharedApprovalView.eventId, "event-b");
  assert.equal(context.koshienSharedApprovalView.approved_count, 1);
});

test("data service invokes the authenticated read-only RPC with normalized event ID", async () => {
  let called;
  const ctx = vm.createContext({
    laterPhaseRpc: async (...args) => { called = args; return { revision: 3 }; },
  });
  vm.runInContext(sliceBetween(dataService,
    "async function loadSharedApprovalState(",
    "async function reopenKoshienResults("), ctx);
  assert.equal((await ctx.loadSharedApprovalState(" event-a ")).revision, 3);
  assert.deepEqual(JSON.parse(JSON.stringify(called)), [
    "get_koshien_shared_approval_state",
    { p_event_id: "event-a" },
    "shared_approval_read",
  ]);
  await assert.rejects(ctx.loadSharedApprovalState(" "), /event_id/);
});
