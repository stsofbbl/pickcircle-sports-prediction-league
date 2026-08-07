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

test("JHBF schedule parser keeps day context across linked completed rows", async () => {
  const { parseJhbfScheduleHtml } = await parserPromise;
  const html = `
    <table>
      <tr>
        <td rowspan="2"><a href="schedule_20260805.html">8月5日(水)</a><br>（<a href="schedule_20260805.html">第1日</a>）</td>
        <td rowspan="2">15:00</td><td>16時00分</td><td>開会式</td>
      </tr>
      <tr><td>17時39分</td><td>第1試合(1回戦)</td></tr>
      <tr>
        <td rowspan="2"><a href="schedule_20260806.html">8月6日(木)</a><br>（<a href="schedule_20260806.html">第2日</a>）</td>
        <td rowspan="2">15:00</td><td>16時02分</td><td>第1試合(1回戦)</td>
      </tr>
      <tr><td>18時43分</td><td>第2試合(1回戦)</td></tr>
      <tr>
        <td rowspan="4"><a href="schedule_20260807.html">8月7日(金)</a><br>（<a href="schedule_20260807.html">第3日</a>）</td>
        <td rowspan="4">7:00</td><td>8時02分</td><td>第1試合(1回戦)</td>
      </tr>
      <tr><td>13時32分</td><td>第2試合(1回戦)</td></tr>
      <tr><td>16時15分</td><td>第3試合(1回戦)</td></tr>
      <tr><td>18時58分</td><td>第4試合(1回戦)</td></tr>
    </table>`;
  const parsed = parseJhbfScheduleHtml(html, { year: 2026 });
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.rows.length, 7);
  assert.deepEqual(parsed.rows.map((row) => [row.dayNo, row.dailyMatchNo, row.scheduledTime]), [
    [1, 1, "17:39"],
    [2, 1, "16:02"], [2, 2, "18:43"],
    [3, 1, "08:02"], [3, 2, "13:32"], [3, 3, "16:15"], [3, 4, "18:58"],
  ]);
});

test("tournament schedule slot parser reads exactly the R1 and R2 game-day columns", async () => {
  const { parseJhbfTournamentScheduleSlots } = await parserPromise;
  const r1 = Array.from({ length: 17 }, (_, index) => `<tr><td></td><td class="gameDay">第${Math.floor(index / 4) + 1}日 第${(index % 4) + 1}試合</td></tr>`).join("");
  const r2 = Array.from({ length: 16 }, (_, index) => `<tr><td></td><td></td><td></td><td class="gameDay">第${Math.floor(index / 4) + 6}日 第${(index % 4) + 1}試合</td></tr>`).join("");
  const parsed = parseJhbfTournamentScheduleSlots(`<table class="tournamentTable">${r1}${r2}</table>`);
  assert.deepEqual(parsed.warnings, []);
  assert.equal(parsed.matches.length, 33);
  assert.deepEqual(parsed.matches[0], { roundKey: "R1", matchNo: 1, gameLabel: "第1日 第1試合" });
  assert.deepEqual(parsed.matches[17], { roundKey: "R2", matchNo: 1, gameLabel: "第6日 第1試合" });
  assert.deepEqual(parsed.matches.at(-1), { roundKey: "R2", matchNo: 16, gameLabel: "第9日 第4試合" });
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
