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
      return { ok: false, message: "同点は保存できません。勝敗が決まったスコアを入力してください。" };
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

  return { OFFICIAL_PHASE1_POINTS, buildMatchRows, buildScoreRows, calculatePhase1Breakdown, completeMatch, loserFinishForRound, normalizeFinish, rankScoreRows, validateMatchResult };
});
