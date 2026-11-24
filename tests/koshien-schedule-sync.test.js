const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const migration = fs.readFileSync(path.join(
  __dirname,
  "../supabase/migrations/20260808044500_sync_koshien_official_schedule.sql",
), "utf8");
const browser = fs.readFileSync(path.join(__dirname, "../js/koshien-schedule-sync.js"), "utf8");

test("schedule sync RPC is admin-only, validates all 33 R1/R2 slots, and updates starts_at", () => {
  assert.match(migration, /sync_koshien_official_schedule/);
  assert.match(migration, /is_league_admin/);
  assert.match(migration, /jsonb_array_length\(p_rows\) <> 33/);
  assert.match(migration, /schedule must contain R1=17 and R2=16/);
  assert.match(migration, /set starts_at = v_effective_starts_at/);
  assert.match(migration, /results payload schedule slot mismatch/);
  assert.match(migration, /schedule_source_url/);
});

test("browser integration requires 33 official rows and provides manual plus one-time automatic sync", () => {
  assert.match(browser, /normalized\.length !== 33/);
  assert.match(browser, /jhbf-schedule/);
  assert.match(browser, /sync_koshien_official_schedule/);
  assert.match(browser, /公式日程を反映/);
  assert.match(browser, /attemptAutoSync/);
  assert.match(browser, /次戦 \$\{short\}/);
});

const vm = require("node:vm");
function scheduleFixture(options = {}) {
  const rows = Array.from({ length: 33 }, (_, i) => ({
    roundKey: i < 17 ? "R1" : "R2", matchNo: i < 17 ? i + 1 : i - 16,
    startsAt: "2027-08-10T08:00:00+09:00", tournamentDayNo: 1, dailyMatchNo: i + 1,
  }));
  const event = { id: "event-a", templateId: "koshien", season: "2027", config: { externalResults: { year: 2026 } } };
  const calls = [];
  const ctx = {
    state: { event }, onlineLeagueId: "league-a", authId: "admin",
    canCurrentUserManageLeague: () => true, currentAuthUser: () => ({ id: ctx.authId }),
    addEventListener() {}, renderDashboard() { calls.push(["render"]); },
    loadKoshienOnlineState: async (args) => { calls.push(["reload", args]); return { ok: true, event: { id: options.reloadId || "event-a" } }; },
    YosoSupabase: { client: async () => ({
      functions: { invoke: async (name, args) => {
        calls.push(["fetch", name, args]);
        if (options.switchDuringFetch) options.switchDuringFetch(ctx);
        return { data: { rows: options.wrongDate ? rows.map(row => ({ ...row, startsAt: "2026-08-10T08:00:00+09:00" })) : rows,
          scheduleSourceUrl: options.wrongUrl ? "https://www.jhbf.or.jp/sensyuken/2026/schedule/" : "https://www.jhbf.or.jp/sensyuken/2027/schedule/" } };
      } },
      rpc: async (name, args) => {
        calls.push(["save", name, args]);
        if (options.switchDuringSave) options.switchDuringSave(ctx);
        return { data: { count: 33 } };
      },
    }) },
  };
  vm.createContext(ctx);
  vm.runInContext(browser, ctx);
  return { ctx, calls, run: () => ctx.YosoKoshienScheduleSync.syncOfficialSchedule() };
}

test("schedule uses persisted season and strict reload of the same event and club", async () => {
  const f = scheduleFixture();
  await f.run();
  assert.equal(f.calls[0][2].body.year, 2027);
  assert.equal(f.calls[1][2].p_event_id, "event-a");
  assert.equal(f.calls[2][1].exactEventId, "event-a");
  assert.equal(f.calls[2][1].expectedLeagueId, "league-a");
  assert.equal(f.calls[3][0], "render");
});
test("schedule rejects wrong source URL and match year before saving", async () => {
  for (const options of [{ wrongUrl: true }, { wrongDate: true }]) {
    const f = scheduleFixture(options);
    await assert.rejects(f.run(), /年度または取得元/);
    assert.deepEqual(f.calls.map(x => x[0]), ["fetch"]);
  }
});
test("event, club and user switch while fetching prevents schedule write", async () => {
  for (const switchDuringFetch of [
    c => { c.state.event = { id: "event-b" }; },
    c => { c.onlineLeagueId = "league-b"; },
    c => { c.authId = "other"; },
  ]) {
    const f = scheduleFixture({ switchDuringFetch });
    await assert.rejects(f.run(), /対象大会/);
    assert.deepEqual(f.calls.map(x => x[0]), ["fetch"]);
  }
});
test("scope switch after save prevents stale reload and success rendering", async () => {
  const f = scheduleFixture({ switchDuringSave: c => { c.state.event = { id: "event-b" }; } });
  await assert.rejects(f.run(), /対象大会/);
  assert.deepEqual(f.calls.map(x => x[0]), ["fetch", "save"]);
});
test("wrong exact-reload ID does not become successful schedule sync", async () => {
  const f = scheduleFixture({ reloadId: "event-b" });
  await assert.rejects(f.run(), /対象大会を確認/);
  assert.deepEqual(f.calls.map(x => x[0]), ["fetch", "save", "reload"]);
});
