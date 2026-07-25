const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

async function parser() {
  return import("../supabase/functions/_shared/jhbf-parser.mjs");
}

function fixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function assertIncludes(actual, expected) {
  Object.entries(expected).forEach(([key, value]) => {
    assert.deepEqual(actual[key], value, `unexpected ${key}`);
  });
}

test("parses multiple completed 2025 summer results", async () => {
  const api = await parser();
  const result = api.parseJhbfResultsHtml(fixture("jhbf-2025-summer.html"), {
    sourceUrl: "https://www.jhbf.or.jp/sensyuken/2025/schedule/schedule_20250812.html",
    fetchedAt: "2025-08-12T06:00:00Z",
    competitionType: "summer",
    year: 2025,
    matchDate: "2025-08-12",
  });
  assert.equal(result.rows.length, 3);
  assertIncludes(result.rows[0], {
    externalKey: "jhbf:summer:2025:2025-08-12:1",
    roundKey: "R2",
    teamANameRaw: "聖光学院",
    teamBNameRaw: "山梨学院",
    teamAScore: 2,
    teamBScore: 6,
    winnerNameRaw: "山梨学院",
    status: "completed",
  });
});

test("parses an extra-inning 2026 spring result and excludes unfinished games", async () => {
  const api = await parser();
  const result = api.parseJhbfResultsHtml(fixture("jhbf-2026-senbatsu.html"), {
    sourceUrl: "https://www.jhbf.or.jp/senbatsu/2026/schedule/schedule_20260322.html",
    competitionType: "senbatsu",
    year: 2026,
    matchDate: "2026-03-22",
  });
  assert.equal(result.rows.length, 3);
  assertIncludes(result.rows[0], {
    externalKey: "jhbf:senbatsu:2026:2026-03-22:1",
    roundKey: "R1",
    teamANameRaw: "神戸国際大付",
    teamBNameRaw: "九州国際大付",
    teamAScore: 3,
    teamBScore: 4,
  });
  assert.equal(result.rows.some((row) => row.dailyMatchNo === 4), false);
});

test("returns a safe warning for unsupported html", async () => {
  const api = await parser();
  const result = api.parseJhbfResultsHtml("<html><body>maintenance</body></html>", {
    competitionType: "summer",
    year: 2026,
    matchDate: "2026-08-10",
  });
  assert.deepEqual(result.rows, []);
  assert.deepEqual(result.warnings, ["match_headings_not_found"]);
});

test("parses summer representative teams without requiring completed results", async () => {
  const api = await parser();
  const result = api.parseJhbfRepresentativeTeamsHtml(`
    <table>
      <tr><th>地方大会</th><th>代表校</th><th>出場回数</th></tr>
      <tr><td>北北海道</td><td>白樺学園</td><td>2年ぶり5回目</td></tr>
      <tr><td>南北海道</td><td>札幌日大</td><td>2年ぶり2回目</td></tr>
    </table>
  `, {
    sourceUrl: "https://www.jhbf.or.jp/sensyuken/2026/team/",
    competitionType: "summer",
    year: 2026,
  });
  assert.deepEqual(result.rows.map((row) => [row.districtName, row.schoolName]), [
    ["北北海道", "白樺学園"],
    ["南北海道", "札幌日大"],
  ]);
  assert.deepEqual(result.warnings, []);
});
