const assert = require("node:assert/strict");
const test = require("node:test");

const koshien = require("../js/koshien-results.js");

function validMatch(overrides = {}) {
  return {
    team_a_id: "Team A",
    team_b_id: "Team B",
    score_a: 3,
    score_b: 1,
    winner_id: "Team A",
    ...overrides,
  };
}

test("official phase-one points match the confirmed 2026 rules", () => {
  assert.deepEqual(koshien.OFFICIAL_PHASE1_POINTS, {
    initial_loss: 0,
    first_win_then_loss: 1,
    best16: 1.5,
    best8: 2,
    best4: 2.5,
    runner_up: 3.5,
    champion: 5,
  });
});

test("completed match validation rejects a tie", () => {
  assert.equal(koshien.validateMatchResult(validMatch({ score_a: 2, score_b: 2 })).ok, false);
});

test("completed match validation rejects negative and decimal scores", () => {
  assert.equal(koshien.validateMatchResult(validMatch({ score_a: -1 })).ok, false);
  assert.equal(koshien.validateMatchResult(validMatch({ score_b: 1.5 })).ok, false);
});

test("completed match validation rejects a missing score instead of treating it as zero", () => {
  assert.equal(koshien.validateMatchResult(validMatch({ score_a: "", score_b: 1, winner_id: "Team B" })).ok, false);
});

test("a round-one starter that wins once and loses in R2 finishes first_win_then_loss", () => {
  assert.equal(koshien.loserFinishForRound("R2", 1), "first_win_then_loss");
});

test("a round-two starter that loses its first game finishes initial_loss", () => {
  assert.equal(koshien.loserFinishForRound("R2", 2), "initial_loss");
});

test("later-round losses map to the official phase-one finish keys", () => {
  assert.equal(koshien.loserFinishForRound("R3", 1), "best16");
  assert.equal(koshien.loserFinishForRound("QF", 1), "best8");
  assert.equal(koshien.loserFinishForRound("SF", 1), "best4");
});

test("completed match payload includes loser_team_id and normalizes final to completed", () => {
  const rows = koshien.buildMatchRows({
    eventId: "event-id",
    matches: [{
      match_id: "R1-1",
      round: "R1",
      match_no: 1,
      team_a_id: "Team A",
      team_b_id: "Team B",
      score_a: 3,
      score_b: 1,
      winner_id: "Team A",
      loser_id: "Team B",
      status: "final",
    }],
    teams: [
      { id: "team-a-id", name: "Team A" },
      { id: "team-b-id", name: "Team B" },
    ],
  });

  assert.deepEqual(rows[0], {
    event_id: "event-id",
    round_key: "R1",
    match_no: 1,
    team1_id: "team-a-id",
    team2_id: "team-b-id",
    team1_score: 3,
    team2_score: 1,
    winner_team_id: "team-a-id",
    loser_team_id: "team-b-id",
    status: "completed",
    metadata: {
      match_id: "R1-1",
      team_a_name: "Team A",
      team_b_name: "Team B",
      winner_name: "Team A",
      loser_team_id: "team-b-id",
      loser_name: "Team B",
      app_status: "final",
    },
  });
});

test("phase-one scoring applies the 1.2 captain multiplier", () => {
  const result = koshien.calculatePhase1Breakdown({
    picks: ["Team A"],
    captain: "Team A",
    finishes: { "Team A": "first_win_then_loss" },
    teamMeta: { "Team A": { odds: 4, sqrtOdds: 2 } },
    stagePoints: { first_win_then_loss: 1 },
    captainMultiplier: 1.2,
    sqrtOddsCap: 50,
  });

  assert.equal(result.total, 2.4);
  assert.equal(result.rows[0].multiplier, 1.2);
});

test("phase-one scoring caps square-root odds at 50", () => {
  const result = koshien.calculatePhase1Breakdown({
    picks: ["Team A"],
    captain: "",
    finishes: { "Team A": "best16" },
    teamMeta: { "Team A": { odds: 10000, sqrtOdds: 100 } },
    stagePoints: { best16: 1.5 },
    captainMultiplier: 1.2,
    sqrtOddsCap: 50,
  });

  assert.equal(result.total, 75);
  assert.equal(result.rows[0].sqrtOdds, 50);
});

test("an unfinished team stays unfinished in the score breakdown", () => {
  const result = koshien.calculatePhase1Breakdown({
    picks: ["Team A"],
    finishes: {},
    teamMeta: { "Team A": { odds: 4, sqrtOdds: 2 } },
    stagePoints: koshien.OFFICIAL_PHASE1_POINTS,
  });

  assert.equal(result.total, 0);
  assert.equal(result.rows[0].finish, "");
});

test("scores payload maps participant names to player_id and keeps the breakdown", () => {
  const rows = koshien.buildScoreRows({
    eventId: "event-id",
    players: [{ id: "player-id", display_name: "Admin" }],
    scoreRows: [{
      name: "Admin",
      score: 12.5,
      detail: "P1 12.5",
      breakdown: { phase1: 12.5, phase2: 0, phase3: 0, revenge: 0, zombie: 0 },
    }],
  });

  assert.deepEqual(rows, [{
    event_id: "event-id",
    player_id: "player-id",
    phase1_score: 12.5,
    phase2_score: 0,
    phase3_score: 0,
    revenge_score: 0,
    zombie_score: 0,
    breakdown: {
      phase1: 12.5,
      phase2: 0,
      phase3: 0,
      revenge: 0,
      zombie: 0,
      total: 12.5,
      detail: "P1 12.5",
    },
  }]);
});

test("scores payload preserves an official player ID even when display names are duplicated", () => {
  const rows = koshien.buildScoreRows({
    eventId: "event-id",
    players: [
      { id: "player-1", display_name: "Same name" },
      { id: "player-2", display_name: "Same name" },
    ],
    scoreRows: [{
      playerId: "player-2",
      name: "Same name",
      score: 100,
      breakdown: { phase1: 0, phase2: 100, phase3: 0, revenge: 0, zombie: 0 },
    }],
  });

  assert.equal(rows[0].player_id, "player-2");
  assert.equal(rows[0].phase2_score, 100);
});

test("scores payload resolves duplicate display names by profile ID before a formal draft exists", () => {
  const rows = koshien.buildScoreRows({
    eventId: "event-1",
    players: [
      { id: "player-1", profile_id: "profile-1", display_name: "同名" },
      { id: "player-2", profile_id: "profile-2", display_name: "同名" },
    ],
    scoreRows: [{
      name: "同名",
      profileId: "profile-2",
      score: 20,
      breakdown: { phase1: 20, phase2: 0, phase3: 0, revenge: 0, zombie: 0 },
    }],
  });

  assert.equal(rows[0].player_id, "player-2");
});

test("competition ranking gives tied totals the same rank", () => {
  const rows = koshien.rankScoreRows([
    { name: "Third", score: 80 },
    { name: "First A", score: 100 },
    { name: "First B", score: 100 },
    { name: "Fourth", score: 40 },
  ]);

  assert.deepEqual(rows.map((row) => [row.name, row.rank]), [
    ["First A", 1],
    ["First B", 1],
    ["Third", 3],
    ["Fourth", 4],
  ]);
});

test("completing a valid match sets completed status and the opposite team as loser", () => {
  const completed = koshien.completeMatch(validMatch());
  assert.equal(completed.ok, true);
  assert.equal(completed.match.status, "completed");
  assert.equal(completed.match.winner_id, "Team A");
  assert.equal(completed.match.loser_id, "Team B");
});
