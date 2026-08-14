import assert from "node:assert/strict";
import {
  buildLateScheduleRows,
  pairRoundTeams,
  parseJhbfFinalSchedule,
  parseJhbfRedrawTeams,
  pendingRedrawRound,
} from "./koshien-bracket-sync-core.mjs";

const html = `
<h5>準々決勝の組み合わせ(上が1塁側)</h5>
<table class="tournamentTable">
${["A (a)", "B (b)", "C (c)", "D (d)", "E (e)", "F (f)", "G (g)", "H (h)"].map((name) => `<tr><td class="teamName">${name}</td></tr>`).join("\n")}
</table>
<h5>準決勝、決勝の組み合わせ(上が1塁側)</h5>
<table class="tournamentTable">
${["A (a)", "D (d)", "F (f)", "H (h)"].map((name) => `<tr><td class="teamName">${name}</td></tr>`).join("\n")}
</table>`;
assert.deepEqual(parseJhbfRedrawTeams(html), {
  qf: ["A", "B", "C", "D", "E", "F", "G", "H"],
  sf: ["A", "D", "F", "H"],
});

assert.deepEqual(pairRoundTeams("QF", ["1","2","3","4","5","6","7","8"]), [
  { round_key: "QF", match_no: 1, team1_id: "1", team2_id: "2" },
  { round_key: "QF", match_no: 2, team1_id: "3", team2_id: "4" },
  { round_key: "QF", match_no: 3, team1_id: "5", team2_id: "6" },
  { round_key: "QF", match_no: 4, team1_id: "7", team2_id: "8" },
]);

const r3Completed = Array.from({ length: 8 }, (_, i) => ({ round_key: "R3", match_no: i + 1, status: "completed", winner_team_id: `w${i + 1}` }));
assert.equal(pendingRedrawRound(r3Completed), "QF");
assert.equal(pendingRedrawRound([...r3Completed, { round_key: "QF", match_no: 1, status: "scheduled" }]), "");

const scheduleRows = [
  ...Array.from({ length: 8 }, (_, i) => ({ roundLabel: "3回戦", dayNo: 11 + Math.floor(i / 4), dailyMatchNo: (i % 4) + 1, startsAt: `2026-08-${15 + Math.floor(i / 4)}T0${8 + (i % 4) * 2}:00:00+09:00` })),
  ...Array.from({ length: 4 }, (_, i) => ({ roundLabel: "準々決勝", dayNo: 13, dailyMatchNo: i + 1, startsAt: `2026-08-18T0${8 + i * 2}:00:00+09:00` })),
];
const existing = [
  ...Array.from({ length: 8 }, (_, i) => ({ round_key: "R3", match_no: i + 1 })),
  ...Array.from({ length: 4 }, (_, i) => ({ round_key: "QF", match_no: i + 1 })),
];
const late = buildLateScheduleRows(scheduleRows, existing);
assert.equal(late.length, 12);
assert.deepEqual(late[0], { round_key: "R3", match_no: 1, starts_at: scheduleRows[0].startsAt, tournament_day_no: 11, daily_match_no: 1 });
assert.deepEqual(late.at(-1), { round_key: "QF", match_no: 4, starts_at: scheduleRows.at(-1).startsAt, tournament_day_no: 13, daily_match_no: 4 });


const finalRow = parseJhbfFinalSchedule(`
  <table><tr><td>8月22日(土)</td><td>（第15日）</td><td>8:30</td><td>10時00分</td><td>決勝</td></tr></table>
`, 2026);
assert.deepEqual(finalRow, {
  dayNo: 15, dailyMatchNo: 1, month: 8, day: 22, scheduledTime: "10:00",
  startsAt: "2026-08-22T10:00:00+09:00", roundLabel: "決勝",
});

console.log("koshien bracket sync core tests passed");
