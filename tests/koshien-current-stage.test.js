const test = require("node:test");
const assert = require("node:assert/strict");

const currentStage = require("../js/koshien-current-stage.js");

function completed(round, winner, loser) {
  return {
    round,
    status: "completed",
    team_a_id: winner,
    team_b_id: loser,
    winner_id: winner,
    loser_id: loser,
  };
}

test("phase 1 current stages advance only after completed wins", () => {
  const team = "A";
  assert.equal(currentStage.currentStageForTeam({ team, matches: [] }), "");
  assert.equal(currentStage.currentStageForTeam({ team, matches: [completed("R1", team, "B")] }), "first_win_then_loss");
  assert.equal(currentStage.currentStageForTeam({ team, matches: [completed("R2", team, "B")] }), "best16");
  assert.equal(currentStage.currentStageForTeam({ team, matches: [completed("R3", team, "B")] }), "best8");
  assert.equal(currentStage.currentStageForTeam({ team, matches: [completed("QF", team, "B")] }), "best4");
});

test("a finalist stays at best4 until the final result is completed", () => {
  const team = "A";
  assert.equal(currentStage.currentStageForTeam({ team, matches: [completed("SF", team, "B")] }), "best4");
  assert.equal(currentStage.currentStageForTeam({ team, matches: [completed("F", "B", team)] }), "runner_up");
  assert.equal(currentStage.currentStageForTeam({ team, matches: [completed("F", team, "B")] }), "champion");
});

test("second-round starters receive no point before a win and zero for first-match loss", () => {
  const team = "A";
  assert.equal(currentStage.currentStageForTeam({ team, matches: [], startRound: 2 }), "");
  assert.equal(currentStage.currentStageForTeam({ team, matches: [completed("R2", "B", team)], startRound: 2 }), "initial_loss");
  assert.equal(currentStage.currentStageForTeam({ team, matches: [completed("R2", team, "B")], startRound: 2 }), "best16");
});

test("deriveCurrentStages keeps current winners and final losers together", () => {
  const stages = currentStage.deriveCurrentStages({
    teams: ["A", "B", "C", "D"],
    teamMeta: { D: { startRound: 2 } },
    matches: [
      completed("R1", "A", "B"),
      completed("QF", "C", "A"),
      completed("R2", "C", "D"),
    ],
  });
  assert.deepEqual(stages, {
    A: "best8",
    B: "initial_loss",
    C: "best4",
    D: "initial_loss",
  });
});
