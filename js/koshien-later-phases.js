(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoKoshienLaterPhases = api;

  if (root?.document && typeof root.setTimeout === "function") {
    const installCompactPhase3Styles = () => {
      if (root.document.querySelector("#yoso-phase3-compact-style")) return;
      const style = root.document.createElement("style");
      style.id = "yoso-phase3-compact-style";
      style.textContent = `
        #eventForm .koshien-phase3-predictions { gap: 10px; }
        #eventForm .koshien-phase3-case { gap: 10px; padding: 14px; }
        #eventForm .koshien-phase3-case .form-grid {
          display: grid !important;
          grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
          gap: 10px !important;
        }
        #eventForm .koshien-phase3-case .form-grid .field {
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) 54px !important;
          align-items: center;
          gap: 6px !important;
          min-width: 0;
        }
        #eventForm .koshien-phase3-case .form-grid .field > span {
          margin: 0;
          font-size: 12px;
          line-height: 1.3;
          white-space: nowrap;
        }
        #eventForm .koshien-phase3-case input[type="number"] {
          width: 54px !important;
          min-width: 54px !important;
          height: 44px !important;
          min-height: 44px !important;
          padding: 4px 6px !important;
          font-size: 20px !important;
        }
        #eventForm .koshien-preset-panel.is-current-phase-only {
          padding: 0 !important;
          border: 0 !important;
          background: transparent !important;
          box-shadow: none !important;
        }
        @media (max-width: 420px) {
          #eventForm .koshien-phase3-case .form-grid { gap: 8px !important; }
          #eventForm .koshien-phase3-case .form-grid .field {
            grid-template-columns: minmax(0, 1fr) 48px !important;
            gap: 5px !important;
          }
          #eventForm .koshien-phase3-case .form-grid .field > span { font-size: 11px; }
          #eventForm .koshien-phase3-case input[type="number"] {
            width: 48px !important;
            min-width: 48px !important;
            font-size: 18px !important;
          }
        }
      `;
      root.document.head?.appendChild(style);
    };

    const maybeActivateOpenPhase3 = () => {
      let laterView = null;
      try {
        laterView = typeof koshienLaterPhaseView !== "undefined" ? koshienLaterPhaseView : null;
      } catch (_error) {
        return;
      }
      const phase3Round = laterView?.loadedFromDb ? laterView.rounds?.phase3 : null;
      if (!["open", "locked", "completed"].includes(phase3Round?.status)) return;
      const phase3Button = root.document.querySelector("#eventForm [data-koshien-phase='phase3']");
      if (!phase3Button || phase3Button.classList.contains("is-active")) return;
      phase3Button.click();
    };

    const cleanupRetiredKoshienUi = () => {
      const panel = root.document.querySelector("#eventForm .koshien-preset-panel");
      if (panel) {
        [...panel.children].forEach((child) => {
          if (child.matches(".match-kicker, h3, p, .koshien-score-strip, .worldcup-phase-tabs")) child.remove();
        });
        panel.classList.add("is-current-phase-only");
        [...panel.querySelectorAll(".entry-block")].forEach((block) => {
          const heading = block.querySelector("h3")?.textContent?.trim() || "";
          if (heading === "ゾンビモード") block.remove();
        });
        const phase3Intro = [...panel.querySelectorAll(".wc-phase-intro")]
          .find((node) => node.textContent?.includes("完全一致50点"));
        if (phase3Intro) {
          phase3Intro.textContent = "決勝2校は公式結果から固定されています。完全一致50点。完全一致者がいない場合は、勝敗的中者の中で最接近者に30点です。";
        }
      }

      root.document.body?.classList.remove("is-zombie-mypage");
      const home = root.document.querySelector("#home");
      home?.classList.remove("is-zombie-period", "zombie-theme-active");
      home?.querySelectorAll("[data-zombie-public-status]").forEach((node) => node.remove());
    };

    let installAttempts = 0;
    const installLaterPhaseInputPersistence = () => {
      if (root.__yosoKoshienLaterPhaseInputPersistenceInstalled) return;
      const originalRender = root.render;
      if (typeof originalRender !== "function") {
        installAttempts += 1;
        if (installAttempts < 250) root.setTimeout(installLaterPhaseInputPersistence, 40);
        return;
      }

      installCompactPhase3Styles();
      root.render = function renderWithLaterPhaseInputPersistence() {
        const form = root.document.querySelector("#eventForm");
        const snapshot = {
          revengeTeam: form?.querySelector("[data-koshien-revenge-team]")?.value || "",
          zombieTeam: form?.querySelector("[data-koshien-zombie-team]")?.value || "",
          scoreA: form?.querySelector("[data-koshien-phase3-score='a']")?.value ?? "",
          scoreB: form?.querySelector("[data-koshien-phase3-score='b']")?.value ?? "",
          tiebreakScoreA: form?.querySelector("[data-koshien-phase3-tiebreak-score='a']")?.value ?? "",
          tiebreakScoreB: form?.querySelector("[data-koshien-phase3-tiebreak-score='b']")?.value ?? "",
        };
        const result = originalRender.apply(this, arguments);
        const nextForm = root.document.querySelector("#eventForm");
        const revenge = nextForm?.querySelector("[data-koshien-revenge-team]");
        const zombie = nextForm?.querySelector("[data-koshien-zombie-team]");
        const scoreA = nextForm?.querySelector("[data-koshien-phase3-score='a']");
        const scoreB = nextForm?.querySelector("[data-koshien-phase3-score='b']");
        const tiebreakScoreA = nextForm?.querySelector("[data-koshien-phase3-tiebreak-score='a']");
        const tiebreakScoreB = nextForm?.querySelector("[data-koshien-phase3-tiebreak-score='b']");
        if (revenge && snapshot.revengeTeam) revenge.value = snapshot.revengeTeam;
        if (zombie && snapshot.zombieTeam) zombie.value = snapshot.zombieTeam;
        if (scoreA && snapshot.scoreA !== "") scoreA.value = snapshot.scoreA;
        if (scoreB && snapshot.scoreB !== "") scoreB.value = snapshot.scoreB;
        if (tiebreakScoreA && snapshot.tiebreakScoreA !== "") tiebreakScoreA.value = snapshot.tiebreakScoreA;
        if (tiebreakScoreB && snapshot.tiebreakScoreB !== "") tiebreakScoreB.value = snapshot.tiebreakScoreB;
        root.setTimeout(maybeActivateOpenPhase3, 0);
        root.setTimeout(cleanupRetiredKoshienUi, 0);
        root.setTimeout(cleanupRetiredKoshienUi, 80);
        return result;
      };
      root.__yosoKoshienLaterPhaseInputPersistenceInstalled = true;
      root.setTimeout(maybeActivateOpenPhase3, 0);
      root.setTimeout(cleanupRetiredKoshienUi, 0);
    };
    root.setTimeout(installLaterPhaseInputPersistence, 0);
    root.addEventListener?.("load", () => root.setTimeout(installLaterPhaseInputPersistence, 0), { once: true });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ARRIVAL_POINTS = Object.freeze({
    initial_loss: 0,
    first_win_then_loss: 1,
    best16: 1.5,
    best8: 2,
    best4: 2.5,
    runner_up: 3.5,
    champion: 5,
  });

  function uniqueIds(values = []) {
    return [...new Set(values.map((value) => String(value || "")).filter(Boolean))];
  }

  function calculateRevengeScore({ finishKey, sqrtOdds, sqrtOddsCap = 50 } = {}) {
    const arrival = Number(ARRIVAL_POINTS[finishKey]) || 0;
    const multiplier = Math.min(Math.max(Number(sqrtOdds) || 0, 0), Number(sqrtOddsCap) || 50);
    return Math.max(0, arrival - 1.5) * multiplier;
  }

  function deriveRevengeEligibility({ phase1TeamIds = [], best16TeamIds = [], directEliminatorByTeamId = {} } = {}) {
    const picks = uniqueIds(phase1TeamIds);
    const best16 = uniqueIds(best16TeamIds);
    const best16Set = new Set(best16);
    if (picks.length !== 8 || picks.some((teamId) => best16Set.has(teamId))) {
      return { eligible: false, allowedTeamIds: [], fallbackAllowed: false };
    }
    const direct = uniqueIds(picks.map((teamId) => directEliminatorByTeamId[teamId]))
      .filter((teamId) => best16Set.has(teamId));
    return {
      eligible: true,
      allowedTeamIds: direct.length ? direct : best16,
      fallbackAllowed: direct.length === 0,
    };
  }

  function deriveZombiePreEligibility({ playerId, formalPicks = [], eliminatedTeamIds = [] } = {}) {
    const ownTeamIds = uniqueIds(formalPicks
      .filter((pick) => String(pick.playerId || "") === String(playerId || ""))
      .map((pick) => pick.teamId));
    if (ownTeamIds.length !== 4) {
      return { confirmed: false, ownTeamIds, remainingTeamIds: ownTeamIds };
    }
    const eliminated = new Set(uniqueIds(eliminatedTeamIds));
    const remainingTeamIds = ownTeamIds.filter((teamId) => !eliminated.has(teamId));
    return {
      confirmed: remainingTeamIds.length === 0,
      ownTeamIds,
      remainingTeamIds,
    };
  }

  function deriveZombieEligibility({ playerId, formalPicks = [], best4TeamIds = [] } = {}) {
    const best4 = new Set(uniqueIds(best4TeamIds));
    const ownTeamIds = uniqueIds(formalPicks
      .filter((pick) => String(pick.playerId || "") === String(playerId || ""))
      .map((pick) => pick.teamId));
    if (ownTeamIds.length !== 4 || ownTeamIds.some((teamId) => best4.has(teamId))) {
      return { eligible: false, allowedTeamIds: [] };
    }
    const allowedTeamIds = uniqueIds(formalPicks
      .filter((pick) => String(pick.playerId || "") !== String(playerId || ""))
      .map((pick) => pick.teamId))
      .filter((teamId) => best4.has(teamId));
    return { eligible: allowedTeamIds.length > 0, allowedTeamIds };
  }

  function calculateZombieAdjustments({ formalPicks = [], predictions = [], finishByTeamId = {} } = {}) {
    const ownerByTeamId = new Map(formalPicks.map((pick) => [String(pick.teamId || ""), String(pick.playerId || "")]));
    const hitsByTeamId = new Map();
    predictions.forEach((prediction) => {
      const teamId = String(prediction.teamId || "");
      if (!ownerByTeamId.has(teamId) || finishByTeamId[teamId] !== "best4") return;
      hitsByTeamId.set(teamId, (hitsByTeamId.get(teamId) || 0) + 1);
    });
    const byPlayerId = {};
    const byTeamId = {};
    hitsByTeamId.forEach((hitCount, teamId) => {
      const adjustment = hitCount >= 2 ? -40 : -20;
      const ownerId = ownerByTeamId.get(teamId);
      byTeamId[teamId] = { ownerId, hitCount, adjustment };
      byPlayerId[ownerId] = (byPlayerId[ownerId] || 0) + adjustment;
    });
    return { byPlayerId, byTeamId };
  }

  function validateFinalScore(scoreA, scoreB) {
    const left = Number(scoreA);
    const right = Number(scoreB);
    if (!Number.isInteger(left) || left < 0 || !Number.isInteger(right) || right < 0) {
      return { ok: false, message: "両校の得点を0以上の整数で入力してください。" };
    }
    if (left === right) return { ok: false, message: "同点予想はできません。" };
    return { ok: true, scoreA: left, scoreB: right };
  }

  function finalScoreMetric(prediction, actual) {
    const predictedMargin = Number(prediction.scoreA) - Number(prediction.scoreB);
    const actualMargin = Number(actual.scoreA) - Number(actual.scoreB);
    return [
      Math.abs(Number(prediction.scoreA) - Number(actual.scoreA))
        + Math.abs(Number(prediction.scoreB) - Number(actual.scoreB)),
      Math.sign(predictedMargin) === Math.sign(actualMargin) ? 0 : 1,
      Math.abs(predictedMargin - actualMargin),
      Math.abs((Number(prediction.scoreA) + Number(prediction.scoreB))
        - (Number(actual.scoreA) + Number(actual.scoreB))),
    ];
  }

  function sameMetric(left, right) {
    return left.every((value, index) => value === right[index]);
  }

  function compareMetric(left, right) {
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
  }

  function calculatePhase3Scores({ predictions = [], actual } = {}) {
    if (!actual || !validateFinalScore(actual.scoreA, actual.scoreB).ok) return {};
    const useTiebreak = actual.usedTiebreak === true;
    const applicable = predictions.map((prediction) => ({
      ...prediction,
      scoreA: useTiebreak ? prediction.tiebreakScoreA : prediction.scoreA,
      scoreB: useTiebreak ? prediction.tiebreakScoreB : prediction.scoreB,
    }));
    const valid = applicable.filter((prediction) => validateFinalScore(prediction.scoreA, prediction.scoreB).ok);
    const exact = valid.filter((prediction) => (
      Number(prediction.scoreA) === Number(actual.scoreA)
      && Number(prediction.scoreB) === Number(actual.scoreB)
    ));
    if (exact.length) return Object.fromEntries(exact.map((prediction) => [String(prediction.playerId), 50]));
    const winnerMatched = valid.filter((prediction) => (
      Math.sign(Number(prediction.scoreA) - Number(prediction.scoreB))
      === Math.sign(Number(actual.scoreA) - Number(actual.scoreB))
    ));
    const ranked = winnerMatched.map((prediction) => ({ prediction, metric: finalScoreMetric(prediction, actual) }))
      .sort((left, right) => compareMetric(left.metric, right.metric));
    if (!ranked.length) return {};
    return Object.fromEntries(ranked
      .filter((row) => sameMetric(row.metric, ranked[0].metric))
      .map((row) => [String(row.prediction.playerId), 30]));
  }

  return {
    ARRIVAL_POINTS,
    calculatePhase3Scores,
    calculateRevengeScore,
    calculateZombieAdjustments,
    deriveRevengeEligibility,
    deriveZombieEligibility,
    deriveZombiePreEligibility,
    validateFinalScore,
  };
});
