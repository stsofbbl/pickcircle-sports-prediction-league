(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoKoshienCurrentStage = api;

  if (!root || typeof root.addEventListener !== "function") return;

  let deadlineRefreshTimer = 0;
  let deadlineLookupTimer = 0;
  let deadlineLookupAttempts = 0;
  let deadlineRefreshInFlight = false;
  let predictionRuleGuideObserver = null;

  const KOSHIEN_PREDICTION_NOTICE = "この画面は予想入力専用です";

  function activeKoshienDeadlineMs() {
    if (typeof state !== "object" || !state?.event) return Number.NaN;
    const event = state.event;
    if (!String(event.templateId || "").includes("koshien")) return Number.NaN;
    return Date.parse(event.deadline || "");
  }

  async function forceKoshienRefresh() {
    if (deadlineRefreshInFlight || typeof loadKoshienOnlineState !== "function") return;
    deadlineRefreshInFlight = true;
    try {
      await loadKoshienOnlineState({ force: true });
    } catch (error) {
      console.warn("Koshien deadline refresh failed", error);
    } finally {
      deadlineRefreshInFlight = false;
    }
  }

  function scheduleKoshienDeadlineRefresh() {
    if (deadlineRefreshTimer) root.clearTimeout(deadlineRefreshTimer);
    if (deadlineLookupTimer) root.clearTimeout(deadlineLookupTimer);
    deadlineRefreshTimer = 0;
    deadlineLookupTimer = 0;

    const deadlineMs = activeKoshienDeadlineMs();
    if (!Number.isFinite(deadlineMs)) {
      if (deadlineLookupAttempts < 30) {
        deadlineLookupAttempts += 1;
        deadlineLookupTimer = root.setTimeout(scheduleKoshienDeadlineRefresh, 1000);
      }
      return;
    }

    deadlineLookupAttempts = 0;
    const delayMs = deadlineMs - Date.now();
    if (delayMs <= 0) return;
    deadlineRefreshTimer = root.setTimeout(() => {
      deadlineRefreshTimer = 0;
      void forceKoshienRefresh();
    }, delayMs + 100);
  }

  function replaceKoshienPredictionNoticeWithRuleGuide() {
    const eventForm = root.document?.querySelector("#eventForm");
    if (!eventForm) return;
    const notice = [...eventForm.children].find((element) => (
      element.classList?.contains("active-manager-note")
      && element.querySelector("strong")?.textContent.trim() === KOSHIEN_PREDICTION_NOTICE
    ));
    if (!notice) return;

    const sourceGuide = root.document.querySelector(
      "#activeTournamentCards .rule-guide-panel.is-compact, #homeTournamentCards .rule-guide-panel.is-compact",
    );
    if (!sourceGuide) return;
    notice.replaceWith(sourceGuide.cloneNode(true));
  }

  function observeKoshienPredictionRuleGuide() {
    const eventForm = root.document?.querySelector("#eventForm");
    if (!eventForm || typeof root.MutationObserver !== "function") return;
    predictionRuleGuideObserver?.disconnect();
    predictionRuleGuideObserver = new root.MutationObserver(replaceKoshienPredictionNoticeWithRuleGuide);
    predictionRuleGuideObserver.observe(eventForm, { childList: true });
    replaceKoshienPredictionNoticeWithRuleGuide();
  }

  root.addEventListener("load", () => {
    if (typeof applyKoshienMatchFinishes === "function") {
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
    }

    observeKoshienPredictionRuleGuide();
    scheduleKoshienDeadlineRefresh();
    if (activeKoshienDeadlineMs() <= Date.now()) void forceKoshienRefresh();
  }, { once: true });

  root.document?.addEventListener("visibilitychange", () => {
    if (root.document.visibilityState !== "visible") return;
    scheduleKoshienDeadlineRefresh();
    void forceKoshienRefresh();
  });

  root.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    scheduleKoshienDeadlineRefresh();
    void forceKoshienRefresh();
  });
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
