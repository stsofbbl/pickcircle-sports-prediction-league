const assert = require("assert");
const polish = require("../js/home-dashboard-polish.js");

assert.strictEqual(polish.stripSectionNumberText("1　今大会のあなた"), "今大会のあなた");
assert.strictEqual(polish.stripSectionNumberText("2 大会進捗"), "大会進捗");
assert.strictEqual(polish.stripSectionNumberText("3　バーチャル高校野球 ↗"), "バーチャル高校野球 ↗");
assert.strictEqual(polish.stripSectionNumberText("試合結果・組み合わせ"), "試合結果・組み合わせ");

const phase2View = {
  available: true,
  status: "locked",
  eventId: "koshien-2026",
  players: [
    { playerId: "p1", displayName: "ぎん" },
    { playerId: "p2", displayName: "いの" },
    { playerId: "p3", displayName: "den" },
    { playerId: "p4", displayName: "50銭" },
  ],
  eligibleTeams: [
    { teamId: "t1", name: "横浜" },
    { teamId: "t2", name: "智辯和歌山" },
    { teamId: "t3", name: "履正社" },
    { teamId: "t4", name: "花巻東" },
    { teamId: "t5", name: "三重" },
    { teamId: "t6", name: "健大高崎" },
    { teamId: "t7", name: "英明" },
    { teamId: "t8", name: "天理" },
    { teamId: "t9", name: "佐野日大" },
    { teamId: "t10", name: "仙台育英" },
    { teamId: "t11", name: "有明" },
    { teamId: "t12", name: "拓大紅陵" },
    { teamId: "t13", name: "敦賀気比" },
    { teamId: "t14", name: "東日大昌平" },
    { teamId: "t15", name: "高川学園" },
    { teamId: "t16", name: "霞ケ浦" },
  ],
  picks: [
    ["p1", "t1"], ["p2", "t2"], ["p3", "t3"], ["p4", "t4"],
    ["p4", "t5"], ["p3", "t6"], ["p2", "t7"], ["p1", "t8"],
    ["p1", "t9"], ["p2", "t10"], ["p3", "t11"], ["p4", "t12"],
    ["p4", "t13"], ["p3", "t14"], ["p2", "t15"], ["p1", "t16"],
  ].map(([playerId, teamId], index) => ({ playerId, teamId, pickNo: index + 1, draftRound: Math.floor(index / 4) + 1 })),
};

assert.deepStrictEqual(polish.phase2ParticipantTeams(phase2View, "50銭"), ["花巻東", "三重", "拓大紅陵", "敦賀気比"]);

const phase2Event = {
  id: "koshien-2026",
  name: "夏の甲子園2026 YOSO",
  results: {
    matches: [
      { round: "R3", match_no: 2, team_a_id: "敦賀気比", team_b_id: "智辯和歌山", status: "scheduled", starts_at: "2026-08-15T01:30:00Z" },
      { round: "R3", match_no: 3, team_a_id: "履正社", team_b_id: "三重", status: "scheduled", starts_at: "2026-08-15T04:00:00Z" },
      { round: "R3", match_no: 4, team_a_id: "拓大紅陵", team_b_id: "仙台育英", status: "scheduled", starts_at: "2026-08-15T06:30:00Z" },
      { round: "R3", match_no: 7, team_a_id: "英明", team_b_id: "花巻東", status: "scheduled", starts_at: "2026-08-16T04:00:00Z" },
    ],
  },
};

const phase2Today = polish.phase2TodayCandidate({
  view: phase2View,
  participantName: "50銭",
  event: phase2Event,
  now: Date.parse("2026-08-15T05:09:00+09:00"),
});
assert.strictEqual(phase2Today.team, "敦賀気比");
assert.strictEqual(phase2Today.match.match_no, 2);
assert.match(polish.phase2TodayCardMarkup(phase2Today, phase2Event.name, Date.parse("2026-08-15T05:09:00+09:00")), /本日 10:30/);
assert.match(polish.phase2TodayCardMarkup(phase2Today, phase2Event.name, Date.parse("2026-08-15T05:09:00+09:00")), /フェーズ2暫定 <b>20pt<\/b>/);

(async () => {
  let calls = 0;
  const root = {
    document: { hidden: false },
    location: { hash: "#home" },
    loadKoshienOnlineState: async (options) => {
      calls += 1;
      assert.deepStrictEqual(options, { force: true });
    },
  };
  assert.strictEqual(await polish.refreshOnlineHome(root, { force: true }), true);
  assert.strictEqual(calls, 1);

  assert.strictEqual(await polish.refreshOnlineHome({
    document: { hidden: true },
    location: { hash: "#home" },
    loadKoshienOnlineState: async () => { throw new Error("must not run"); },
  }, { force: true }), false);

  assert.strictEqual(await polish.refreshOnlineHome({
    document: { hidden: false },
    location: { hash: "#ranking" },
    loadKoshienOnlineState: async () => { throw new Error("must not run"); },
  }, { force: true }), false);

  console.log("home dashboard polish tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});