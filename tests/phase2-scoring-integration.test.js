const assert = require("node:assert/strict");
const test = require("node:test");

const draft = require("../js/koshien-phase2-draft.js");
const results = require("../js/koshien-results.js");

test("formal draft IDs flow through official finishes, persisted scores, and competition ranks", () => {
  const playerIds = ["player-1", "player-2", "player-3", "player-4"];
  const teamIds = Array.from({ length: 16 }, (_, index) => `team-${index + 1}`);
  const response = {
    draft: {
      id: "draft-1",
      event_id: "event-1",
      status: "completed",
      ordered_player_ids: [...playerIds].reverse(),
      eligible_team_ids: teamIds,
      current_pick_no: 16,
      version: 1,
    },
    viewer_player_id: "player-1",
    players: playerIds.map((playerId, index) => ({
      player_id: playerId,
      profile_id: `profile-${index + 1}`,
      display_name: index < 2 ? "同名" : `参加者${index + 1}`,
    })),
    teams: teamIds.map((teamId, index) => ({
      team_id: teamId,
      name: `高校${index + 1}`,
      finish_key: index === 0 ? "champion" : index === 1 ? "runner_up" : index < 4 ? "best4" : "best16",
    })),
    picks: draft.createSnakeOrder(playerIds).map((playerId, index) => ({
      id: `pick-${index + 1}`,
      draft_id: "draft-1",
      event_id: "event-1",
      player_id: playerId,
      team_id: teamIds[index],
      pick_no: index + 1,
      draft_round: Math.floor(index / 4) + 1,
    })),
  };
  const view = draft.buildDraftViewState(response);
  const predictions = Object.fromEntries(view.players.map((player, index) => [
    `participant-${index + 1}`,
    { profileId: player.profileId },
  ]));
  const participants = draft.resolveFormalPhase2Participants({ players: view.players, predictions });
  const projection = draft.calculateFormalPhase2Scores({
    players: view.players,
    picks: view.picks,
    finishesByTeamId: Object.fromEntries(view.eligibleTeams.map((team) => [team.teamId, team.finish])),
  });
  const ranked = results.rankScoreRows(participants.map((participant) => ({
    name: participant.displayName,
    playerId: participant.playerId,
    score: projection.byPlayerId[participant.playerId],
    breakdown: { phase1: 0, revenge: 0, phase2: projection.byPlayerId[participant.playerId], zombie: 0, phase3: 0 },
  })));
  const persisted = results.buildScoreRows({
    eventId: "event-1",
    players: view.players.map((player) => ({ id: player.playerId, display_name: player.displayName })),
    scoreRows: ranked,
  });

  assert.equal(persisted.length, 4);
  assert.deepEqual(persisted.map((row) => row.player_id).sort(), [...playerIds].sort());
  assert.deepEqual(persisted.map((row) => row.phase2_score).sort((a, b) => b - a), [100, 60, 40, 40]);
  assert.deepEqual(ranked.filter((row) => row.score === 40).map((row) => row.rank), [3, 3]);
});
