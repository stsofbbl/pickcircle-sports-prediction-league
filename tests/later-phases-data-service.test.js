const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "js", "data-service.js"), "utf8");

function loadService() {
  const calls = [];
  const client = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { ok: true }, error: null }; } };
  const window = {
    location: { href: "https://example.test/" },
    YosoSupabase: {
      config: () => ({ sync: { autoSaveKoshien: true } }),
      hasConfig: () => true,
      client: async () => client,
      sessionUser: async () => ({ id: "user-1" }),
    },
  };
  vm.runInNewContext(source, { console, window, localStorage: { getItem() {}, setItem() {} } });
  return { service: window.YosoDataService, calls };
}

test("later phase reads use one participant-safe aggregate RPC", async () => {
  const { service, calls } = loadService();
  await service.koshien.loadLaterPhaseState("event-1");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { name: "refresh_koshien_phase_schedule", args: { p_event_id: "event-1" } },
    { name: "get_koshien_later_phase_state", args: { p_event_id: "event-1" } },
  ]);
});

test("admin can explicitly open and lock a prepared later phase", async () => {
  const { service, calls } = loadService();
  await service.koshien.setLaterPhaseStatus({ eventId: "event-1", phase: "best16", action: "open" });
  await service.koshien.setLaterPhaseStatus({ eventId: "event-1", phase: "phase3", action: "lock" });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { name: "set_koshien_later_phase_status", args: { p_event_id: "event-1", p_phase_key: "best16", p_action: "open" } },
    { name: "set_koshien_later_phase_status", args: { p_event_id: "event-1", p_phase_key: "phase3", p_action: "lock" } },
  ]);
});

test("admin result reopen uses one event-scoped atomic RPC", async () => {
  const { service, calls } = loadService();
  await service.koshien.reopenKoshienResults("event-1");
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { name: "reopen_koshien_results", args: { p_event_id: "event-1" } },
  ]);
});

test("revenge zombie and phase 3 saves send only server-owned IDs scores version and request ID", async () => {
  const { service, calls } = loadService();
  await service.koshien.saveRevengePick({ eventId: "event-1", teamId: "team-1", version: 2, requestId: "request-1" });
  await service.koshien.saveZombiePrediction({ eventId: "event-1", teamId: "team-2", version: 3, requestId: "request-2" });
  await service.koshien.savePhase3Prediction({ eventId: "event-1", scoreA: 5, scoreB: 3, version: 4, requestId: "request-3" });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { name: "save_koshien_revenge_pick", args: { p_event_id: "event-1", p_target_team_id: "team-1", p_expected_version: 2, p_request_id: "request-1" } },
    { name: "save_koshien_zombie_prediction", args: { p_event_id: "event-1", p_target_team_id: "team-2", p_expected_version: 3, p_request_id: "request-2" } },
    { name: "save_koshien_phase3_prediction", args: { p_event_id: "event-1", p_score_a: 5, p_score_b: 3, p_expected_version: 4, p_request_id: "request-3" } },
  ]);
});

test("admin preparation uses explicit event schedule without participant identities", async () => {
  const { service, calls } = loadService();
  await service.koshien.prepareLaterPhase({ eventId: "event-1", phase: "best16", opensAt: "2026-07-22T10:00:00Z", deadlineAt: "2026-07-23T10:00:00Z" });
  await service.koshien.prepareLaterPhase({ eventId: "event-1", phase: "zombie", opensAt: "2026-07-24T10:00:00Z", deadlineAt: "2026-07-25T10:00:00Z" });
  await service.koshien.prepareLaterPhase({ eventId: "event-1", phase: "phase3", opensAt: "2026-07-26T10:00:00Z", deadlineAt: "2026-07-27T10:00:00Z" });
  assert.deepEqual(calls.map((call) => call.name), [
    "prepare_koshien_best16_phases",
    "prepare_koshien_zombie_phase",
    "prepare_koshien_phase3",
  ]);
  assert.equal(JSON.stringify(calls).includes("player"), false);
});
