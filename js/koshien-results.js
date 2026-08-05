(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoKoshienResults = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const OFFICIAL_PHASE1_POINTS = Object.freeze({
    initial_loss: 0,
    first_win_then_loss: 1,
    best16: 1.5,
    best8: 2,
    best4: 2.5,
    runner_up: 3.5,
    champion: 5,
  });

  function validateMatchResult(match) {
    if (!match?.team_a_id || !match?.team_b_id) {
      return { ok: false, message: "team_a / team_b が未確定の試合は保存できません。" };
    }
    if (match.team_a_id === match.team_b_id) {
      return { ok: false, message: "同じ高校同士のカードは保存できません。" };
    }
    if (match.score_a === "" || match.score_a === null || match.score_a === undefined
      || match.score_b === "" || match.score_b === null || match.score_b === undefined) {
      return { ok: false, message: "スコアは両校とも入力してください。" };
    }
    const scoreA = Number(match.score_a);
    const scoreB = Number(match.score_b);
    if (!Number.isInteger(scoreA) || scoreA < 0 || !Number.isInteger(scoreB) || scoreB < 0) {
      return { ok: false, message: "スコアは両校とも0以上の整数で入力してください。" };
    }
    if (scoreA === scoreB) {
      return { ok: false, message: "同点では試合を確定できません" };
    }
    if (![match.team_a_id, match.team_b_id].includes(match.winner_id)) {
      return { ok: false, message: "勝者をteam_aまたはteam_bから選んでください。" };
    }
    const scoreWinner = scoreA > scoreB ? match.team_a_id : match.team_b_id;
    if (match.winner_id !== scoreWinner) {
      return { ok: false, message: "勝者とスコアの整合性を確認してください。" };
    }
    return { ok: true };
  }

  function inferMatchWinner(match) {
    if (!match?.team_a_id || !match?.team_b_id || match.team_a_id === match.team_b_id) return "";
    if (match.score_a === "" || match.score_a === null || match.score_a === undefined
      || match.score_b === "" || match.score_b === null || match.score_b === undefined) return "";
    const scoreA = Number(match.score_a);
    const scoreB = Number(match.score_b);
    if (!Number.isInteger(scoreA) || scoreA < 0 || !Number.isInteger(scoreB) || scoreB < 0 || scoreA === scoreB) return "";
    return scoreA > scoreB ? match.team_a_id : match.team_b_id;
  }

  function nextUnenteredMatchId(matches = [], currentMatchId = "") {
    if (!matches.length) return "";
    const currentIndex = matches.findIndex((match) => match?.match_id === currentMatchId);
    const startIndex = currentIndex >= 0 ? currentIndex : -1;
    for (let offset = 1; offset <= matches.length; offset += 1) {
      const match = matches[(startIndex + offset) % matches.length];
      if (match?.status !== "completed" && match?.status !== "final") return match?.match_id || "";
    }
    return "";
  }

  function eligibleTeamsForMatch({ teams = [], teamMeta = {}, matches = [], matchId = "", side = "a" }) {
    const match = matches.find((item) => item?.match_id === matchId);
    if (!match) return [];

    const previousRound = { R2: "R1", R3: "R2", QF: "R3", SF: "QF", F: "SF" }[match.round];
    const advancingTeams = new Set(
      matches
        .filter((item) => item?.round === previousRound
          && (item.status === "completed" || item.status === "final")
          && item.winner_id)
        .map((item) => item.winner_id),
    );
    const eligible = match.round === "R1"
      ? new Set(teams.filter((team) => Number(teamMeta?.[team]?.startRound) !== 2))
      : match.round === "R2"
        ? new Set([
          ...advancingTeams,
          ...teams.filter((team) => Number(teamMeta?.[team]?.startRound) === 2),
        ])
        : advancingTeams;
    const eliminated = new Set(
      matches
        .filter((item) => item?.status === "completed" || item?.status === "final")
        .map((item) => item.loser_id)
        .filter(Boolean),
    );
    const usedByOtherMatch = new Set(
      matches
        .filter((item) => item?.round === match.round && item.match_id !== matchId)
        .flatMap((item) => [item.team_a_id, item.team_b_id])
        .filter(Boolean),
    );
    const current = side === "b" ? match.team_b_id : match.team_a_id;
    const opposite = side === "b" ? match.team_a_id : match.team_b_id;

    return teams.filter((team) => (
      team !== opposite
      && (team === current || (
        !usedByOtherMatch.has(team)
        && eligible.has(team)
        && !eliminated.has(team)
      ))
    ));
  }

  function completeMatch(match) {
    const validation = validateMatchResult(match);
    if (!validation.ok) return validation;
    return {
      ok: true,
      match: {
        ...match,
        loser_id: match.winner_id === match.team_a_id ? match.team_b_id : match.team_a_id,
        status: "completed",
      },
    };
  }

  function loserFinishForRound(round, startRound = 1) {
    if (round === "R1") return "initial_loss";
    if (round === "R2") return Number(startRound) === 2 ? "initial_loss" : "first_win_then_loss";
    if (round === "R3") return "best16";
    if (round === "QF") return "best8";
    if (round === "SF") return "best4";
    if (round === "F") return "runner_up";
    return "";
  }

  function numericScore(value) {
    return value === "" || value === null || value === undefined ? null : Number(value);
  }

  function roundMatchNo(match, index) {
    return Number(match.match_no) || Number(String(match.match_id || "").split("-")[1]) || index + 1;
  }

  function buildMatchRows({ eventId, matches = [], teams = [] }) {
    const teamByName = new Map(teams.map((team) => [team.name, team]));
    return matches
      .filter((match) => match?.team_a_id && match?.team_b_id)
      .map((match, index) => {
        const teamA = teamByName.get(match.team_a_id);
        const teamB = teamByName.get(match.team_b_id);
        const winner = teamByName.get(match.winner_id);
        const loser = teamByName.get(match.loser_id);
        const completed = match.status === "completed" || match.status === "final";
        if (completed && (!teamA?.id || !teamB?.id || !winner?.id || !loser?.id)) {
          throw new Error(`completed試合のteam_id対応を確認できません: ${match.match_id || `${match.round}-${match.match_no}`}`);
        }
        return {
          event_id: eventId,
          round_key: match.round || "R1",
          match_no: roundMatchNo(match, index),
          team1_id: teamA?.id || null,
          team2_id: teamB?.id || null,
          team1_score: numericScore(match.score_a),
          team2_score: numericScore(match.score_b),
          winner_team_id: winner?.id || null,
          loser_team_id: loser?.id || null,
          status: completed ? "completed" : "scheduled",
          metadata: {
            ...(match.metadata && typeof match.metadata === "object" ? match.metadata : {}),
            match_id: match.match_id || null,
            team_a_name: match.team_a_id || "",
            team_b_name: match.team_b_id || "",
            winner_name: match.winner_id || "",
            loser_team_id: loser?.id || null,
            loser_name: match.loser_id || "",
            app_status: match.status || "scheduled",
          },
        };
      });
  }

  function mergeStructuredMatchesIntoResults(resultsPayload = {}, structuredMatches = [], teams = []) {
    const next = JSON.parse(JSON.stringify(resultsPayload || {}));
    if (!Array.isArray(next.matches) || !Array.isArray(structuredMatches) || !structuredMatches.length) return next;
    const teamNameById = new Map(teams.map((team) => [String(team.id || team.team_id || ""), String(team.name || "")]));
    const slotByKey = new Map(next.matches.map((match, index) => [`${match.round}:${Number(match.match_no)}`, index]));

    structuredMatches.forEach((stored) => {
      const round = String(stored.round_key || stored.roundKey || "");
      const matchNo = Number(stored.match_no ?? stored.matchNo);
      const slot = slotByKey.get(`${round}:${matchNo}`);
      const teamA = teamNameById.get(String(stored.team1_id || stored.team1Id || ""));
      const teamB = teamNameById.get(String(stored.team2_id || stored.team2Id || ""));
      if (slot === undefined || !teamA || !teamB) return;
      const completed = String(stored.status || "") === "completed";
      const winner = completed ? teamNameById.get(String(stored.winner_team_id || stored.winnerTeamId || "")) || "" : "";
      const loser = completed ? teamNameById.get(String(stored.loser_team_id || stored.loserTeamId || "")) || "" : "";
      next.matches[slot] = {
        ...next.matches[slot],
        match_id: next.matches[slot].match_id || `${round}-${matchNo}`,
        round,
        match_no: matchNo,
        team_a_id: teamA,
        team_b_id: teamB,
        score_a: completed ? Number(stored.team1_score ?? stored.team1Score) : "",
        score_b: completed ? Number(stored.team2_score ?? stored.team2Score) : "",
        winner_id: winner,
        loser_id: loser,
        status: completed ? "completed" : "scheduled",
        metadata: {
          ...(next.matches[slot].metadata && typeof next.matches[slot].metadata === "object" ? next.matches[slot].metadata : {}),
          ...(stored.metadata && typeof stored.metadata === "object" ? stored.metadata : {}),
        },
      };
    });
    return next;
  }

  function normalizeFinish(finish) {
    const aliases = {
      best32: "first_win_then_loss",
      semifinal: "best4",
      runnerUp: "runner_up",
      quarterfinal: "best8",
    };
    return aliases[finish] || finish || "";
  }

  function calculatePhase1Breakdown({
    picks = [],
    captain = "",
    finishes = {},
    teamMeta = {},
    stagePoints = {},
    captainMultiplier = 1.2,
    gameMultiplierCap = 50,
  }) {
    const uniquePicks = [...new Set(picks.filter(Boolean))];
    const rows = uniquePicks.map((team) => {
      const finish = normalizeFinish(finishes[team]);
      const stagePoint = Number(stagePoints[finish]) || 0;
      const meta = teamMeta[team] || {};
      const savedMultiplier = Number(meta.gameMultiplier);
      const gameMultiplier = savedMultiplier > 0
        ? Math.min(savedMultiplier, Number(gameMultiplierCap) || 50)
        : 0;
      const multiplier = captain === team ? Number(captainMultiplier) || 1.2 : 1;
      return { team, finish, stagePoint, gameMultiplier, multiplier, score: stagePoint * gameMultiplier * multiplier };
    });
    return { total: rows.reduce((total, row) => total + row.score, 0), rows };
  }

  function buildScoreRows({ eventId, players = [], scoreRows = [] }) {
    const playersById = new Map(players.map((player) => [String(player.id || ""), player]));
    const playersByProfileId = new Map(players.map((player) => [String(player.profile_id || ""), player]));
    const playersByName = new Map();
    players.forEach((player) => {
      const rows = playersByName.get(player.display_name) || [];
      rows.push(player);
      playersByName.set(player.display_name, rows);
    });
    return scoreRows.map((row) => {
      const officialPlayerId = String(row.playerId || row.player_id || "");
      const officialProfileId = String(row.profileId || row.profile_id || "");
      const namedPlayers = playersByName.get(row.name) || [];
      if (!officialPlayerId && !officialProfileId && namedPlayers.length > 1) {
        throw new Error(`players.display_name が重複しています: ${row.name}`);
      }
      const player = officialPlayerId
        ? playersById.get(officialPlayerId)
        : officialProfileId ? playersByProfileId.get(officialProfileId) : namedPlayers[0];
      if (!player?.id) {
        throw new Error(`scores保存先のplayer_idを確認できません: ${officialPlayerId || officialProfileId || row.name}`);
      }
      const breakdown = row.breakdown || {};
      return {
        event_id: eventId,
        player_id: player.id,
        phase1_score: Number(breakdown.phase1) || 0,
        phase2_score: Number(breakdown.phase2) || 0,
        phase3_score: Number(breakdown.phase3) || 0,
        revenge_score: Number(breakdown.revenge) || 0,
        zombie_score: Number(breakdown.zombie) || 0,
        breakdown: {
          ...breakdown,
          total: Number(row.score) || 0,
          detail: row.detail || "",
        },
      };
    });
  }

  function buildOfficialScoreRows({ members = [], players = [], scores = [] } = {}) {
    const playersByProfileId = new Map(players.map((player) => [String(player.profile_id || ""), player]));
    const scoresByPlayerId = new Map(scores.map((score) => [String(score.player_id || ""), score]));
    return members.map((member) => {
      const profileId = String(member.user_id || member.profile_id || "");
      const player = playersByProfileId.get(profileId);
      const score = scoresByPlayerId.get(String(player?.id || ""));
      const phase1 = Number(score?.phase1_score) || 0;
      const phase2 = Number(score?.phase2_score) || 0;
      const phase3 = Number(score?.phase3_score) || 0;
      const revenge = Number(score?.revenge_score) || 0;
      const zombie = Number(score?.zombie_score) || 0;
      return {
        name: member.display_name || member.displayName || player?.display_name || "参加者",
        playerId: player?.id || "",
        profileId,
        score: Number(score?.total_score) || 0,
        breakdown: {
          ...(score?.breakdown || {}),
          phase1,
          phase2,
          phase3,
          revenge,
          zombie,
        },
      };
    });
  }

  function rankScoreRows(rows = []) {
    const sorted = [...rows].sort((left, right) => (
      (Number(right.score) - Number(left.score))
      || ((left.tiebreakDelta ?? Infinity) - (right.tiebreakDelta ?? Infinity))
    ));
    let previousScore;
    let previousRank = 0;
    return sorted.map((row, index) => {
      const score = Number(row.score) || 0;
      const rank = index > 0 && score === previousScore ? previousRank : index + 1;
      previousScore = score;
      previousRank = rank;
      return { ...row, rank };
    });
  }

  return {
    OFFICIAL_PHASE1_POINTS,
    buildMatchRows,
    mergeStructuredMatchesIntoResults,
    buildOfficialScoreRows,
    buildScoreRows,
    calculatePhase1Breakdown,
    completeMatch,
    eligibleTeamsForMatch,
    inferMatchWinner,
    loserFinishForRound,
    nextUnenteredMatchId,
    normalizeFinish,
    rankScoreRows,
    validateMatchResult,
  };
});
