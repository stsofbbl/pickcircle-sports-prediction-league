const assert = require("assert");
const homeDashboard = require("../js/home-dashboard.js");

{
  const matches = [];
  for (let matchNo = 1; matchNo <= 17; matchNo += 1) {
    matches.push({ round: "R1", match_no: matchNo, status: matchNo <= 6 ? "completed" : "scheduled" });
  }
  for (let matchNo = 1; matchNo <= 16; matchNo += 1) {
    matches.push({ round: "R2", match_no: matchNo, status: "scheduled" });
  }
  const summary = homeDashboard.tournamentProgress(matches);
  assert.deepStrictEqual(summary.visible.map(({ round, completed, total }) => ({ round, completed, total })), [
    { round: "R1", completed: 6, total: 17 },
    { round: "R2", completed: 0, total: 16 },
  ]);
  assert.deepStrictEqual(summary.milestone, { through: "R2", label: "ベスト16確定", remaining: 27 });
}

{
  const event = {
    predictions: {
      den: { teams: ["白樺学園", "東日大昌平"] },
      いの: { teams: ["東日大昌平"] },
      ぎん: { teams: ["長崎日大"] },
    },
  };
  assert.deepStrictEqual(homeDashboard.phase1PickersForTeam({
    event,
    team: "東日大昌平",
    participantNames: ["den", "いの", "ぎん"],
    predictionsPublic: true,
  }), ["den", "いの"]);
  assert.deepStrictEqual(homeDashboard.phase1PickersForTeam({
    event,
    team: "東日大昌平",
    participantNames: ["den", "いの", "ぎん"],
    predictionsPublic: false,
  }), []);
}

{
  const matches = [
    { round: "R1", match_no: 1, status: "completed", team_a_id: "札幌日大", team_b_id: "仙台育英", winner_id: "仙台育英", loser_id: "札幌日大" },
    { round: "R2", match_no: 8, status: "scheduled", team_a_id: "花咲徳栄", team_b_id: "仙台育英" },
  ];
  assert.deepStrictEqual(homeDashboard.teamStatus({ matches, team: "札幌日大" }).text, "敗退");
  assert.deepStrictEqual(homeDashboard.teamStatus({ matches, team: "仙台育英" }).text, "次戦 R2-8");
}

assert.strictEqual(homeDashboard.formatMultiplier({ gameMultiplier: 13.64 }), "13.64");
assert.strictEqual(homeDashboard.formatMultiplier({ sqrtOdds: 8.7 }), "8.7");

console.log("home dashboard tests passed");
