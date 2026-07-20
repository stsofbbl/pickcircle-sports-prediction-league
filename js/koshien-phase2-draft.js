(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoKoshienPhase2Draft = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PLAYER_COUNT = 4;
  const ROUND_COUNT = 4;
  const PICK_COUNT = PLAYER_COUNT * ROUND_COUNT;
  const ELIGIBLE_FINISHES = new Set(["best16", "best8", "best4", "runner_up", "champion"]);

  function unique(values) {
    return new Set(values).size === values.length;
  }

  function normalizedId(value) {
    return String(value || "").trim();
  }

  function validatePhase1Standings(standings) {
    const errors = [];
    if (!Array.isArray(standings) || standings.length !== PLAYER_COUNT) {
      errors.push("invalid_player_count");
      return { ok: false, errors };
    }
    const playerIds = standings.map((row) => normalizedId(row?.player_id));
    if (playerIds.some((playerId) => !playerId)) errors.push("missing_player_id");
    if (!unique(playerIds)) errors.push("duplicate_player_id");
    if (standings.some((row) => !Number.isFinite(Number(row?.score)))) errors.push("invalid_score");
    return { ok: errors.length === 0, errors };
  }

  function groupedStandings(standings) {
    const validation = validatePhase1Standings(standings);
    if (!validation.ok) throw new Error(`invalid phase 1 standings: ${validation.errors.join(", ")}`);
    const sorted = standings
      .map((row) => ({ ...row, player_id: normalizedId(row.player_id), score: Number(row.score) }))
      .sort((left, right) => right.score - left.score);
    const groups = [];
    sorted.forEach((row) => {
      const last = groups.at(-1);
      if (last && last.score === row.score) last.rows.push(row);
      else groups.push({ score: row.score, rows: [row] });
    });
    return groups;
  }

  function findTiedGroups(standings) {
    return groupedStandings(standings)
      .filter((group) => group.rows.length > 1)
      .map((group) => group.rows.map((row) => row.player_id));
  }

  function shuffled(values, random) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const randomValue = Number(random());
      if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue >= 1) {
        throw new Error("random must return a number from 0 inclusive to 1 exclusive");
      }
      const target = Math.floor(randomValue * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  function resolvePhase1Ranking(standings, { drawOrders = {}, random } = {}) {
    return groupedStandings(standings).flatMap((group) => {
      const playerIds = group.rows.map((row) => row.player_id);
      if (playerIds.length === 1) return playerIds;
      const fixedOrder = drawOrders[String(group.score)];
      if (fixedOrder) {
        const normalized = fixedOrder.map(normalizedId);
        if (normalized.length !== playerIds.length || !unique(normalized)
          || normalized.some((playerId) => !playerIds.includes(playerId))) {
          throw new Error(`invalid tie draw order for score ${group.score}`);
        }
        return normalized;
      }
      if (typeof random === "function") return shuffled(playerIds, random);
      throw new Error(`tie draw order is required for score ${group.score}`);
    });
  }

  function validateRankedPlayers(rankedPlayerIds) {
    const normalized = Array.isArray(rankedPlayerIds) ? rankedPlayerIds.map(normalizedId) : [];
    if (normalized.length !== PLAYER_COUNT || normalized.some((playerId) => !playerId) || !unique(normalized)) {
      throw new Error("ranked player IDs must contain 4 unique values");
    }
    return normalized;
  }

  function createSnakeOrder(rankedPlayerIds) {
    const ranked = validateRankedPlayers(rankedPlayerIds);
    const lowerFirst = [...ranked].reverse();
    return [lowerFirst, ranked, lowerFirst, ranked].flat();
  }

  function validateSnakeOrder(order, rankedPlayerIds) {
    const errors = [];
    let expected;
    try {
      expected = createSnakeOrder(rankedPlayerIds);
    } catch {
      return { ok: false, errors: ["invalid_ranked_players"] };
    }
    if (!Array.isArray(order) || order.length !== PICK_COUNT) errors.push("invalid_pick_count");
    if (Array.isArray(order) && order.some((playerId, index) => playerId !== expected[index])) errors.push("invalid_snake_order");
    const normalizedOrder = Array.isArray(order) ? order : [];
    validateRankedPlayers(rankedPlayerIds).forEach((playerId) => {
      if (normalizedOrder.filter((value) => value === playerId).length !== ROUND_COUNT) errors.push("invalid_player_frequency");
    });
    return { ok: errors.length === 0, errors: [...new Set(errors)] };
  }

  function pickAssignment(pickNo, rankedPlayerIds) {
    if (!Number.isInteger(Number(pickNo)) || Number(pickNo) < 1 || Number(pickNo) > PICK_COUNT) {
      throw new Error("pick_no must be between 1 and 16");
    }
    const normalizedPickNo = Number(pickNo);
    return {
      pickNo: normalizedPickNo,
      playerId: createSnakeOrder(rankedPlayerIds)[normalizedPickNo - 1],
      draftRound: Math.floor((normalizedPickNo - 1) / PLAYER_COUNT) + 1,
    };
  }

  function extractBest16Candidates({ teams = [], finishes = {} } = {}) {
    const seen = new Set();
    return teams.filter((team) => {
      const teamId = normalizedId(team?.id || team?.team_id);
      if (!teamId || seen.has(teamId) || !ELIGIBLE_FINISHES.has(finishes[teamId])) return false;
      seen.add(teamId);
      return true;
    });
  }

  function pickedTeamIds(picks = []) {
    return new Set((Array.isArray(picks) ? picks : []).map((pick) => normalizedId(pick?.team_id)).filter(Boolean));
  }

  function rankingFromDraft(draft) {
    const lowerFirst = validateRankedPlayers(draft?.ordered_player_ids);
    return [...lowerFirst].reverse();
  }

  function deriveCurrentTurn({ draft, picks = [] } = {}) {
    const errors = [];
    let rankedPlayers;
    try {
      rankedPlayers = rankingFromDraft(draft);
    } catch {
      return { ok: false, errors: ["invalid_ordered_player_ids"], completed: false, pickNo: null, playerId: null, draftRound: null };
    }
    if (!Array.isArray(picks) || picks.length > PICK_COUNT) {
      return { ok: false, errors: ["invalid_persisted_pick_count"], completed: false, pickNo: null, playerId: null, draftRound: null };
    }
    const sorted = [...picks].sort((left, right) => Number(left.pick_no) - Number(right.pick_no));
    const teamIds = sorted.map((pick) => normalizedId(pick.team_id));
    if (!unique(teamIds)) errors.push("duplicate_team");
    const playerRounds = sorted.map((pick) => `${normalizedId(pick.player_id)}:${Number(pick.draft_round)}`);
    if (!unique(playerRounds)) errors.push("duplicate_player_round");
    sorted.forEach((pick, index) => {
      if (Number(pick.pick_no) !== index + 1) errors.push("non_contiguous_picks");
      const expected = pickAssignment(index + 1, rankedPlayers);
      if (normalizedId(pick.player_id) !== expected.playerId) errors.push("wrong_persisted_player");
      if (Number(pick.draft_round) !== expected.draftRound) errors.push("wrong_persisted_round");
    });
    const completed = sorted.length === PICK_COUNT;
    const expectedCurrentPick = completed ? PICK_COUNT : sorted.length + 1;
    if (Number(draft?.current_pick_no) !== expectedCurrentPick) errors.push("current_pick_mismatch");
    if (draft?.status === "completed" && !completed) errors.push("incomplete_completed_draft");
    if (draft?.status === "drafting" && completed) errors.push("completed_draft_still_drafting");
    if (errors.length) {
      return { ok: false, errors: [...new Set(errors)], completed, pickNo: null, playerId: null, draftRound: null };
    }
    if (completed) return { ok: true, errors: [], completed: true, pickNo: null, playerId: null, draftRound: null };
    const assignment = pickAssignment(expectedCurrentPick, rankedPlayers);
    return { ok: true, errors: [], completed: false, ...assignment };
  }

  function validatePickPayload({
    draft,
    picks = [],
    eligibleTeamIds = [],
    authenticatedPlayerId,
    payload = {},
    now = new Date(),
  } = {}) {
    const errors = [];
    const actorId = normalizedId(authenticatedPlayerId);
    const payloadPlayerId = normalizedId(payload.player_id);
    const teamId = normalizedId(payload.team_id);
    if (!actorId) errors.push("authentication_required");
    if (draft?.status === "completed" || draft?.status === "locked") errors.push("draft_completed");
    else if (draft?.status !== "drafting") errors.push("draft_not_active");
    const currentTime = new Date(now).getTime();
    const startsAt = Date.parse(draft?.starts_at || "");
    const deadlineAt = Date.parse(draft?.deadline_at || "");
    if (Number.isFinite(startsAt) && currentTime < startsAt) errors.push("before_start");
    if (Number.isFinite(deadlineAt) && currentTime >= deadlineAt) errors.push("deadline_passed");
    if (normalizedId(payload.draft_id) !== normalizedId(draft?.id)) errors.push("wrong_draft_id");
    if (payloadPlayerId && payloadPlayerId !== actorId) errors.push("forged_player_id");

    const current = deriveCurrentTurn({ draft, picks });
    if (!current.ok) errors.push("invalid_persisted_state");
    if (current.ok && !current.completed) {
      if (actorId !== current.playerId) errors.push("wrong_turn");
      if (Number(payload.pick_no) !== current.pickNo) errors.push("wrong_pick_no");
      if (Number(payload.draft_round) !== current.draftRound) errors.push("wrong_draft_round");
    }
    if (!eligibleTeamIds.map(normalizedId).includes(teamId)) errors.push("team_not_eligible");
    const existingPick = (Array.isArray(picks) ? picks : []).find((pick) => normalizedId(pick.team_id) === teamId);
    if (existingPick) {
      errors.push(normalizedId(existingPick.player_id) === actorId ? "team_taken_by_self" : "team_taken");
    }
    const playerPickCount = (Array.isArray(picks) ? picks : []).filter((pick) => normalizedId(pick.player_id) === actorId).length;
    if (actorId && playerPickCount >= ROUND_COUNT) errors.push("player_pick_limit");
    return { ok: errors.length === 0, errors: [...new Set(errors)] };
  }

  function isDraftComplete({ draft, picks = [] } = {}) {
    const current = deriveCurrentTurn({ draft, picks });
    return current.ok && current.completed && draft?.status === "completed";
  }

  function buildDraftViewState(response) {
    if (!response?.draft) {
      return { available: false, status: "not_ready", message: "phase 2 draft is not ready" };
    }
    const draft = response.draft;
    const playerRows = Array.isArray(response.players) ? response.players : [];
    const teamRows = Array.isArray(response.teams) ? response.teams : [];
    const picks = Array.isArray(response.picks) ? [...response.picks].sort((left, right) => Number(left.pick_no) - Number(right.pick_no)) : [];
    const playerIds = playerRows.map((player) => normalizedId(player.player_id));
    if (playerRows.length !== PLAYER_COUNT || playerIds.some((playerId) => !playerId) || !unique(playerIds)) {
      throw new Error("DB response player IDs must contain 4 unique values");
    }
    const orderedPlayerIds = validateRankedPlayers(draft.ordered_player_ids);
    if (orderedPlayerIds.some((playerId) => !playerIds.includes(playerId))) {
      throw new Error("DB response ordered player IDs do not match players");
    }
    const eligibleTeamIds = Array.isArray(draft.eligible_team_ids) ? draft.eligible_team_ids.map(normalizedId) : [];
    if (eligibleTeamIds.length !== PICK_COUNT || !unique(eligibleTeamIds)) {
      throw new Error("DB response eligible team IDs must contain 16 unique values");
    }
    const teamsById = new Map(teamRows.map((team) => [normalizedId(team.team_id || team.id), team]));
    if (eligibleTeamIds.some((teamId) => !teamsById.has(teamId))) {
      throw new Error("DB response is missing eligible teams");
    }
    const current = deriveCurrentTurn({ draft, picks });
    if (!current.ok) throw new Error(`invalid persisted draft state: ${current.errors.join(", ")}`);
    const playersById = new Map(playerRows.map((player) => [normalizedId(player.player_id), player]));
    const ownerByTeamId = {};
    picks.forEach((pick) => {
      const player = playersById.get(normalizedId(pick.player_id));
      if (!player) throw new Error("invalid persisted draft state: pick owner is missing");
      ownerByTeamId[normalizedId(pick.team_id)] = {
        playerId: normalizedId(pick.player_id),
        displayName: player.display_name || "参加者",
      };
    });
    const viewerPlayerId = normalizedId(response.viewer_player_id);
    const currentPlayer = current.playerId ? playersById.get(current.playerId) : null;
    const rankedPlayers = [...orderedPlayerIds].reverse();
    return {
      available: true,
      draftId: normalizedId(draft.id),
      eventId: normalizedId(draft.event_id),
      status: draft.status,
      startsAt: draft.starts_at,
      deadlineAt: draft.deadline_at,
      version: Number(draft.version) || 0,
      orderedPlayerIds,
      snakeOrder: createSnakeOrder(rankedPlayers),
      players: playerRows.map((player) => ({ playerId: normalizedId(player.player_id), displayName: player.display_name || "参加者" })),
      eligibleTeams: eligibleTeamIds.map((teamId) => ({ teamId, name: teamsById.get(teamId).name || "高校" })),
      picks: picks.map((pick) => ({
        id: normalizedId(pick.id),
        teamId: normalizedId(pick.team_id),
        playerId: normalizedId(pick.player_id),
        pickNo: Number(pick.pick_no),
        draftRound: Number(pick.draft_round),
        createdAt: pick.created_at || "",
      })),
      pickedTeamIds: [...pickedTeamIds(picks)],
      ownerByTeamId,
      viewerPlayerId,
      currentTurn: current.completed ? null : {
        pickNo: current.pickNo,
        draftRound: current.draftRound,
        playerId: current.playerId,
        displayName: currentPlayer?.display_name || "参加者",
      },
      completed: current.completed,
      canViewerPick: draft.status === "drafting" && !current.completed && viewerPlayerId === current.playerId,
    };
  }

  return {
    ELIGIBLE_FINISHES,
    PICK_COUNT,
    PLAYER_COUNT,
    ROUND_COUNT,
    buildDraftViewState,
    createSnakeOrder,
    deriveCurrentTurn,
    extractBest16Candidates,
    findTiedGroups,
    isDraftComplete,
    pickAssignment,
    pickedTeamIds,
    resolvePhase1Ranking,
    validatePhase1Standings,
    validatePickPayload,
    validateSnakeOrder,
  };
});
