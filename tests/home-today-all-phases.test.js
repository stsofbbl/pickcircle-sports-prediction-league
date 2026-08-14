const assert = require("assert");
const today = require("../js/home-today-all-phases.js");

const phase2View = {
  available: true,
  status: "locked",
  eventId: "koshien-2026",
  players: [
    { playerId: "p1", displayName: "50銭" },
  ],
  eligibleTeams: [
    { teamId: "t1", name: "花巻東" },
    { teamId: "t2", name: "三重" },
    { teamId: "t3", name: "拓大紅陵" },
    { teamId: "t4", name: "敦賀気比" },
  ],
  picks: [
    { playerId: "p1", teamId: "t1", pickNo: 1 },
    { playerId: "p1", teamId: "t2", pickNo: 2 },
    { playerId: "p1", teamId: "t3", pickNo: 3 },
    { playerId: "p1", teamId: "t4", pickNo: 4 },
    ...Array.from({ length: 12 }, (_, index) => ({
      playerId: `other-${index}`,
      teamId: `other-team-${index}`,
      pickNo: index + 5,
    })),
  ],
};

const event = {
  id: "koshien-2026",
  name: "夏の甲子園2026 YOSO",
  predictions: {
    "50銭": {
      teams: ["白樺学園", "霞ケ浦", "長崎日大", "中京", "東日大昌平", "三重", "松商学園", "天理"],
    },
  },
  results: {
    matches: [
      { round: "R3", match_no: 1, team_a_id: "高川学園", team_b_id: "天理", status: "completed", starts_at: "2026-08-14T23:00:00Z" },
      { round: "R3", match_no: 2, team_a_id: "敦賀気比", team_b_id: "智辯和歌山", status: "scheduled", starts_at: "2026-08-15T01:30:00Z" },
      { round: "R3", match_no: 3, team_a_id: "履正社", team_b_id: "三重", status: "scheduled", starts_at: "2026-08-15T04:00:00Z" },
      { round: "R3", match_no: 4, team_a_id: "拓大紅陵", team_b_id: "仙台育英", status: "scheduled", starts_at: "2026-08-15T06:30:00Z" },
      { round: "R3", match_no: 7, team_a_id: "英明", team_b_id: "花巻東", status: "scheduled", starts_at: "2026-08-16T04:00:00Z" },
    ],
  },
};

const now = Date.parse("2026-08-15T06:25:00+09:00");

assert.deepStrictEqual(today.phase1ParticipantTeams(event, "50銭"), [
  "白樺学園", "霞ケ浦", "長崎日大", "中京", "東日大昌平", "三重", "松商学園", "天理",
]);
assert.deepStrictEqual(today.phase2ParticipantTeams(phase2View, "50銭"), ["花巻東", "三重", "拓大紅陵", "敦賀気比"]);

const phase1Rows = today.todayCandidatesForTeams(today.phase1ParticipantTeams(event, "50銭"), event, now);
assert.deepStrictEqual(phase1Rows.map((row) => row.team), ["天理", "三重"]);
assert.strictEqual(phase1Rows[0].completed, true, "completed games stay visible for the whole day");

const phase2Rows = today.todayCandidatesForTeams(today.phase2ParticipantTeams(phase2View, "50銭"), event, now);
assert.deepStrictEqual(phase2Rows.map((row) => row.team), ["敦賀気比", "三重", "拓大紅陵"]);
assert.deepStrictEqual(phase2Rows.map((row) => row.startsAt), [
  "2026-08-15T01:30:00Z",
  "2026-08-15T04:00:00Z",
  "2026-08-15T06:30:00Z",
]);

const markup = today.todaysYosoMarkup({ eventName: event.name, phase1Rows, phase2Rows });
assert.match(markup, /本日のYOSO/);
assert.doesNotMatch(markup, /今日のYOSO/);
assert.match(markup, /フェーズ1/);
assert.match(markup, /フェーズ2/);
assert.match(markup, /08:00/);
assert.match(markup, /10:30/);
assert.match(markup, /13:00/);
assert.match(markup, /15:30/);
assert.match(markup, /天理/);
assert.match(markup, /敦賀気比/);
assert.match(markup, /三重/);
assert.match(markup, /拓大紅陵/);

const guard = today.guardSignature(phase2View, "50銭", event, now);
assert.match(guard, /敦賀気比\|R3\|2\|2026-08-15T01:30:00Z$/);

console.log("home today all phases tests passed");
