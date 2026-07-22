const assert = require("node:assert/strict");
const test = require("node:test");

const draft = require("../js/koshien-phase2-draft.js");

const ranked = ["player-1", "player-2", "player-3", "player-4"];
const lowerFirst = [...ranked].reverse();

function activeDraft(overrides = {}) {
  return {
    id: "draft-1",
    event_id: "event-1",
    status: "drafting",
    ordered_player_ids: lowerFirst,
    eligible_team_ids: Array.from({ length: 16 }, (_, index) => `team-${index + 1}`),
    current_pick_no: 1,
    starts_at: "2026-08-15T00:00:00.000Z",
    deadline_at: "2026-08-16T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function completedPicks(count = 16) {
  const order = draft.createSnakeOrder(ranked);
  return order.slice(0, count).map((playerId, index) => ({
    id: `pick-${index + 1}`,
    draft_id: "draft-1",
    event_id: "event-1",
    player_id: playerId,
    team_id: `team-${index + 1}`,
    pick_no: index + 1,
    draft_round: Math.floor(index / 4) + 1,
  }));
}

function dbState(overrides = {}) {
  const draftRow = activeDraft({ current_pick_no: 3 });
  return {
    draft: draftRow,
    viewer_player_id: "player-2",
    players: ranked.map((playerId, index) => ({ player_id: playerId, profile_id: `profile-${index + 1}`, display_name: `Player ${index + 1}` })),
    teams: draftRow.eligible_team_ids.map((teamId, index) => ({ team_id: teamId, name: `School ${index + 1}`, finish_key: index === 0 ? "champion" : "best16" })),
    picks: completedPicks(2),
    ...overrides,
  };
}

test("4 players and 4 rounds produce the official 16-pick snake order", () => {
  const order = draft.createSnakeOrder(ranked);
  assert.deepEqual(order.slice(0, 4), ["player-4", "player-3", "player-2", "player-1"]);
  assert.deepEqual(order.slice(4, 8), ["player-1", "player-2", "player-3", "player-4"]);
  assert.deepEqual(order.slice(8, 12), ["player-4", "player-3", "player-2", "player-1"]);
  assert.deepEqual(order.slice(12, 16), ["player-1", "player-2", "player-3", "player-4"]);
  assert.equal(order.length, 16);
  ranked.forEach((playerId) => assert.equal(order.filter((id) => id === playerId).length, 4));
  assert.deepEqual(draft.validateSnakeOrder(order, ranked), { ok: true, errors: [] });
});

test("pick number derives player ID and draft round from fixed ranking", () => {
  assert.deepEqual(draft.pickAssignment(1, ranked), { pickNo: 1, playerId: "player-4", draftRound: 1 });
  assert.deepEqual(draft.pickAssignment(5, ranked), { pickNo: 5, playerId: "player-1", draftRound: 2 });
  assert.deepEqual(draft.pickAssignment(16, ranked), { pickNo: 16, playerId: "player-4", draftRound: 4 });
  assert.throws(() => draft.pickAssignment(0, ranked), /pick_no/);
  assert.throws(() => draft.pickAssignment(17, ranked), /pick_no/);
});

test("phase 1 standings validate IDs and numeric scores, not display names", () => {
  const standings = ranked.map((playerId, index) => ({ player_id: playerId, score: 40 - index, display_name: "Same name" }));
  assert.deepEqual(draft.validatePhase1Standings(standings), { ok: true, errors: [] });
  assert.equal(draft.validatePhase1Standings(standings.map((row) => ({ ...row, score: 0 }))).ok, true);
  assert.equal(draft.validatePhase1Standings([...standings.slice(0, 3), { ...standings[3], player_id: "player-1" }]).ok, false);
  assert.equal(draft.validatePhase1Standings([...standings.slice(0, 3), { ...standings[3], score: "not-a-number" }]).ok, false);
  assert.equal(draft.validatePhase1Standings([...standings.slice(0, 3), { ...standings[3], score: "" }]).ok, false);
  assert.equal(draft.validatePhase1Standings([...standings.slice(0, 3), { ...standings[3], score: null }]).ok, false);
  assert.equal(draft.validatePhase1Standings(standings.slice(0, 3)).ok, false);
});

test("standings resolve score differences and 2, 3, or 4 player ties with fixed draw orders", () => {
  assert.deepEqual(draft.resolvePhase1Ranking([
    { player_id: "p3", score: 20 }, { player_id: "p1", score: 40 },
    { player_id: "p4", score: 10 }, { player_id: "p2", score: 30 },
  ]), ["p1", "p2", "p3", "p4"]);

  const twoTie = [
    { player_id: "p1", score: 40 }, { player_id: "p2", score: 20 },
    { player_id: "p3", score: 20 }, { player_id: "p4", score: 10 },
  ];
  assert.deepEqual(draft.findTiedGroups(twoTie), [["p2", "p3"]]);
  assert.deepEqual(draft.resolvePhase1Ranking(twoTie, { drawOrders: { "20": ["p3", "p2"] } }), ["p1", "p3", "p2", "p4"]);

  const threeTie = ranked.map((playerId, index) => ({ player_id: playerId, score: index === 0 ? 40 : 20 }));
  assert.deepEqual(draft.findTiedGroups(threeTie), [["player-2", "player-3", "player-4"]]);
  assert.deepEqual(draft.resolvePhase1Ranking(threeTie, { drawOrders: { "20": ["player-4", "player-2", "player-3"] } }), ["player-1", "player-4", "player-2", "player-3"]);

  const allTie = ranked.map((playerId) => ({ player_id: playerId, score: 20 }));
  assert.deepEqual(draft.findTiedGroups(allTie), [ranked]);
  assert.deepEqual(draft.resolvePhase1Ranking(allTie, { drawOrders: { "20": lowerFirst } }), lowerFirst);
  assert.throws(() => draft.resolvePhase1Ranking(allTie), /tie draw order/);
});

test("injected random draw is deterministic in tests and persisted order survives reload", () => {
  const values = [0.1, 0.8, 0.2];
  let index = 0;
  const random = () => values[index++];
  const allTie = ranked.map((playerId) => ({ player_id: playerId, score: 0 }));
  const fixedRanking = draft.resolvePhase1Ranking(allTie, { random });
  const storedDraft = activeDraft({ ordered_player_ids: [...fixedRanking].reverse() });
  const first = draft.createSnakeOrder(fixedRanking);
  const reloaded = draft.buildDraftViewState(dbState({ draft: storedDraft, picks: [] }));
  assert.deepEqual(reloaded.snakeOrder, first);
  assert.deepEqual(reloaded.orderedPlayerIds, storedDraft.ordered_player_ids);
});

test("best 16 candidates are extracted by team ID from official finish state", () => {
  const teams = Array.from({ length: 20 }, (_, index) => ({ id: `team-${index + 1}`, name: index < 2 ? "Same school name" : `School ${index + 1}` }));
  const finishes = Object.fromEntries(teams.map((team, index) => [team.id, index < 16 ? "best16" : "initial_loss"]));
  const candidates = draft.extractBest16Candidates({ teams, finishes });
  assert.equal(candidates.length, 16);
  assert.deepEqual(candidates.slice(0, 2).map((team) => team.id), ["team-1", "team-2"]);
});

test("current turn is derived from contiguous persisted picks rather than sparse array length", () => {
  const current = draft.deriveCurrentTurn({ draft: activeDraft({ current_pick_no: 3 }), picks: completedPicks(2) });
  assert.deepEqual(current, { ok: true, errors: [], completed: false, pickNo: 3, playerId: "player-2", draftRound: 1 });

  const sparse = completedPicks(2);
  sparse[1] = { ...sparse[1], pick_no: 3 };
  const invalid = draft.deriveCurrentTurn({ draft: activeDraft({ current_pick_no: 3 }), picks: sparse });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.includes("non_contiguous_picks"));
});

test("pick payload accepts only the authenticated current player and eligible unused team", () => {
  const persistedPicks = completedPicks(2);
  const draftRow = activeDraft({ current_pick_no: 3 });
  const payload = { draft_id: "draft-1", team_id: "team-3", pick_no: 3, draft_round: 1, player_id: "player-2" };
  assert.deepEqual(draft.validatePickPayload({
    draft: draftRow,
    picks: persistedPicks,
    eligibleTeamIds: draftRow.eligible_team_ids,
    authenticatedPlayerId: "player-2",
    payload,
    now: "2026-08-15T12:00:00.000Z",
  }), { ok: true, errors: [] });
});

test("pick payload rejects out-of-field, taken, wrong-turn, forged, round, and pick errors", () => {
  const persistedPicks = completedPicks(2);
  const draftRow = activeDraft({ current_pick_no: 3 });
  const base = { draft_id: "draft-1", team_id: "team-3", pick_no: 3, draft_round: 1, player_id: "player-2" };
  const validate = (payload, authenticatedPlayerId = "player-2") => draft.validatePickPayload({
    draft: draftRow,
    picks: persistedPicks,
    eligibleTeamIds: draftRow.eligible_team_ids,
    authenticatedPlayerId,
    payload: { ...base, ...payload },
    now: "2026-08-15T12:00:00.000Z",
  });
  assert.ok(validate({ team_id: "team-99" }).errors.includes("team_not_eligible"));
  assert.ok(validate({ team_id: "team-1" }).errors.includes("team_taken"));
  assert.ok(validate({ team_id: "team-1", player_id: "player-4" }, "player-4").errors.includes("team_taken_by_self"));
  assert.ok(validate({}, "player-1").errors.includes("wrong_turn"));
  assert.ok(validate({ player_id: "player-1" }).errors.includes("forged_player_id"));
  assert.ok(validate({ draft_round: 2 }).errors.includes("wrong_draft_round"));
  assert.ok(validate({ pick_no: 4 }).errors.includes("wrong_pick_no"));
  assert.ok(validate({ draft_id: "other-draft" }).errors.includes("wrong_draft_id"));
});

test("pick payload rejects fifth pick, completed, deadline, and unauthenticated cases", () => {
  const fourPlayerFourPicks = [1, 5, 12, 16].map((pickNo, index) => ({
    id: `own-${index}`,
    draft_id: "draft-1",
    event_id: "event-1",
    player_id: "player-4",
    team_id: `own-team-${index}`,
    pick_no: pickNo,
    draft_round: index + 1,
  }));
  const fifthDraft = activeDraft({ current_pick_no: 1 });
  const baseArgs = {
    draft: fifthDraft,
    picks: fourPlayerFourPicks,
    eligibleTeamIds: fifthDraft.eligible_team_ids,
    authenticatedPlayerId: "player-4",
    payload: { draft_id: "draft-1", team_id: "team-1", pick_no: 1, draft_round: 1, player_id: "player-4" },
    now: "2026-08-15T12:00:00.000Z",
  };
  assert.ok(draft.validatePickPayload(baseArgs).errors.includes("player_pick_limit"));
  assert.ok(draft.validatePickPayload({ ...baseArgs, draft: activeDraft({ status: "completed", current_pick_no: 16 }) }).errors.includes("draft_completed"));
  assert.ok(draft.validatePickPayload({ ...baseArgs, now: "2026-08-16T00:00:00.000Z" }).errors.includes("deadline_passed"));
  assert.ok(draft.validatePickPayload({ ...baseArgs, authenticatedPlayerId: "" }).errors.includes("authentication_required"));
});

test("16 valid picks are completed and extra or corrupt persisted data is rejected", () => {
  assert.equal(draft.isDraftComplete({ draft: activeDraft({ status: "completed", current_pick_no: 16 }), picks: completedPicks() }), true);
  const duplicateTeam = completedPicks();
  duplicateTeam[15] = { ...duplicateTeam[15], team_id: duplicateTeam[0].team_id };
  const invalid = draft.deriveCurrentTurn({ draft: activeDraft({ status: "completed", current_pick_no: 16 }), picks: duplicateTeam });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.includes("duplicate_team"));
  assert.equal(draft.isDraftComplete({ draft: activeDraft({ status: "completed", current_pick_no: 16 }), picks: completedPicks().slice(0, 15) }), false);
});

test("DB response restores current turn, picked schools, owners, and changed display names", () => {
  const changedPlayers = dbState().players.map((player) => ({ ...player, display_name: player.player_id === "player-2" ? "Renamed" : player.display_name }));
  const view = draft.buildDraftViewState(dbState({ players: changedPlayers }));
  assert.equal(view.available, true);
  assert.equal(view.currentTurn.playerId, "player-2");
  assert.equal(view.currentTurn.displayName, "Renamed");
  assert.equal(view.pickedTeamIds.length, 2);
  assert.equal(view.ownerByTeamId["team-2"].playerId, "player-3");
  assert.equal(view.players[1].profileId, "profile-2");
  assert.equal(view.eligibleTeams[0].finish, "champion");
  assert.equal(view.canViewerPick, true);
});

test("formal participants resolve duplicate display names by profile ID", () => {
  const view = draft.buildDraftViewState(dbState());
  const players = view.players.map((player) => ({ ...player, displayName: "同名" }));
  const predictions = Object.fromEntries(players.map((player, index) => [
    `internal-${index + 1}`,
    { profileId: player.profileId, teams: [`pick-${index + 1}`] },
  ]));

  const resolved = draft.resolveFormalPhase2Participants({ players, predictions });

  assert.equal(resolved.length, 4);
  assert.deepEqual(resolved.map((row) => row.displayName), ["同名", "同名", "同名", "同名"]);
  assert.deepEqual(resolved.map((row) => row.predictionKey), ["internal-1", "internal-2", "internal-3", "internal-4"]);
  assert.deepEqual(resolved.map((row) => row.prediction.teams[0]), ["pick-1", "pick-2", "pick-3", "pick-4"]);
});

test("DB response tolerates duplicate display names but rejects duplicate IDs and sparse picks", () => {
  const sameNames = dbState().players.map((player) => ({ ...player, display_name: "Same name" }));
  assert.equal(draft.buildDraftViewState(dbState({ players: sameNames })).available, true);
  const duplicateIds = dbState().players.map((player, index) => ({ ...player, player_id: index === 3 ? "player-1" : player.player_id }));
  assert.throws(() => draft.buildDraftViewState(dbState({ players: duplicateIds })), /player IDs/i);
  const sparse = completedPicks(2);
  sparse[1] = { ...sparse[1], pick_no: 4 };
  assert.throws(() => draft.buildDraftViewState(dbState({ picks: sparse })), /persisted draft state/i);
});

test("DB response rejects picks outside the fixed draft and event", () => {
  const wrongTeam = completedPicks(2);
  wrongTeam[1] = { ...wrongTeam[1], team_id: "team-outside-best16" };
  assert.throws(() => draft.buildDraftViewState(dbState({ picks: wrongTeam })), /eligible team/i);

  const wrongDraft = completedPicks(2);
  wrongDraft[1] = { ...wrongDraft[1], draft_id: "draft-2" };
  assert.throws(() => draft.buildDraftViewState(dbState({ picks: wrongDraft })), /draft ID/i);

  const wrongEvent = completedPicks(2);
  wrongEvent[1] = { ...wrongEvent[1], event_id: "event-2" };
  assert.throws(() => draft.buildDraftViewState(dbState({ picks: wrongEvent })), /event ID/i);
});

test("missing draft response maps to not_ready without trusting local state", () => {
  assert.deepEqual(draft.buildDraftViewState(null), {
    available: false,
    formalDraftExists: false,
    status: "not_ready",
    message: "phase 2 draft is not ready",
  });
});

test("persisted not_ready row with empty setup stays a normal unavailable state", () => {
  assert.deepEqual(draft.buildDraftViewState({
    draft: activeDraft({
      status: "not_ready",
      ordered_player_ids: [],
      eligible_team_ids: [],
      starts_at: null,
      deadline_at: null,
    }),
    viewer_player_id: null,
    players: [],
    teams: [],
    picks: [],
  }), {
    available: false,
    formalDraftExists: true,
    status: "not_ready",
    message: "phase 2 draft setup is not complete",
  });
});

test("formal phase 2 picks score by player and team IDs with the official fixed points", () => {
  const result = draft.calculateFormalPhase2Scores({
    players: ranked.map((playerId) => ({ playerId, displayName: "Same name" })),
    picks: [
      { playerId: "player-1", teamId: "team-1" },
      { playerId: "player-1", teamId: "team-2" },
      { playerId: "player-1", teamId: "team-3" },
      { playerId: "player-1", teamId: "team-4" },
      { playerId: "player-2", teamId: "team-5" },
    ],
    finishesByTeamId: {
      "team-1": "champion",
      "team-2": "runner_up",
      "team-3": "best4",
      "team-4": "best8",
      "team-5": "best16",
    },
  });

  assert.deepEqual(result.byPlayerId, {
    "player-1": 220,
    "player-2": 0,
    "player-3": 0,
    "player-4": 0,
  });
  assert.deepEqual(result.rows.find((row) => row.playerId === "player-1").teams, [
    { teamId: "team-1", finish: "champion", score: 100 },
    { teamId: "team-2", finish: "runner_up", score: 60 },
    { teamId: "team-3", finish: "best4", score: 40 },
    { teamId: "team-4", finish: "best8", score: 20 },
  ]);
});

test("formal phase 2 scoring rejects ownership rows outside the fixed player IDs", () => {
  assert.throws(() => draft.calculateFormalPhase2Scores({
    players: ranked.map((playerId) => ({ playerId })),
    picks: [{ playerId: "outside-player", teamId: "team-1" }],
    finishesByTeamId: { "team-1": "champion" },
  }), /pick owner/i);
});
