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
