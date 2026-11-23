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
