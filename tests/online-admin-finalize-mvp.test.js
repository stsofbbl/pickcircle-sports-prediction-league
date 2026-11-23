const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const path = require("node:path");
const serviceSource = fs.readFileSync(path.join(__dirname, "../js/data-service.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");

test("online admin finalization reads a server version and uses only the authenticated RPC", async () => {
  const calls = [];
  const window = { YosoSupabase: {
    client: async () => ({ rpc: async (name, params) => {
      calls.push([name, params]);
      return name === "koshien_result_version"
        ? { data: 108, error: null }
        : { data: { event_status: "finalized", result_version: 108 }, error: null };
    }}),
    sessionUser: async () => ({ id: "owner" }),
  }};
  vm.runInNewContext(serviceSource, { window, localStorage: {} });
  const result = await window.YosoDataService.koshien.finalizeAdminResults("event-1");
  assert.equal(result.event_status, "finalized");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["koshien_result_version", { p_event_id: "event-1" }],
    ["finalize_koshien_admin_results", { p_event_id: "event-1", p_expected_version: 108 }],
  ]);
});

test("online Koshien cannot finalize or approve through the browser's local state", () => {
  assert.match(appSource, /if \(isOnlineKoshienResultFlow\(\)\) return finalizeKoshienOnlineAsAdmin\(\)/);
  assert.match(appSource, /if \(isOnlineKoshienResultFlow\(\)\) return;\s+ensureResultFlow\(\)/);
  assert.match(appSource, /await service\.finalizeAdminResults\(eventId\)/);
  assert.match(appSource, /await loadKoshienOnlineState\(\{ force: true \}\)/);
  assert.match(appSource, /!isResultFinalized\(state\.event\)/);
});


// Run the actual app action in isolation: server confirmation must precede
// any local state change, and stale reads must not be reported as success.
function adminActionHarness({ confirmed = true, serverError = false, refreshOk = true,
                              loadedId = "event-1" } = {}) {
  const calls = [];
  const state = { event: { id: "event-1", templateId: "koshien", status: "resultWait",
    approvalPolicy: "admin", resultFlow: { status: "none" } } };
  const ctx = {
    state,
    loadedKoshienOnlineEventId: loadedId,
    onlineKoshienEventId: "event-1",
    currentAuthUser: () => ({ id: "owner" }),
    isCurrentUserAdmin: () => true,
    isResultFinalized: (event) => event.resultFlow?.status === "finalized",
    setKoshienMatchMessage: (message,kind) => calls.push(["message",kind,message]),
    render: () => calls.push(["render"]),
    window: {
      confirm: () => { calls.push(["confirm"]); return confirmed; },
      alert: (message) => calls.push(["alert",message]),
      YosoDataService: { koshien: { finalizeAdminResults: async (id) => {
        calls.push(["server",id,state.event.status]);
        if (serverError) throw new Error("RPC rejected");
        return { event_status: "finalized" };
      }}},
    },
    loadKoshienOnlineState: async ({force}) => {
      calls.push(["refresh",force]);
      if (!refreshOk) return null;
      state.event.status = "finalized";
      state.event.resultFlow.status = "finalized";
      return { ok: true };
    },
  };
  vm.createContext(ctx);
  const start = appSource.indexOf("let koshienAdminFinalizeBusy = false;");
  const end = appSource.indexOf("\nfunction submitResults()",start);
  assert.ok(start>=0 && end>start);
  vm.runInContext(appSource.slice(start,end),ctx);
  return {ctx,calls,state};
}

test("admin result finalization commits via server then reloads before reporting success", async () => {
  const {ctx,calls,state} = adminActionHarness();
  await ctx.finalizeKoshienOnlineAsAdmin();
  assert.deepEqual(calls.map(c=>c[0]),["confirm","server","refresh","message","render"]);
  assert.deepEqual(calls.find(c=>c[0]==="server"),["server","event-1","resultWait"]);
  assert.equal(state.event.resultFlow.status,"finalized");
  assert.equal(calls.find(c=>c[0]==="message")[1],"success");
});
test("cancelled or unloaded online event never sends a finalization request", async () => {
  const cancelled=adminActionHarness({confirmed:false});
  await cancelled.ctx.finalizeKoshienOnlineAsAdmin();
  assert.equal(cancelled.calls.some(c=>c[0]==="server"),false);
  const unloaded=adminActionHarness({loadedId:"stale"});
  await unloaded.ctx.finalizeKoshienOnlineAsAdmin();
  assert.equal(unloaded.calls.some(c=>c[0]==="server"),false);
  assert.equal(unloaded.calls[0][0],"alert");
});
test("server error or refresh error never reports an accepted finalization", async () => {
  const failed=adminActionHarness({serverError:true});
  await failed.ctx.finalizeKoshienOnlineAsAdmin();
  assert.equal(failed.state.event.resultFlow.status,"none");
  assert.equal(failed.calls.some(c=>c[0]==="message"&&c[1]==="success"),false);
  const stale=adminActionHarness({refreshOk:false});
  await stale.ctx.finalizeKoshienOnlineAsAdmin();
  assert.equal(stale.state.event.resultFlow.status,"none");
  assert.equal(stale.calls.some(c=>c[0]==="message"&&c[1]==="success"),false);
});
