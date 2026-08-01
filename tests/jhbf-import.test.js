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

test("representative key uses the same non-NFKC normalization as the database", () => {
  assert.equal(api.representativeKeyFor(" 北 北海道 ", "Ａ Ｂ高校"), "北北海道:ａｂ高校");
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

test("representative preview requires all 49 districts before apply", () => {
  const partial = api.buildRepresentativePreview([
    { districtName: "北北海道", schoolName: "白樺学園" },
    { districtName: "南北海道", schoolName: "札幌日大" },
  ], ["北北海道代表", "南北海道代表"], {});
  assert.equal(partial.valid, false);
  assert.equal(partial.completeCount, 2);
  assert.ok(partial.missingDistricts.includes("青森"));

  const districts = [
    "北北海道", "南北海道", "青森", "岩手", "宮城", "秋田", "山形",
    "福島", "茨城", "栃木", "群馬", "埼玉", "千葉", "東東京",
    "西東京", "神奈川", "山梨", "新潟", "長野", "富山", "石川",
    "福井", "静岡", "愛知", "岐阜", "三重", "滋賀", "京都",
    "大阪", "兵庫", "奈良", "和歌山", "鳥取", "島根", "岡山",
    "広島", "山口", "香川", "徳島", "愛媛", "高知", "福岡",
    "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
  ];
  const complete = api.buildRepresentativePreview(
    districts.map((district, index) => ({ districtName: district, schoolName: `School ${index + 1}` })),
    districts.map((district) => `${district}代表`),
    {},
  );
  assert.equal(complete.valid, true);
  assert.equal(complete.completeCount, 49);
});

test("representative preview deduplicates identical stable keys but reports conflicting district rows", () => {
  const districts = [
    "北北海道", "南北海道", "青森", "岩手", "宮城", "秋田", "山形",
    "福島", "茨城", "栃木", "群馬", "埼玉", "千葉", "東東京",
    "西東京", "神奈川", "山梨", "新潟", "長野", "富山", "石川",
    "福井", "静岡", "愛知", "岐阜", "三重", "滋賀", "京都",
    "大阪", "兵庫", "奈良", "和歌山", "鳥取", "島根", "岡山",
    "広島", "山口", "香川", "徳島", "愛媛", "高知", "福岡",
    "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
  ];
  const source = districts.map((district, index) => ({ districtName: district, schoolName: `School ${index + 1}` }));
  const duplicate = api.buildRepresentativePreview([...source, { ...source[0] }], [], {});
  assert.equal(duplicate.valid, false);
  assert.equal(duplicate.rows.length, 49);
  assert.deepEqual(duplicate.duplicateDistricts, []);
  assert.deepEqual(duplicate.duplicateStableRows, ["北北海道:School 1"]);

  const conflict = api.buildRepresentativePreview([...source, { districtName: "北北海道", schoolName: "別の高校" }], [], {});
  assert.equal(conflict.valid, false);
  assert.deepEqual(conflict.duplicateDistricts, ["北北海道"]);
});

function startRoundInputs() {
  const teams = Array.from({ length: 49 }, (_, index) => `School ${index + 1}`);
  const teamMeta = Object.fromEntries(teams.map((team, index) => [team, {
    representativeKey: `district-${index + 1}:school-${index + 1}`,
  }]));
  const sourceRows = teams.slice(0, 34).map((team, index) => ({
    districtName: `district-${index + 1}`,
    schoolName: `school-${index + 1}`,
  }));
  return { teams, teamMeta, sourceRows };
}

test("start-round preview resolves representative keys first and derives the remaining 15 schools", () => {
  const { teams, teamMeta, sourceRows } = startRoundInputs();
  const preview = api.buildStartRoundPreview(sourceRows, teams, teamMeta);

  assert.equal(preview.valid, true);
  assert.equal(preview.firstRoundTeams.length, 34);
  assert.equal(preview.secondRoundTeams.length, 15);
  assert.deepEqual(preview.unmatchedRows, []);
  assert.deepEqual(preview.duplicateTeams, []);
  assert.deepEqual(preview.rows.map((row) => row.startRound), [
    ...Array(34).fill(1),
    ...Array(15).fill(2),
  ]);
});

test("start-round preview blocks incomplete, unmatched, duplicate, and 34/15-invalid candidates", () => {
  const { teams, teamMeta, sourceRows } = startRoundInputs();
  assert.equal(api.buildStartRoundPreview(sourceRows, teams.slice(0, 48), teamMeta).valid, false);
  assert.equal(api.buildStartRoundPreview(
    [{ districtName: "unknown", schoolName: "unknown" }, ...sourceRows.slice(1)],
    teams,
    teamMeta,
  ).valid, false);
  assert.equal(api.buildStartRoundPreview([...sourceRows.slice(0, 33), sourceRows[0]], teams, teamMeta).valid, false);
  assert.equal(api.buildStartRoundPreview(sourceRows.slice(0, 33), teams, teamMeta).valid, false);
  assert.equal(api.buildStartRoundPreview(sourceRows, teams, teamMeta, {}, ["tournament_table_changed"]).valid, false);
});

test("start-round preview uses exact school names and saved aliases only as safe fallbacks", () => {
  const { teams, teamMeta, sourceRows } = startRoundInputs();
  delete teamMeta[teams[0]].representativeKey;
  teamMeta[teams[0]].representativeKey = "district-1:school-1";
  sourceRows[0] = { districtName: "different", schoolName: teams[0] };
  assert.equal(api.buildStartRoundPreview(sourceRows, teams, teamMeta).firstRoundTeams[0], teams[0]);

  sourceRows[0] = { districtName: "different", schoolName: "Saved Alias" };
  const context = {
    teams: [{ teamId: "team-1", name: teams[0] }],
    aliases: [{ normalizedExternalName: "SavedAlias", teamId: "team-1" }],
  };
  assert.equal(api.buildStartRoundPreview(sourceRows, teams, teamMeta, context).firstRoundTeams[0], teams[0]);
});

test("start-round confirmation follows the RPC deadline condition", () => {
  const now = Date.parse("2026-08-02T00:00:00Z");
  assert.equal(api.canConfirmStartRounds({ status: "open", deadline: "2026-08-04T14:59:00Z" }, now), true);
  assert.equal(api.canConfirmStartRounds({ status: "open", deadline: "2026-08-01T14:59:00Z" }, now), false);
  assert.equal(api.canConfirmStartRounds({ status: "finalized", deadline: "2026-08-04T14:59:00Z" }, now), false);
});

test("official start-round confirmation reloads online state after the existing RPC succeeds", async () => {
  const calls = [];
  let confirmed = false;
  const saved = await api.confirmStartRoundsOnline({
    eventId: "event-id",
    rows: Array.from({ length: 49 }, (_, index) => ({
      representativeKey: `district-${index + 1}:school-${index + 1}`,
      startRound: index < 34 ? 1 : 2,
    })),
    async updateStartRounds(args) {
      calls.push(["update", args.eventId, args.rows.length]);
      return { count: 49, startRoundsConfirmed: true, invalidPredictionCount: 2 };
    },
    async reloadOnline() {
      calls.push(["reload"]);
      confirmed = true;
      return { ok: true };
    },
    isConfirmed: () => confirmed,
  });

  assert.deepEqual(calls, [["update", "event-id", 49], ["reload"]]);
  assert.equal(saved.invalidPredictionCount, 2);
});
