const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const serviceSource = fs.readFileSync(path.join(__dirname, "../js/data-service.js"), "utf8");

function serviceHarness({ user = { id: "admin" }, row = { id: "event-1", status: "archive", archived_at: "now" }, error = null } = {}) {
  const calls = [];
  const query = {
    update(value) { calls.push(["update", value]); return this; },
    eq(key, value) { calls.push(["eq", key, value]); return this; },
    is(key, value) { calls.push(["is", key, value]); return this; },
    select(value) { calls.push(["select", value]); return this; },
    async maybeSingle() { return { data: row, error }; },
  };
  const window = { YosoSupabase: {
    client: async () => ({ from: (table) => { calls.push(["from", table]); return query; } }),
    sessionUser: async () => user,
  }};
  vm.runInNewContext(serviceSource, { window, localStorage: {} });
  return { calls, archive: window.YosoDataService.koshien.archiveEvent };
}

test("archive writes both status and archived_at with finalized precondition", async () => {
  const { calls, archive } = serviceHarness();
  await archive({ eventId: "event-1" });
  assert.equal(calls[0][1], "events");
  assert.equal(calls[1][1].status, "archive");
  assert.ok(!Number.isNaN(Date.parse(calls[1][1].archived_at)));
  assert.ok(calls.some((x) => x[0] === "eq" && x[1] === "status" && x[2] === "finalized"));
  assert.ok(calls.some((x) => x[0] === "eq" && x[1] === "preset_type" && x[2] === "koshien"));
  assert.ok(calls.some((x) => x[0] === "is" && x[1] === "archived_at" && x[2] === null));
});

test("archive rejects unauthenticated and stale or unauthorized updates", async () => {
  const noUser = serviceHarness({ user: null });
  await assert.rejects(noUser.archive({ eventId: "event-1" }), /ログイン/);
  assert.equal(noUser.calls.length, 0);
  const missing = serviceHarness({ row: null });
  await assert.rejects(missing.archive({ eventId: "event-1" }), /状態が変更されたか/);
  const denied = serviceHarness({ error: { code: "42501", message: "denied" } });
  await assert.rejects(denied.archive({ eventId: "event-1" }), /denied/);
});

function actionHarness({ requestedStatus = "archive", confirmed = true, admin = true,
  loadedId = "event-1", serverError = false, refreshOk = true,
  userId = "admin", leagueId = "club-1", switchLeagueAfterSave = false } = {}) {
  const calls = [];
  const item = { id: "event-1", name: "大会", status: "finalized", resultFlow: { status: "finalized" } };
  const ctx = {
    state: { activeEventId: "event-1", event: item },
    loadedKoshienOnlineEventId: loadedId,
    currentAuthUser: () => userId ? { id: userId } : null,
    onlineLeagueId: leagueId,
    isResultFinalized: (value) => value.resultFlow.status === "finalized",
    isClubAdmin: () => admin,
    alert: (message) => calls.push(["alert", message]),
    confirm: () => { calls.push(["confirm"]); return confirmed; },
    window: { YosoDataService: { koshien: { archiveEvent: async (args) => {
      calls.push(["server", args, item.status]);
      if (serverError) throw new Error("server rejected");
      if (switchLeagueAfterSave) ctx.onlineLeagueId = "club-2";
      return { id: item.id, status: "archive" };
    }}}},
    loadKoshienOnlineState: async ({ force, exactEventId, expectedLeagueId }) => {
      calls.push(["refresh", force, exactEventId, expectedLeagueId]);
      return refreshOk ? { ok: true, event: { id: item.id, status: "archive" } } : null;
    },
  };
  vm.createContext(ctx);
  const start = appSource.indexOf("let onlineKoshienArchiveBusy = false;");
  const end = appSource.indexOf('document.addEventListener("click", async (event) => {', start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(appSource.slice(start, end), ctx);
  return { ctx, item, calls, requestedStatus };
}

test("archive action waits for server and forced reload without local status mutation", async () => {
  const { ctx, item, calls } = actionHarness();
  await ctx.archiveOnlineKoshienEvent(item, "archive");
  assert.deepEqual(calls.map((x) => x[0]), ["confirm", "server", "refresh"]);
  assert.equal(calls[1][2], "finalized");
  assert.deepEqual(calls[2], ["refresh", true, "event-1", "club-1"]);
  assert.equal(item.status, "finalized");
});

test("archive action rejects other transitions, stale event and failed persistence", async () => {
  for (const options of [
    { requestedStatus: "open" }, { admin: false }, { loadedId: "other" },
    { confirmed: false }, { serverError: true }, { refreshOk: false },
  ]) {
    const { ctx, item, calls, requestedStatus } = actionHarness(options);
    await ctx.archiveOnlineKoshienEvent(item, requestedStatus);
    assert.equal(item.status, "finalized");
    if (requestedStatus !== "archive" || options.admin === false || options.loadedId === "other" || options.confirmed === false) {
      assert.equal(calls.some((x) => x[0] === "server"), false);
    }
    if (options.serverError || options.refreshOk === false) {
      assert.ok(calls.some((x) => x[0] === "alert"));
    }
  }
});

test("archive action fails closed without actor or club and ignores a stale club response", async () => {
  for (const options of [{ userId: "" }, { leagueId: "" }]) {
    const { ctx, item, calls } = actionHarness(options);
    await ctx.archiveOnlineKoshienEvent(item, "archive");
    assert.deepEqual(calls.map((x) => x[0]), ["confirm", "alert"]);
    assert.equal(item.status, "finalized");
  }
  const { ctx, item, calls } = actionHarness({ switchLeagueAfterSave: true });
  await ctx.archiveOnlineKoshienEvent(item, "archive");
  assert.deepEqual(calls.map((x) => x[0]), ["confirm", "server"]);
  assert.equal(item.status, "finalized");
});

test("online Koshien status buttons do not offer local-only transitions", () => {
  assert.match(appSource, /const availableStatuses = onlineKoshien/);
  assert.match(appSource, /event.status === "finalized" && finalized \? \["archive"\] : \[\]/);
  assert.match(appSource, /await archiveOnlineKoshienEvent\(item, statusButton.dataset.eventStatus\)/);
});

test("online finalized Koshien DELETE UI has the same guard as the RLS policy", () => {
  const start = appSource.indexOf("function isProtectedOnlineKoshienEvent(event) {");
  const end = appSource.indexOf("let koshienAdminFinalizeBusy", start);
  assert.ok(start >= 0 && end > start);
  const context = {
    isSupabaseAuthEnabled: () => true,
    currentAuthUser: () => ({ id: "owner" }),
    baseTemplateId: (id) => id,
  };
  vm.createContext(context);
  vm.runInContext(appSource.slice(start, end), context);
  const guarded = context.isProtectedOnlineKoshienEvent;
  const event = (templateId, status, resultStatus) => ({
    templateId, status, resultFlow: { status: resultStatus },
  });
  assert.equal(guarded(event("koshien", "finalized", "finalized")), true);
  assert.equal(guarded(event("koshien", "archive", "none")), true);
  assert.equal(guarded(event("koshien", "resultWait", "finalized")), true);
  assert.equal(guarded(event("koshien", "resultWait", "none")), false);
  assert.equal(guarded(event("worldCup", "finalized", "finalized")), false);
  context.currentAuthUser = () => null;
  assert.equal(guarded(event("koshien", "finalized", "finalized")), false);
  assert.match(appSource, /isProtectedOnlineKoshienEvent\(event\) \? "" : /);
  assert.match(appSource, /if \(isProtectedOnlineKoshienEvent\(target\)\)/);
});
