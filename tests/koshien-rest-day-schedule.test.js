const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const scheduleParserUrl = pathToFileURL(path.join(__dirname, "../supabase/functions/_shared/jhbf-schedule-parser.mjs")).href;
const bracketCoreUrl = pathToFileURL(path.join(__dirname, "../supabase/functions/_shared/koshien-bracket-sync-core.mjs")).href;

const officialLateScheduleFixture = `
<table>
  <tr><td>8月18日(火)<br>（第13日）</td><td>8時00分 第1試合(準々決勝)<br>10時30分 第2試合(準々決勝)<br>13時00分 第3試合(準々決勝)<br>15時30分 第4試合(準々決勝)</td></tr>
  <tr><td>8月19日(水)</td><td>休養日</td></tr>
  <tr><td>8月20日(木)<br>（第14日）</td><td>8時00分 第1試合(準決勝)<br>10時30分 第2試合(準決勝)</td></tr>
  <tr><td>8月21日(金)</td><td>休養日</td></tr>
  <tr><td>8月22日(土)<br>（第15日）</td><td>10時00分 決勝</td></tr>
</table>`;

test("late schedule parser does not attach a tournament day to the preceding rest day", async () => {
  const { parseJhbfScheduleHtml } = await import(scheduleParserUrl);
  const parsed = parseJhbfScheduleHtml(officialLateScheduleFixture, { year: 2026 });
  const semifinals = parsed.rows.filter((row) => String(row.roundLabel).includes("準決勝"));
  assert.equal(semifinals.length, 2);
  assert.deepEqual(semifinals.map((row) => row.startsAt), [
    "2026-08-20T08:00:00+09:00",
    "2026-08-20T10:30:00+09:00",
  ]);
  assert.equal(parsed.rows.some((row) => row.startsAt.startsWith("2026-08-19")), false);
});

test("final parser stays on the final row after the second rest day", async () => {
  const { parseJhbfFinalSchedule } = await import(bracketCoreUrl);
  const final = parseJhbfFinalSchedule(officialLateScheduleFixture, 2026);
  assert.ok(final);
  assert.equal(final.dayNo, 15);
  assert.equal(final.startsAt, "2026-08-22T10:00:00+09:00");
});
