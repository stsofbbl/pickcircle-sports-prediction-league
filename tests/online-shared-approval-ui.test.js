const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const serviceSource = fs.readFileSync(path.join(__dirname, "../js/data-service.js"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");

function setupService(rpc) {
  const window = { YosoSupabase: {
    client: async () => ({ rpc }),
    sessionUser: async () => ({ id: "user-a" }),
  }};
  vm.runInNewContext(serviceSource, { window, localStorage: {} });
  return window.YosoDataService.koshien;
}

test("shared approval submits and votes by server RPC with revision and submission UUID", async () => {
  const calls = [];
  const service = setupService(async (name, payload) => {
    calls.push({ name, payload });
    return { data: { submission_status: "submitted" }, error: null };
  });
  const submissionId = "39d5e3be-7ec3-41ee-b8cd-f1ef75e82e5b";
  await service.submitSharedApprovalResults("event-A", 7);
  await service.approveSharedApprovalResults("event-A", submissionId, 7);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { name: "submit_koshien_shared_results", payload: { p_event_id: "event-A", p_expected_revision: 7 }},
    { name: "approve_koshien_shared_results", payload: {
      p_event_id: "event-A", p_submission_id: submissionId, p_expected_revision: 7,
    }},
  ]);
});

test("missing or malformed approval identity fails closed before any network request", async () => {
  let calls = 0;
  const service = setupService(async () => { calls++; return { data: {}, error: null }; });
  await assert.rejects(service.submitSharedApprovalResults("event-A", NaN), /revision/);
  await assert.rejects(service.submitSharedApprovalResults("", 0), /revision/);
  await assert.rejects(service.approveSharedApprovalResults("event-A", "not-uuid", 1), /再取得/);
  assert.equal(calls, 0);
});

test("RPC error fails instead of applying a local result", async () => {
  const service = setupService(async () => ({
    data: null, error: { code: "42501", message: "forbidden" },
  }));
  await assert.rejects(service.approveSharedApprovalResults(
    "event-A", "39d5e3be-7ec3-41ee-b8cd-f1ef75e82e5b", 0,
  ), /forbidden/);
});

test("online flow invokes authenticated actions without the legacy name-based vote", () => {
  assert.match(appSource, /if \(isOnlineKoshienResultFlow\(\)\) return runKoshienSharedApprovalAction\("submit"\)/);
  assert.match(appSource, /if \(isOnlineKoshienResultFlow\(\)\) return runKoshienSharedApprovalAction\("approve"\)/);
  assert.match(appSource, /current_user_eligible === true && flow\.current_user_voted !== true/);
  assert.match(appSource, /submission_status === "none" && isCurrentUserAdmin\(\)/);
  assert.match(appSource, /loadKoshienOnlineState\(\{ force: true \}\)/);
  assert.match(appSource, /data-shared-approval-refresh/);
});


test("shared approval policy uses dedicated authenticated RPC with expected revision", async () => {
  const calls = [];
  const service = setupService(async (name, payload) => {
    calls.push({ name, payload });
    return { data: { event_id: "event-A", policy: "unanimous", revision: 5, changed: true }, error: null };
  });
  const result = await service.setSharedApprovalPolicy(" event-A ", "unanimous", 4);
  assert.equal(result.revision, 5);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { name: "set_koshien_shared_approval_policy", payload: {
      p_event_id: "event-A", p_policy: "unanimous", p_expected_revision: 4,
    } },
  ]);
  await assert.rejects(service.setSharedApprovalPolicy("event-A", "bogus", 4), /承認方式/);
  await assert.rejects(service.setSharedApprovalPolicy("event-A", "admin", null), /revision/);
  assert.equal(calls.length, 1);
});

function policyHarness({ isAdmin = true, confirm = true, fail = false, liveSubmission = false } = {}) {
  const requests = [];
  const context = {
    state: { event: {
      id: "event-A", templateId: "koshien",
      status: "resultWait", approvalPolicy: "half",
    } },
    koshienSharedApprovalBusy: false,
    koshienSharedApprovalView: {
      eventId: "event-A", loadedFromDb: true, revision: 4,
      event_status: "resultWait", submission_status: liveSubmission ? "submitted" : "none",
    },
    koshienApprovalPolicyNotice: { eventId: "", message: "" },
    currentAuthUser: () => ({ id: "owner" }),
    isOnlineKoshienResultFlow: () => true,
    isCurrentUserAdmin: () => isAdmin,
    renderApprovalPolicy() {},
    render() {},
    refreshKoshienSharedApprovalState: async () => {},
    async loadKoshienOnlineState() {
      context.state.event.approvalPolicy = "unanimous";
      return { ok: true };
    },
    window: {
      confirm: () => confirm,
      YosoDataService: {
        koshien: {
          async setSharedApprovalPolicy(...args) {
            requests.push(args);
            if (fail) throw new Error("RPC was rejected");
            return { event_id: "event-A", policy: "unanimous", revision: 5, changed: true,
              requires_resubmission: true };
          },
        },
      },
    },
  };
  vm.createContext(context);
  const start = appSource.indexOf("async function updateKoshienSharedApprovalPolicy(");
  const end = appSource.indexOf("\nfunction renderApprovalPolicy()", start);
  assert.ok(start > 0 && end > start);
  vm.runInContext(appSource.slice(start, end), context);
  return { context, requests };
}

test("policy change applies only after successful server response and fresh snapshot", async () => {
  const { context, requests } = policyHarness();
  await context.updateKoshienSharedApprovalPolicy("unanimous");
  assert.deepEqual(requests, [["event-A", "unanimous", 4]]);
  assert.equal(context.state.event.approvalPolicy, "unanimous");
  assert.match(context.koshienApprovalPolicyNotice.message, /保存しました/);
  assert.equal(context.koshienSharedApprovalBusy, false);
});

test("failed policy RPC never changes the existing local policy", async () => {
  const { context, requests } = policyHarness({ fail: true });
  await context.updateKoshienSharedApprovalPolicy("unanimous");
  assert.equal(context.state.event.approvalPolicy, "half");
  assert.equal(requests.length, 1);
  assert.match(context.koshienApprovalPolicyNotice.message, /RPC was rejected/);
  assert.equal(context.koshienSharedApprovalBusy, false);
});

test("non-admin and unconfirmed in-progress policy changes never call the server", async () => {
  const member = policyHarness({ isAdmin: false });
  await member.context.updateKoshienSharedApprovalPolicy("unanimous");
  assert.equal(member.requests.length, 0);
  const unconfirmed = policyHarness({ liveSubmission: true, confirm: false });
  await unconfirmed.context.updateKoshienSharedApprovalPolicy("unanimous");
  assert.equal(unconfirmed.requests.length, 0);
  assert.equal(unconfirmed.context.state.event.approvalPolicy, "half");
});
