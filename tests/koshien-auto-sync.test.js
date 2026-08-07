const test = require("node:test");
const assert = require("node:assert/strict");

const corePromise = import("../supabase/functions/_shared/koshien-auto-sync-core.mjs");

test("schedule sync runs when the official R1/R2 schedule is still missing", async () => {
  const { scheduleDecision } = await corePromise;
  const matches = [
    ...Array.from({ length: 17 }, (_, index) => ({ round_key: "R1", match_no: index + 1, starts_at: null })),
    ...Array.from({ length: 16 }, (_, index) => ({ round_key: "R2", match_no: index + 1, starts_at: null })),
  ];
  assert.deepEqual(scheduleDecision(matches, {}, new Date("2026-08-08T05:45:00+09:00")), {
    due: true,
    reason: "missing_schedule",
  });
});

test("schedule sync uses morning and pregame checks without polling all day", async () => {
  const { scheduleDecision } = await corePromise;
  const matches = [
    ...Array.from({ length: 17 }, (_, index) => ({
      round_key: "R1",
      match_no: index + 1,
      starts_at: index === 7 ? "2026-08-08T08:00:00+09:00" : `2026-08-${String(index < 7 ? 5 + Math.floor(index / 2) : 9).padStart(2, "0")}T13:30:00+09:00`,
    })),
    ...Array.from({ length: 16 }, (_, index) => ({ round_key: "R2", match_no: index + 1, starts_at: `2026-08-${String(10 + Math.floor(index / 4)).padStart(2, "0")}T16:00:00+09:00` })),
  ];
  assert.equal(scheduleDecision(matches, {}, new Date("2026-08-08T05:15:00+09:00")).reason, "matchday_morning");
  assert.equal(scheduleDecision(matches, { schedule_morning_date: "2026-08-08" }, new Date("2026-08-08T07:15:00+09:00")).reason, "pregame_check");
  assert.deepEqual(scheduleDecision(matches, {
    schedule_morning_date: "2026-08-08",
    schedule_pregame_date: "2026-08-08",
  }, new Date("2026-08-08T12:00:00+09:00")), { due: false, reason: "not_due" });
});

test("result polling starts only after the expected finish window", async () => {
  const { dueResultDates, pendingDueMatches } = await corePromise;
  const matches = [
    { id: "a", status: "scheduled", team1_id: "t1", team2_id: "t2", starts_at: "2026-08-08T08:00:00+09:00" },
    { id: "b", status: "scheduled", team1_id: "t3", team2_id: "t4", starts_at: "2026-08-08T13:30:00+09:00" },
    { id: "c", status: "completed", team1_id: "t5", team2_id: "t6", starts_at: "2026-08-08T08:00:00+09:00" },
  ];
  assert.equal(pendingDueMatches(matches, new Date("2026-08-08T09:30:00+09:00")).length, 0);
  assert.deepEqual(pendingDueMatches(matches, new Date("2026-08-08T09:45:00+09:00")).map((match) => match.id), ["a"]);
  assert.deepEqual(dueResultDates(matches, new Date("2026-08-08T09:45:00+09:00")), ["2026-08-08"]);
});

test("automatic result mapping accepts exact matches and blocks manual cancellations", async () => {
  const { buildCanonicalResultRows } = await corePromise;
  const teams = [
    { id: "11111111-1111-1111-1111-111111111111", name: "高校A" },
    { id: "22222222-2222-2222-2222-222222222222", name: "高校B" },
  ];
  const matches = [{
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    round_key: "R1",
    match_no: 1,
    team1_id: teams[0].id,
    team2_id: teams[1].id,
    status: "scheduled",
  }];
  const source = [{
    teamANameRaw: "高校A",
    teamBNameRaw: "高校B",
    teamAScore: 2,
    teamBScore: 5,
    roundKey: "R1",
    externalKey: "jhbf:summer:2026:2026-08-08:1",
    matchDate: "2026-08-08",
    dailyMatchNo: 1,
    sourceUrl: "https://www.jhbf.or.jp/sensyuken/2026/schedule/schedule_20260808.html",
    fetchedAt: "2026-08-08T01:00:00.000Z",
  }];
  const allowed = new Set([matches[0].id]);
  const ready = buildCanonicalResultRows(source, { teams, aliases: [], matches, imports: [] }, allowed);
  assert.equal(ready.ready.length, 1);
  assert.equal(ready.ready[0].team1Score, 2);
  assert.equal(ready.ready[0].team2Score, 5);
  assert.equal(ready.ready[0].winnerTeamId, teams[1].id);

  const blocked = buildCanonicalResultRows(source, {
    teams,
    aliases: [],
    matches,
    imports: [{ external_key: source[0].externalKey, status: "canceled", normalized_payload: ready.ready[0].normalizedPayload }],
  }, allowed);
  assert.equal(blocked.ready.length, 0);
  assert.equal(blocked.skipped[0].reason, "manual_cancel_block");
});
