const test = require("node:test");
const assert = require("node:assert/strict");
const api = require("../js/jhbf-result-import.js");

const context = {
  teams: [
    { teamId: "a", name: "智弁和歌山" },
    { teamId: "b", name: "花巻東" },
    { teamId: "c", name: "山梨学院" },
  ],
  aliases: [
    { externalName: "智辯和歌山", normalizedExternalName: "智辯和歌山", teamId: "a" },
  ],
  imports: [],
  matches: [
    { matchId: "m1", roundKey: "R2", matchNo: 3, team1Id: "a", team2Id: "b", status: "scheduled", team1Score: null, team2Score: null, winnerTeamId: null },
  ],
};

function row(overrides = {}) {
  return {
    source: "jhbf",
    externalKey: "jhbf:summer:2026:2026-08-10:1",
    sourceUrl: "https://www.jhbf.or.jp/sensyuken/2026/schedule/schedule_20260810.html",
    fetchedAt: "2026-08-10T10:00:00Z",
    matchDate: "2026-08-10",
    dailyMatchNo: 1,
    roundLabel: "2回戦",
    roundKey: "R2",
    teamANameRaw: "花巻東",
    teamBNameRaw: "智辯和歌山",
    teamAScore: 2,
    teamBScore: 5,
    ...overrides,
  };
}

test("normalizes unicode and whitespace but does not guess names", () => {
  assert.equal(api.normalizeSchoolName("  九州国際大付\n"), "九州国際大付");
  assert.equal(api.normalizeSchoolName("Ａ Ｂ"), "AB");
});

test("resolves exact names and saved aliases, including reversed team order", () => {
  const [preview] = api.buildImportPreview([row()], context);
  assert.equal(preview.status, "ready");
  assert.equal(preview.teamAId, "b");
  assert.equal(preview.teamBId, "a");
  assert.deepEqual(preview.canonicalPayload, {
    source: "jhbf",
    externalKey: row().externalKey,
    matchDate: "2026-08-10",
    dailyMatchNo: 1,
    roundKey: "R2",
    team1Id: "a",
    team2Id: "b",
    team1Score: 5,
    team2Score: 2,
    winnerTeamId: "a",
    loserTeamId: "b",
  });
});

test("unknown names require explicit alias mapping", () => {
  const [preview] = api.buildImportPreview([row({ teamANameRaw: "未知高校" })], context);
  assert.equal(preview.status, "unresolved_team");
  assert.deepEqual(preview.unresolvedNames, ["未知高校"]);
});

test("duplicate imports are not offered again and changed imports become conflicts", () => {
  const ready = api.buildImportPreview([row()], context)[0];
  const importedContext = { ...context, imports: [{ externalKey: row().externalKey, normalizedPayload: ready.canonicalPayload }] };
  assert.equal(api.buildImportPreview([row()], importedContext)[0].status, "imported");
  const changed = row({ teamAScore: 3 });
  assert.equal(api.buildImportPreview([changed], importedContext)[0].status, "conflict");
});

test("saved database result is detected and differing score is blocked", () => {
  const ready = api.buildImportPreview([row()], context)[0];
  const savedContext = {
    ...context,
    matches: [{ ...context.matches[0], status: "completed", team1Score: 5, team2Score: 2, winnerTeamId: "a" }],
  };
  assert.equal(api.buildImportPreview([row()], savedContext)[0].status, "already_saved");
  assert.equal(api.buildImportPreview([row({ teamAScore: 3 })], savedContext)[0].status, "conflict");
  assert.equal(api.sameCompletedMatch(savedContext.matches[0], ready.canonicalPayload), true);
});
