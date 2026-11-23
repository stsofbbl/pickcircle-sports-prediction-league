const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const test = require("node:test");
const path = require("node:path");
const serviceSource = fs.readFileSync(path.join(__dirname, "../js/data-service.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");

test("online admin finalization uses the revision captured when data was loaded", async () => {
  const calls = [];
  const window = { YosoSupabase: {
    client: async () => ({ rpc: async (name, params) => {
      calls.push([name, params]);
      return { data: { event_status: "finalized", reviewed_revision: "a".repeat(32) }, error: null };
    }}),
    sessionUser: async () => ({ id: "owner" }),
  }};
  vm.runInNewContext(serviceSource, { window, localStorage: {} });
  const result = await window.YosoDataService.koshien.finalizeAdminResults("event-1", "a".repeat(32));
  assert.equal(result.event_status, "finalized");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ["finalize_koshien_admin_results", { p_event_id: "event-1", p_expected_revision: "a".repeat(32) }],
  ]);
});

test("online Koshien cannot finalize or approve through the browser's local state", () => {
  assert.match(appSource, /if \(isOnlineKoshienResultFlow\(\)\) return finalizeKoshienOnlineAsAdmin\(\)/);
  assert.match(appSource, /if \(isOnlineKoshienResultFlow\(\)\) return;\s+ensureResultFlow\(\)/);
  assert.match(appSource, /await service\.finalizeAdminResults\(eventId, loadedKoshienResultRevision\)/);
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
    loadedKoshienResultRevision: "a".repeat(32),
    onlineKoshienEventId: "event-1",
    currentAuthUser: () => ({ id: "owner" }),
    isCurrentUserAdmin: () => true,
    isResultFinalized: (event) => event.resultFlow?.status === "finalized",
    setKoshienMatchMessage: (message,kind) => calls.push(["message",kind,message]),
    render: () => calls.push(["render"]),
    window: {
      confirm: () => { calls.push(["confirm"]); return confirmed; },
      alert: (message) => calls.push(["alert",message]),
      YosoDataService: { koshien: { finalizeAdminResults: async (id, revision) => {
        calls.push(["server",id,state.event.status,revision]);
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
  assert.deepEqual(calls.find(c=>c[0]==="server"),["server","event-1","resultWait","a".repeat(32)]);
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

// Server-side reopen must be followed by a fresh snapshot; do not trust
// an optimistic local status or claim success on a failed refresh.
function reopenActionHarness({ rpcFailure = false, refreshFailure = false } = {}) {
  const calls = [];
  const state = { event: { id: "event-1", templateId: "koshien", status: "finalized",
    approvalPolicy: "admin", resultFlow: { status: "finalized" } } };
  const ctx = {
    state,
    isCurrentUserAdmin: () => true,
    isResultFinalized: (event) => event.resultFlow.status === "finalized",
    currentAuthUser: () => ({ id: "owner" }),
    baseTemplateId: () => "koshien",
    createResultFlow: () => ({ status: "none", approvals: {} }),
    saveLocalStateOnly: () => { throw new Error("online path must not optimistically persist"); },
    render: () => calls.push(["render"]),
    setKoshienMatchMessage: (message, kind) => calls.push(["message", kind, message]),
    window: {
      confirm: () => true,
      YosoDataService: {
        shouldAutoSaveKoshien: () => true,
        koshien: {
          reopenKoshienResults: async (eventId) => {
            calls.push(["rpc", eventId, state.event.status]);
            if (rpcFailure) throw new Error("reopen rejected");
          },
        },
      },
    },
    loadKoshienOnlineState: async () => {
      calls.push(["refresh"]);
      if (refreshFailure) return null;
      state.event.status = "resultWait";
      state.event.resultFlow.status = "none";
      return { ok: true };
    },
  };
  vm.createContext(ctx);
  const begin = appSource.indexOf("async function reopenFinalizedResults()");
  const end = appSource.indexOf("\nfunction updatePresetSummary()", begin);
  assert.ok(begin >= 0 && end > begin);
  vm.runInContext(appSource.slice(begin, end), ctx);
  return {ctx, state, calls};
}

test("official reopen reflects server-owned status only after successful reload", async () => {
  const {ctx, state, calls} = reopenActionHarness();
  await ctx.reopenFinalizedResults();
  assert.equal(state.event.status, "resultWait");
  assert.deepEqual(calls.map(c => c[0]), ["rpc", "refresh", "message", "render"]);
  assert.equal(calls.find(c => c[0] === "message")[1], "success");
});
test("failed reopen or refresh never reports confirmed cancellation", async () => {
  for (const options of [{ rpcFailure: true }, { refreshFailure: true }]) {
    const {ctx, state, calls} = reopenActionHarness(options);
    await ctx.reopenFinalizedResults();
    assert.equal(state.event.status, "finalized");
    assert.ok(calls.some(c => c[0] === "message" && c[1] === "error"));
    assert.equal(calls.some(c => c[0] === "message" && c[1] === "success"), false);
  }
});


test("online confirmation uses the identity-to-display projection without altering server approvals", () => {
  const { displayOnlineResultApprovals, buildOfficialScoreRows, rankScoreRows } =
    require("../js/koshien-results.js");
  const stored = { status: "finalized", submittedBy: "owner-uuid",
    approvals: { "owner-uuid": "2026-11-24T01:00:00Z" } };
  const names = new Map([["owner-uuid","管理者"], ["member-uuid","参加者"]]);
  const visible = displayOnlineResultApprovals(stored, names);
  assert.deepEqual(visible.approvals, { "管理者": "2026-11-24T01:00:00Z" });
  assert.equal(visible.status, "finalized");
  assert.deepEqual(stored.approvals, { "owner-uuid": "2026-11-24T01:00:00Z" });
  assert.match(appSource, /const displayedResultFlow = window\.YosoKoshienResults\.displayOnlineResultApprovals\(/);
  assert.match(appSource, /resultFlow: displayedResultFlow/);

  const snapshot = {
    members: [{ user_id: "owner-uuid", display_name: "管理者" },
      { user_id: "member-uuid", display_name: "参加者" }],
    players: [{ id: "player-1", profile_id: "owner-uuid" },
      { id: "player-2", profile_id: "member-uuid" }],
    scores: [{ player_id: "player-1", total_score: 10 },
      { player_id: "player-2", total_score: 20 }],
  };
  const ranking = rankScoreRows(buildOfficialScoreRows(snapshot));
  assert.deepEqual(ranking.map(x => [x.name,x.rank,x.score]),
    [["参加者",1,20],["管理者",2,10]]);
});

test("online admin may finalize a submitted result, but no local approve button is shown", () => {
  const start = appSource.indexOf("function resultFlowPanel()");
  const end = appSource.indexOf("\nfunction resultFlowMessage()",start);
  assert.ok(start>=0 && end>start);
  const state = {
    participants: ["管理者","参加者"],
    approvalPolicy: "admin",
    event: {
      templateId: "koshien", status:"resultWait", approvalPolicy:"admin",
      resultFlow:{ status:"submitted", approvals:{"管理者":"2026-11-24T01:00:00Z"} }
    }
  };
  const ctx = {
    state, ensureResultFlow:()=>{},
    baseTemplateId:()=> "koshien", requiredApprovalCountForEvent:()=>1,
    isCurrentUserAdmin:()=>true, isResultFinalized:()=>false,
    isOnlineKoshienResultFlow:()=>true,
    approvalCount:()=>1, resultFlowMessage:()=>"",
    escapeHtml:(x)=>String(x), escapeAttr:(x)=>String(x)
  };
  vm.createContext(ctx);
  vm.runInContext(appSource.slice(start,end),ctx);
  let html=ctx.resultFlowPanel();
  assert.match(html,/data-result-submit/);
  assert.doesNotMatch(html,/data-result-approve/);
  state.event.approvalPolicy="half";
  html=ctx.resultFlowPanel();
  assert.doesNotMatch(html,/data-result-submit/);
  assert.doesNotMatch(html,/data-result-approve/);
});

test("snapshot revision is checked before and after data reads", () => {
  assert.match(serviceSource, /const revisionBefore = await readResultRevision\(\)/);
  assert.match(serviceSource, /const revisionAfter = await readResultRevision\(\)/);
  assert.match(serviceSource, /if \(revisionBefore !== revisionAfter\)/);
  assert.match(serviceSource, /resultRevision: revisionAfter/);
  assert.match(appSource, /loadedKoshienResultRevision = String\(snapshot\.resultRevision \|\| ""\)/);
});

test("no reviewed revision means no online finalization", async () => {
  const {ctx,calls} = adminActionHarness();
  ctx.loadedKoshienResultRevision = "";
  await ctx.finalizeKoshienOnlineAsAdmin();
  assert.equal(calls.some(row=>row[0]==="server"),false);
  assert.equal(calls[0][0],"alert");
});
