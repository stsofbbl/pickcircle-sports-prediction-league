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

test("deduplicates identical representative rows by district and school", async () => {
  const api = await parser();
  const result = api.parseJhbfRepresentativeTeamsHtml(`
    <table>
      <tr><th>地方大会</th><th>代表校</th></tr>
      <tr><td>北北海道</td><td>白樺学園</td></tr>
      <tr><td>北北海道</td><td>白樺学園</td></tr>
      <tr><td>南北海道</td><td>札幌日大</td></tr>
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
  assert.deepEqual(result.warnings, ["duplicate_representative_row:北北海道:白樺学園"]);
});

function startRoundTournamentHtml(gameCount = 17) {
  return Array.from({ length: gameCount }, (_, index) => `
    <table class="tournamentTable">
      <tr><td class="teamName">第${index + 1}高校A (地区${index + 1}A)</td><td></td></tr>
      <tr><td>&nbsp;</td><td colspan="3" class="gameDay">第${index + 1}日 第1試合</td></tr>
      <tr><td class="teamName">第${index + 1}高校B (地区${index + 1}B)</td><td></td></tr>
      <tr><td></td><td></td><td></td><td colspan="3" class="gameDay">第${index + 7}日 第1試合</td></tr>
    </table>
  `).join("");
}

test("parses exactly 17 first-round games and 34 schools from the summer bracket", async () => {
  const api = await parser();
  const result = api.parseJhbfStartRoundsHtml(fixture("jhbf-2026-tournament-sanitized.html"), {
    sourceUrl: "https://www.jhbf.or.jp/sensyuken/2026/tournament/",
    competitionType: "summer",
    year: 2026,
  });

  assert.equal(result.rows.length, 34);
  assert.equal(result.matches.length, 17);
  assert.equal(new Set(result.rows.map((row) => row.gameLabel)).size, 17);
  assert.deepEqual(result.matches[0], {
    roundKey: "R1",
    matchNo: 1,
    gameLabel: "第1日 第1試合",
    teamA: { schoolName: "札幌日大", districtName: "南北海道" },
    teamB: { schoolName: "仙台育英", districtName: "宮城" },
  });
  assert.deepEqual(result.rows.slice(0, 2).map((row) => [row.schoolName, row.districtName]), [
    ["札幌日大", "南北海道"],
    ["仙台育英", "宮城"],
  ]);
  assert.deepEqual(result.rows.slice(-2).map((row) => row.schoolName), ["横浜", "沖縄尚学"]);
  assert.deepEqual(result.warnings, []);
});

test("reports an abnormal bracket instead of treating it as complete", async () => {
  const api = await parser();
  const result = api.parseJhbfStartRoundsHtml(startRoundTournamentHtml(16), {
    competitionType: "summer",
    year: 2026,
  });

  assert.equal(result.rows.length, 32);
  assert.equal(result.matches.length, 16);
  assert.deepEqual(result.warnings, ["first_round_game_count:16", "first_round_team_count:32"]);
});

test("reports 18 games and duplicate schools instead of accepting an invalid official draw", async () => {
  const api = await parser();
  const tooMany = api.parseJhbfStartRoundsHtml(startRoundTournamentHtml(18), {
    competitionType: "summer",
    year: 2026,
  });
  assert.equal(tooMany.matches.length, 18);
  assert.deepEqual(tooMany.warnings, ["first_round_game_count:18", "first_round_team_count:36"]);

  const duplicate = api.parseJhbfStartRoundsHtml(
    startRoundTournamentHtml(17).replace("第2高校A (地区2A)", "第1高校A (地区1A)"),
    { competitionType: "summer", year: 2026 },
  );
  assert.ok(duplicate.warnings.includes("duplicate_first_round_team:地区1A:第1高校A"));
});
