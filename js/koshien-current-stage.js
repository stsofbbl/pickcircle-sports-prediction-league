(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoKoshienCurrentStage = api;

  if (!root || typeof root.addEventListener !== "function") return;
  root.addEventListener("load", () => {
    if (typeof applyKoshienMatchFinishes !== "function") return;
    applyKoshienMatchFinishes = function applyKoshienCurrentStageFinishes() {
      normalizeKoshienEvent(state.event);
      const matches = state.event.results.matches || [];
      state.event.results.finishes = api.deriveCurrentStages({
        teams: state.event.config.teams || [],
        matches,
        teamMeta: state.event.config.teamMeta || {},
      });

      const finalMatch = matches.find((match) => (
        match.round === "F"
        && match.status === "completed"
        && match.winner_id
        && match.loser_id
      ));
      if (finalMatch) {
        state.event.results.finalScore = {
          champion: finalMatch.winner_id,
          runnerUp: finalMatch.loser_id,
          championScore: finalMatch.winner_id === finalMatch.team_a_id ? finalMatch.score_a : finalMatch.score_b,
          runnerUpScore: finalMatch.winner_id === finalMatch.team_a_id ? finalMatch.score_b : finalMatch.score_a,
        };
      }
    };
  }, { once: true });
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ROUND_PROGRESS = Object.freeze({
    R1: "first_win_then_loss",
    R2: "best16",
    R3: "best8",
    QF: "best4",
    SF: "best4",
    F: "champion",
  });
  const ROUND_RANK = Object.freeze({ R1: 1, R2: 2, R3: 3, QF: 4, SF: 5, F: 6 });

  function loserStage(round, startRound = 1) {
    if (round === "R1") return "initial_loss";
    if (round === "R2") return Number(startRound) === 2 ? "initial_loss" : "first_win_then_loss";
    if (round === "R3") return "best16";
    if (round === "QF") return "best8";
    if (round === "SF") return "best4";
    if (round === "F") return "runner_up";
    return "";
  }

  function currentStageForTeam({ team, matches = [], startRound = 1 } = {}) {
    const completed = matches.filter((match) => (
      match?.status === "completed"
      && [match.team_a_id, match.team_b_id, match.winner_id, match.loser_id].includes(team)
    ));
    const finalWin = completed.find((match) => match.round === "F" && match.winner_id === team);
    if (finalWin) return "champion";

    const loss = completed
      .filter((match) => match.loser_id === team)
      .sort((left, right) => (ROUND_RANK[right.round] || 0) - (ROUND_RANK[left.round] || 0))[0];
    if (loss) return loserStage(loss.round, startRound);

    const latestWin = completed
      .filter((match) => match.winner_id === team)
      .sort((left, right) => (ROUND_RANK[right.round] || 0) - (ROUND_RANK[left.round] || 0))[0];
    return latestWin ? (ROUND_PROGRESS[latestWin.round] || "") : "";
  }

  function deriveCurrentStages({ teams = [], matches = [], teamMeta = {} } = {}) {
    return Object.fromEntries(teams.map((team) => [
      team,
      currentStageForTeam({
        team,
        matches,
        startRound: Number(teamMeta?.[team]?.startRound) === 2 ? 2 : 1,
      }),
    ]).filter(([, stage]) => stage));
  }

  return Object.freeze({ currentStageForTeam, deriveCurrentStages, loserStage });
});
