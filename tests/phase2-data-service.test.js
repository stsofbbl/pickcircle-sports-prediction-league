const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const DATA_SERVICE_PATH = path.join(__dirname, "..", "js", "data-service.js");

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function draftState(version = 1) {
  return { draft: { id: "draft-1", event_id: "event-1", version }, players: [], teams: [], picks: [], viewer_player_id: "player-1" };
}

function loadService({ user = { id: "user-1" }, rpcHandler } = {}) {
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      return rpcHandler ? rpcHandler(name, args, calls) : Promise.resolve({ data: null, error: null });
    },
  };
  const window = {
    location: { href: "https://example.test/" },
    YosoSupabase: {
      config: () => ({ inviteCode: "league-code", sync: { autoSaveKoshien: true } }),
      hasConfig: () => true,
      client: async () => client,
      sessionUser: async () => user,
    },
  };
  vm.runInNewContext(fs.readFileSync(DATA_SERVICE_PATH, "utf8"), { console, window, localStorage: { getItem() {}, setItem() {} } });
  return { service: window.YosoDataService, calls };
}

test("loadPhase2DraftState uses the dedicated read RPC", async () => {
  const expected = draftState();
  const { service, calls } = loadService({
    rpcHandler: async () => ({ data: expected, error: null }),
  });
  const result = await service.koshien.loadPhase2DraftState("event-1");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), expected);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ name: "get_koshien_phase2_draft_state", args: { p_event_id: "event-1" } }]);
});

test("savePhase2DraftPick sends one ID-only RPC and never writes a raw prediction", async () => {
  const expected = draftState(2);
  const { service, calls } = loadService({
    rpcHandler: async () => ({ data: expected, error: null }),
  });
  const result = await service.koshien.savePhase2DraftPick({
    eventId: "event-1",
    draftId: "draft-1",
    teamId: "team-3",
    pickNo: 3,
    requestId: "request-1",
  });
  assert.equal(result.draft.version, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{
    name: "save_koshien_phase2_draft_pick",
    args: { p_draft_id: "draft-1", p_team_id: "team-3", p_expected_pick_no: 3, p_request_id: "request-1" },
  }]);
  assert.equal(calls.some((call) => call.name.includes("snapshot") || call.name.includes("prediction")), false);
});

test("same in-flight payload is sent once for a double click", async () => {
  const pending = deferred();
  const { service, calls } = loadService({
    rpcHandler: () => pending.promise,
  });
  const payload = { eventId: "event-1", draftId: "draft-1", teamId: "team-1", pickNo: 1, requestId: "request-1" };
  const first = service.koshien.savePhase2DraftPick(payload);
  const second = service.koshien.savePhase2DraftPick(payload);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  pending.resolve({ data: draftState(2), error: null });
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(firstResult.draft.version, 2);
  assert.equal(secondResult.draft.version, 2);
});

test("different payload for the same in-flight pick is rejected client-side", async () => {
  const pending = deferred();
  const { service, calls } = loadService({ rpcHandler: () => pending.promise });
  const first = service.koshien.savePhase2DraftPick({ eventId: "event-1", draftId: "draft-1", teamId: "team-1", pickNo: 1, requestId: "request-1" });
  await assert.rejects(
    service.koshien.savePhase2DraftPick({ eventId: "event-1", draftId: "draft-1", teamId: "team-2", pickNo: 1, requestId: "request-2" }),
    (error) => error?.code === "phase2_save_in_progress",
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  pending.resolve({ data: draftState(2), error: null });
  await first;
});

test("conflict reloads formal state and attaches it to the retryable error", async () => {
  const latest = draftState(4);
  const { service, calls } = loadService({
    rpcHandler: async (name) => name === "save_koshien_phase2_draft_pick"
      ? { data: null, error: { code: "40001", message: "draft turn changed" } }
      : { data: latest, error: null },
  });
  await assert.rejects(
    service.koshien.savePhase2DraftPick({ eventId: "event-1", draftId: "draft-1", teamId: "team-3", pickNo: 3, requestId: "request-3" }),
    (error) => error?.retryable === true && error?.latestState?.draft?.version === 4,
  );
  assert.deepEqual(calls.map((call) => call.name), ["save_koshien_phase2_draft_pick", "get_koshien_phase2_draft_state"]);
});

test("unauthenticated phase 2 calls fail before RPC", async () => {
  const { service, calls } = loadService({ user: null });
  await assert.rejects(service.koshien.loadPhase2DraftState("event-1"), /ログイン/);
  await assert.rejects(service.koshien.savePhase2DraftPick({ eventId: "event-1", draftId: "draft-1", teamId: "team-1", pickNo: 1, requestId: "request-1" }), /ログイン/);
  assert.equal(calls.length, 0);
});

test("legacy snapshot path cannot delete or bulk insert formal phase 2 picks", () => {
  const source = fs.readFileSync(DATA_SERVICE_PATH, "utf8");
  assert.doesNotMatch(source, /\.from\("phase2_draft_picks"\)/);
  assert.match(source, /save_koshien_phase2_draft_pick/);
});
