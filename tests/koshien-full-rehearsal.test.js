const assert = require("node:assert/strict");
const test = require("node:test");

const draft = require("../js/koshien-phase2-draft.js");
const later = require("../js/koshien-later-phases.js");
const results = require("../js/koshien-results.js");

test("four players can rehearse phase 1 through revenge phase 2 zombie phase 3 and final ranking", () => {
  const players = ["p1", "p2", "p3", "p4"];
  const ranked = draft.resolvePhase1Ranking([
    { player_id: "p1", score: 10 },
    { player_id: "p2", score: 8 },
    { player_id: "p3", score: 8 },
    { player_id: "p4", score: 3 },
  ], { drawOrders: { 8: ["p3", "p2"] } });
  assert.deepEqual(ranked, ["p1", "p3", "p2", "p4"]);

  const formalPicks = Array.from({ length: 16 }, (_, index) => {
    const assignment = draft.pickAssignment(index + 1, ranked);
    return { playerId: assignment.playerId, teamId: `t${index + 1}`, pickNo: index + 1 };
  });
  assert.equal(new Set(formalPicks.map((pick) => pick.teamId)).size, 16);
  assert.deepEqual(Object.fromEntries(players.map((playerId) => [
    playerId,
    formalPicks.filter((pick) => pick.playerId === playerId).length,
  ])), { p1: 4, p2: 4, p3: 4, p4: 4 });

  const finishesByTeamId = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [`t${index + 1}`, "best16"]));
  Object.assign(finishesByTeamId, {
    t1: "champion", t4: "runner_up", t5: "best4", t13: "best4",
    t2: "best8", t3: "best8", t6: "best8", t7: "best8",
  });
  const phase2 = draft.calculateFormalPhase2Scores({
    players: players.map((playerId) => ({ playerId })), formalPicks, picks: formalPicks, finishesByTeamId,
  });
  assert.equal(Object.keys(phase2.byPlayerId).length, 4);

  const revenge = later.deriveRevengeEligibility({
    phase1TeamIds: Array.from({ length: 8 }, (_, index) => `old${index + 1}`),
    best16TeamIds: Array.from({ length: 16 }, (_, index) => `t${index + 1}`),
    directEliminatorByTeamId: { old1: "t1" },
  });
  assert.deepEqual(revenge, { eligible: true, allowedTeamIds: ["t1"], fallbackAllowed: false });
  assert.equal(later.calculateRevengeScore({ finishKey: "champion", sqrtOdds: 2 }), 7);

  const best4TeamIds = ["t1", "t4", "t5", "t13"];
  const zombieCandidates = players.map((playerId) => ({
    playerId,
    ...later.deriveZombieEligibility({ playerId, formalPicks, best4TeamIds }),
  }));
  const eligibleZombie = zombieCandidates.find((row) => row.eligible);
  assert.ok(eligibleZombie);
  const targetTeam = eligibleZombie.allowedTeamIds.find((teamId) => finishesByTeamId[teamId] === "best4");
  assert.ok(targetTeam);
  const zombie = later.calculateZombieAdjustments({
    formalPicks,
    predictions: [{ playerId: eligibleZombie.playerId, teamId: targetTeam }],
    finishByTeamId: finishesByTeamId,
  });
  assert.equal(zombie.byTeamId[targetTeam].adjustment, -20);

  const phase3 = later.calculatePhase3Scores({
    predictions: [
      { playerId: "p1", scoreA: 5, scoreB: 3 },
      { playerId: "p2", scoreA: 4, scoreB: 2 },
      { playerId: "p3", scoreA: 2, scoreB: 3 },
      { playerId: "p4", scoreA: 6, scoreB: 1 },
    ],
    actual: { scoreA: 5, scoreB: 3 },
  });
  assert.deepEqual(phase3, { p1: 50 });

  const phase1Scores = { p1: 10, p2: 8, p3: 8, p4: 3 };
  const finalRows = results.rankScoreRows(players.map((playerId) => ({
    playerId,
    score: phase1Scores[playerId]
      + phase2.byPlayerId[playerId]
      + (playerId === "p4" ? 7 : 0)
      + (zombie.byPlayerId[playerId] || 0)
      + (phase3[playerId] || 0),
  })));
  assert.equal(finalRows.length, 4);
  assert.equal(finalRows[0].rank, 1);
  assert.ok(finalRows.every((row, index) => index === 0 || row.rank >= finalRows[index - 1].rank));
});
