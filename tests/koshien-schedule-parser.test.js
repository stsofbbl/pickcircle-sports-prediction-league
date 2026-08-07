const test = require("node:test");
const assert = require("node:assert/strict");

const parserPromise = import("../supabase/functions/_shared/jhbf-schedule-parser.mjs");

test("JHBF schedule parser reads split date/day cells and Japanese start times", async () => {
  const { parseJhbfScheduleHtml } = await parserPromise;
  const html = `
    <table>
      <tr><td>8月8日(土)</td><td>（第4日）</td><td>7:00</td><td>8時00分</td><td>第1試合(1回戦)</td></tr>
      <tr><td></td><td></td><td></td><td>13時30分</td><td>第2試合(1回戦)</td></tr>
      <tr><td>8月9日(日)</td><td>（第5日）</td><td>7:00</td><td>8時00分</td><td>第1試合(1回戦)</td></tr>
    </table>`;
  const parsed = parseJhbfScheduleHtml(html, { year: 2026 });
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows.length, 3);
  assert.deepEqual(parsed.rows[0], {
    dayNo: 4,
    dailyMatchNo: 1,
    month: 8,
    day: 8,
    scheduledTime: "08:00",
    startsAt: "2026-08-08T08:00:00+09:00",
    roundLabel: "1回戦",
  });
  assert.equal(parsed.rows[1].startsAt, "2026-08-08T13:30:00+09:00");
  assert.equal(parsed.rows[2].startsAt, "2026-08-09T08:00:00+09:00");
});

test("attachStartsAt maps tournament game labels without guessing", async () => {
  const { attachStartsAt } = await parserPromise;
  const result = attachStartsAt([
    { roundKey: "R1", matchNo: 8, gameLabel: "第4日 第1試合" },
    { roundKey: "R2", matchNo: 1, gameLabel: "第6日 第3試合" },
  ], [
    { dayNo: 4, dailyMatchNo: 1, startsAt: "2026-08-08T08:00:00+09:00", scheduledTime: "08:00" },
    { dayNo: 6, dailyMatchNo: 3, startsAt: "2026-08-10T16:00:00+09:00", scheduledTime: "16:00" },
  ]);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.rows[0].startsAt, "2026-08-08T08:00:00+09:00");
  assert.equal(result.rows[1].startsAt, "2026-08-10T16:00:00+09:00");
});
