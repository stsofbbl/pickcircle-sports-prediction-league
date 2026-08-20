const assert = require("node:assert/strict");
const test = require("node:test");

const later = require("../js/koshien-later-phases.js");

test("revenge subtracts the already-earned best 16 arrival point", () => {
  assert.equal(later.calculateRevengeScore({ finishKey: "best16", sqrtOdds: 2 }), 0);
  assert.equal(later.calculateRevengeScore({ finishKey: "best8", sqrtOdds: 2 }), 1);
  assert.equal(later.calculateRevengeScore({ finishKey: "champion", sqrtOdds: 2 }), 7);
});

test("revenge allows direct surviving eliminators and falls back only when none survive", () => {
  const picks = Array.from({ length: 8 }, (_, index) => `lost-${index + 1}`);
  const direct = later.deriveRevengeEligibility({
    phase1TeamIds: picks,
    best16TeamIds: ["survivor-a", "survivor-b"],
    directEliminatorByTeamId: { "lost-1": "survivor-a", "lost-2": "eliminated" },
  });
  assert.deepEqual(direct, { eligible: true, allowedTeamIds: ["survivor-a"], fallbackAllowed: false });

  const fallback = later.deriveRevengeEligibility({
    phase1TeamIds: picks,
    best16TeamIds: ["survivor-a", "survivor-b"],
    directEliminatorByTeamId: { "lost-1": "eliminated" },
  });
  assert.deepEqual(fallback, { eligible: true, allowedTeamIds: ["survivor-a", "survivor-b"], fallbackAllowed: true });
});

test("revenge is unavailable when one phase 1 school reaches best 16", () => {
  const result = later.deriveRevengeEligibility({
    phase1TeamIds: ["alive", "b", "c", "d", "e", "f", "g", "h"],
    best16TeamIds: ["alive"],
  });
  assert.equal(result.eligible, false);
});

test("zombie is confirmed early once all four formal phase 2 schools are eliminated", () => {
  const formalPicks = [
    ...["a", "b", "c", "d"].map((teamId) => ({ playerId: "zombie", teamId })),
    { playerId: "other", teamId: "alive" },
  ];
  assert.deepEqual(later.deriveZombiePreEligibility({
    playerId: "zombie",
    formalPicks,
    eliminatedTeamIds: ["a", "b", "c", "d"],
  }), {
    confirmed: true,
    ownTeamIds: ["a", "b", "c", "d"],
    remainingTeamIds: [],
  });
});

test("zombie is not confirmed early while one formal phase 2 school remains alive", () => {
  const formalPicks = ["a", "b", "c", "d"].map((teamId) => ({ playerId: "zombie", teamId }));
  const result = later.deriveZombiePreEligibility({
    playerId: "zombie",
    formalPicks,
    eliminatedTeamIds: ["a", "b", "c"],
  });
  assert.equal(result.confirmed, false);
  assert.deepEqual(result.remainingTeamIds, ["d"]);
});

test("zombie eligibility uses four formal picks and only other owners best 4 schools", () => {
  const formalPicks = [
    ...["a", "b", "c", "d"].map((teamId) => ({ playerId: "zombie", teamId })),
    { playerId: "owner-1", teamId: "semi-1" },
    { playerId: "owner-2", teamId: "semi-2" },
  ];
  assert.deepEqual(later.deriveZombieEligibility({
    playerId: "zombie",
    formalPicks,
    best4TeamIds: ["semi-1", "semi-2"],
  }), { eligible: true, allowedTeamIds: ["semi-1", "semi-2"] });
});

test("one zombie hit halves 40 and two hits erase 40 from the formal owner", () => {
  const formalPicks = [
    { playerId: "owner-1", teamId: "semi-1" },
    { playerId: "owner-2", teamId: "semi-2" },
  ];
  const result = later.calculateZombieAdjustments({
    formalPicks,
    predictions: [
      { playerId: "zombie-1", teamId: "semi-1" },
      { playerId: "zombie-2", teamId: "semi-2" },
      { playerId: "zombie-3", teamId: "semi-2" },
    ],
    finishByTeamId: { "semi-1": "best4", "semi-2": "best4" },
  });
  assert.deepEqual(result.byPlayerId, { "owner-1": -20, "owner-2": -40 });
});

test("zombie target reaching the final causes no adjustment and zombie earns no points", () => {
  const result = later.calculateZombieAdjustments({
    formalPicks: [{ playerId: "owner", teamId: "finalist" }],
    predictions: [{ playerId: "zombie", teamId: "finalist" }],
    finishByTeamId: { finalist: "runner_up" },
  });
  assert.deepEqual(result, { byPlayerId: {}, byTeamId: {} });
});

test("phase 3 awards every exact prediction 50 and suppresses nearest points", () => {
  const scores = later.calculatePhase3Scores({
    actual: { scoreA: 5, scoreB: 3 },
    predictions: [
      { playerId: "a", scoreA: 5, scoreB: 3 },
      { playerId: "b", scoreA: 5, scoreB: 3 },
      { playerId: "c", scoreA: 4, scoreB: 3 },
    ],
  });
  assert.deepEqual(scores, { a: 50, b: 50 });
});

test("phase 3 awards all fully tied nearest predictions 30", () => {
  const scores = later.calculatePhase3Scores({
    actual: { scoreA: 5, scoreB: 3 },
    predictions: [
      { playerId: "a", scoreA: 4, scoreB: 3 },
      { playerId: "b", scoreA: 5, scoreB: 2 },
      { playerId: "c", scoreA: 3, scoreB: 5 },
    ],
  });
  assert.deepEqual(scores, { a: 30, b: 30 });
});

test("phase 3 uses only the normal prediction when the final has no tiebreak", () => {
  const scores = later.calculatePhase3Scores({
    actual: { scoreA: 5, scoreB: 3, usedTiebreak: false },
    predictions: [
      { playerId: "normal", scoreA: 5, scoreB: 3, tiebreakScoreA: 8, tiebreakScoreB: 7 },
      { playerId: "tiebreak", scoreA: 4, scoreB: 3, tiebreakScoreA: 5, tiebreakScoreB: 3 },
    ],
  });
  assert.deepEqual(scores, { normal: 50 });
});

test("phase 3 uses only the tiebreak prediction when the final uses tiebreak", () => {
  const scores = later.calculatePhase3Scores({
    actual: { scoreA: 7, scoreB: 6, usedTiebreak: true },
    predictions: [
      { playerId: "normal", scoreA: 7, scoreB: 6, tiebreakScoreA: 8, tiebreakScoreB: 6 },
      { playerId: "tiebreak", scoreA: 5, scoreB: 3, tiebreakScoreA: 7, tiebreakScoreB: 6 },
    ],
  });
  assert.deepEqual(scores, { tiebreak: 50 });
});

test("phase 3 rejects negative decimal and tied predictions", () => {
  assert.equal(later.validateFinalScore(-1, 0).ok, false);
  assert.equal(later.validateFinalScore(1.5, 0).ok, false);
  assert.equal(later.validateFinalScore(2, 2).ok, false);
  assert.equal(later.validateFinalScore(2, 1).ok, true);
});
