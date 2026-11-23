const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const start = app.indexOf("async function reopenFinalizedResults()");
const end = app.indexOf("\nfunction updatePresetSummary()", start);
assert.ok(start >= 0 && end > start, "reopen handler must exist");
const reopenBody = app.slice(start, end);

function harness({ online = true, rpc, reload, admin = true, loggedIn = true, confirmed = true } = {}) {
  const actions = [];
  const context = vm.createContext({
    state: {
      participants: ["Owner", "Member"],
      event: { id: "evt-a", templateId: "koshien", status: "finalized",
        resultFlow: { status: "finalized", approvals: { Owner: "old-vote" } } },
    },
    koshienSharedApprovalView: {
      eventId: "evt-a", loadedFromDb: true, event_status: "finalized",
      submission_status: "finalized",
    },
    koshienSharedApprovalNotice: { eventId: "", message: "", kind: "" },
    koshienSharedApprovalBusy: false,
    isCurrentUserAdmin: () => admin,
    currentAuthUser: () => loggedIn ? { id: "owner" } : null,
    isResultFinalized: (event) => event?.resultFlow?.status === "finalized",
    isOnlineKoshienResultFlow: () => online,
    normalizeResultFlow: (flow) => flow,
    createResultFlow: () => ({ status: "none", approvals: {} }),
    saveLocalStateOnly: () => actions.push("local-save"),
    setKoshienMatchMessage: (message, kind) => actions.push({ message, kind }),
    render: () => actions.push("render"),
    loadKoshienOnlineState: async (args) => {
      actions.push({ reload: args });
      if (reload) return reload(context);
      return { ok: true, event: { id: "evt-a" } };
    },
    window: {
      confirm: () => confirmed,
      YosoDataService: {
        koshien: {
          reopenKoshienResults: async (eventId) => {
            actions.push({ rpc: eventId });
            if (rpc) return rpc(eventId);
            return { event_id: "evt-a", status: "resultWait",
              result_flow: { status: "none", approvals: {} } };
          },
        },
      },
    },
  });
  vm.runInContext(reopenBody, context);
  return { context, actions };
}

test("online reopen applies authoritative RPC response and then reloads server state", async () => {
  const { context, actions } = harness();
  await context.reopenFinalizedResults();
  assert.equal(context.state.event.status, "resultWait");
  assert.equal(context.state.event.resultFlow.status, "none");
  assert.equal(actions.filter(x => typeof x === "object" && x.rpc).length, 1);
  assert.equal(actions.filter(x => typeof x === "object" && x.reload).length, 1);
  assert.match(context.koshienSharedApprovalNotice.message, /取り消しました/);
  assert.equal(context.koshienSharedApprovalBusy, false);
});

test("after DB success a failed reload never restores the old finalized status", async () => {
  const { context, actions } = harness({ reload: async () => null });
  await context.reopenFinalizedResults();
  assert.equal(context.state.event.status, "resultWait");
  assert.equal(context.state.event.resultFlow.status, "none");
  assert.equal(context.koshienSharedApprovalView.loadedFromDb, false);
  assert.match(context.koshienSharedApprovalNotice.message, /サーバーで完了/);
  assert.equal(actions.filter(x => x === "local-save").length, 1);
});

test("an uncertain RPC outcome must not claim success or enable stale approval actions", async () => {
  const { context, actions } = harness({
    rpc: async () => { throw new Error("connection lost after request"); },
  });
  await context.reopenFinalizedResults();
  assert.equal(context.state.event.status, "finalized");
  assert.equal(context.koshienSharedApprovalView.loadedFromDb, false);
  assert.match(context.koshienSharedApprovalNotice.message, /完了している可能性/);
  assert.equal(actions.filter(x => x === "local-save").length, 0);
  assert.equal(actions.filter(x => typeof x === "object" && x.reload).length, 0);
});

test("another selected event cannot be modified by an earlier reopen response", async () => {
  let resolveRpc;
  const waiting = new Promise(resolve => { resolveRpc = resolve; });
  const { context, actions } = harness({ rpc: async () => waiting });
  const pending = context.reopenFinalizedResults();
  context.state.event = { id: "evt-b", templateId: "koshien", status: "finalized",
    resultFlow: { status: "finalized" } };
  resolveRpc({ event_id: "evt-a", status: "resultWait", result_flow: { status: "none" } });
  await pending;
  assert.equal(context.state.event.id, "evt-b");
  assert.equal(context.state.event.status, "finalized");
  assert.equal(actions.filter(x => typeof x === "object" && x.reload).length, 0);
});

test("pending reopen blocks duplicate requests and unlocks after completion", async () => {
  let resolveRpc;
  const waiting = new Promise(resolve => { resolveRpc = resolve; });
  const { context, actions } = harness({ rpc: async () => waiting });
  const pending = context.reopenFinalizedResults();
  await context.reopenFinalizedResults();
  assert.equal(actions.filter(x => typeof x === "object" && x.rpc).length, 1);
  resolveRpc({ event_id: "evt-a", status: "resultWait", result_flow: { status: "none" } });
  await pending;
  assert.equal(context.koshienSharedApprovalBusy, false);
});

test("missing login or stale shared state refuses online reopen", async () => {
  const noLogin = harness({ loggedIn: false });
  await noLogin.context.reopenFinalizedResults();
  assert.equal(noLogin.actions.length, 0);
  const stale = harness();
  stale.context.koshienSharedApprovalView.loadedFromDb = false;
  await stale.context.reopenFinalizedResults();
  assert.equal(stale.actions.length, 0);
});

test("offline reopen remains local-only and never calls the shared RPC", async () => {
  const { context, actions } = harness({ online: false });
  await context.reopenFinalizedResults();
  assert.equal(context.state.event.status, "resultWait");
  assert.equal(context.state.event.resultFlow.status, "none");
  assert.equal(actions.filter(x => x === "local-save").length, 1);
  assert.equal(actions.filter(x => typeof x === "object" && x.rpc).length, 0);
});
