(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoHomeTodayAllPhases = api;

  if (!root || typeof root.setTimeout !== "function" || !root.document) return;

  function waitForHomeDashboard() {
    if (!root.__yosoHomeDashboardV2Installed || !root.YosoHomeDashboardPolish) {
      root.setTimeout(waitForHomeDashboard, 40);
      return;
    }
    api.installBrowser(root);
  }

  waitForHomeDashboard();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STYLE_ID = "yoso-home-today-all-phases-style";
  const INSTALL_FLAG = "__yosoHomeTodayAllPhasesInstalled";

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeTeamName(value) {
    if (typeof value === "string") return value.trim();
    if (!value || typeof value !== "object") return "";
    return String(value.name || value.teamName || value.schoolName || value.team || "").trim();
  }

  function phase1ParticipantTeams(event, participantName) {
    const prediction = event?.predictions?.[participantName] || null;
    const teams = Array.isArray(prediction?.teams) ? prediction.teams : [];
    return teams.map(normalizeTeamName).filter(Boolean);
  }

  function phase2ParticipantTeams(view, participantName) {
    if (!view?.available || !["locked", "completed"].includes(String(view.status || ""))) return [];
    if (!Array.isArray(view.picks) || view.picks.length !== 16) return [];
    const player = (Array.isArray(view.players) ? view.players : [])
      .find((item) => String(item?.displayName || "") === String(participantName || ""));
    if (!player?.playerId) return [];
    const teams = new Map((Array.isArray(view.eligibleTeams) ? view.eligibleTeams : [])
      .map((team) => [String(team?.teamId || ""), String(team?.name || "")]));
    return view.picks
      .filter((pick) => String(pick?.playerId || "") === String(player.playerId))
      .sort((left, right) => Number(left?.pickNo || 0) - Number(right?.pickNo || 0))
      .map((pick) => teams.get(String(pick?.teamId || "")) || "")
      .filter(Boolean);
  }

  function matchStartValue(match) {
    return match?.starts_at || match?.startsAt || match?.metadata?.starts_at || match?.metadata?.scheduled_at || "";
  }

  function matchRound(match) {
    return String(match?.round || match?.round_key || "");
  }

  function matchNo(match) {
    return Number(match?.match_no || 0);
  }

  function matchTeams(match) {
    return [
      String(match?.team_a_id || match?.team1_id || ""),
      String(match?.team_b_id || match?.team2_id || ""),
    ].filter(Boolean);
  }

  function matchCompleted(match) {
    return ["completed", "final"].includes(String(match?.status || ""));
  }

  function japanDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function japanTimeLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  }

  function todayCandidatesForTeams(teamNames, event, now = Date.now()) {
    const teamSet = new Set((Array.isArray(teamNames) ? teamNames : []).map(normalizeTeamName).filter(Boolean));
    if (!teamSet.size) return [];
    const todayKey = japanDateKey(now);
    const matches = Array.isArray(event?.results?.matches) ? event.results.matches : [];
    const rows = [];
    matches.forEach((match) => {
      const startsAt = matchStartValue(match);
      if (!startsAt || japanDateKey(startsAt) !== todayKey) return;
      matchTeams(match).forEach((team) => {
        if (!teamSet.has(team)) return;
        rows.push({ team, match, startsAt, completed: matchCompleted(match) });
      });
    });
    const seen = new Set();
    return rows
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt)
        || matchNo(left.match) - matchNo(right.match)
        || left.team.localeCompare(right.team, "ja"))
      .filter((row) => {
        const key = `${matchRound(row.match)}|${matchNo(row.match)}|${row.team}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function phase2GuardCandidate(view, participantName, event, now = Date.now()) {
    const teamSet = new Set(phase2ParticipantTeams(view, participantName));
    if (!teamSet.size) return null;
    const matches = Array.isArray(event?.results?.matches) ? event.results.matches : [];
    const candidates = matches
      .filter((match) => !matchCompleted(match))
      .flatMap((match) => matchTeams(match)
        .filter((team) => teamSet.has(team))
        .map((team) => ({ team, match, startsAt: matchStartValue(match) })))
      .sort((left, right) => {
        const leftTime = Date.parse(left.startsAt || "");
        const rightTime = Date.parse(right.startsAt || "");
        const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
        const safeRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
        return safeLeft - safeRight || matchNo(left.match) - matchNo(right.match);
      });
    if (!candidates.length) return null;
    const todayKey = japanDateKey(now);
    return candidates.find((item) => item.startsAt && japanDateKey(item.startsAt) === todayKey) || candidates[0];
  }

  function guardSignature(view, participantName, event, now = Date.now()) {
    const candidate = phase2GuardCandidate(view, participantName, event, now);
    if (!candidate) return "";
    return [
      participantName,
      String(view?.eventId || ""),
      candidate.team,
      matchRound(candidate.match),
      matchNo(candidate.match),
      candidate.startsAt,
    ].join("|");
  }

  function phaseRowsMarkup(label, rows) {
    const content = rows.length
      ? rows.map((row) => `
          <div class="home-today-phase-row">
            <span class="home-today-phase-time">${escapeHtml(japanTimeLabel(row.startsAt))}</span>
            <strong>${escapeHtml(row.team)}</strong>
            <small>${row.completed ? "終了" : escapeHtml(`${matchRound(row.match)}-${matchNo(row.match)}`)}</small>
          </div>`).join("")
      : '<span class="home-today-phase-empty">本日の試合なし</span>';
    return `
      <section class="home-today-phase-block">
        <h4>${escapeHtml(label)}</h4>
        <div class="home-today-phase-list">${content}</div>
      </section>`;
  }

  function todaysYosoMarkup({ eventName, phase1Rows, phase2Rows }) {
    return `
      <h3>◉ 本日のYOSO</h3>
      <span class="home-today-event">${escapeHtml(eventName || "夏の甲子園2026 YOSO")}</span>
      <div class="home-today-phases">
        ${phaseRowsMarkup("フェーズ1", phase1Rows || [])}
        ${phaseRowsMarkup("フェーズ2", phase2Rows || [])}
      </div>`;
  }

  function installStyles(root) {
    if (root.document.getElementById(STYLE_ID)) return;
    const style = root.document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #home .home-today-phases { display: grid; gap: 12px; margin-top: 14px; }
      #home .home-today-phase-block { display: grid; gap: 7px; }
      #home .home-today-phase-block h4 { margin: 0; color: var(--muted); font-size: 12px; font-weight: 900; }
      #home .home-today-phase-list { display: grid; gap: 6px; }
      #home .home-today-phase-row {
        display: grid;
        grid-template-columns: 52px minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        padding: 8px 10px;
        border: 1px solid rgba(238, 232, 224, .10);
        border-radius: 11px;
        background: rgba(14, 13, 17, .20);
      }
      #home .home-today-phase-time { color: var(--soap-pink); font-size: 12px; font-weight: 950; }
      #home .home-today-phase-row strong { min-width: 0; font-size: 14px; line-height: 1.25; }
      #home .home-today-phase-row small { color: var(--muted); font-size: 10px; font-weight: 800; white-space: nowrap; }
      #home .home-today-phase-empty { color: var(--muted); font-size: 12px; font-weight: 750; }
    `;
    root.document.head.appendChild(style);
  }

  function resolveEvent(view) {
    const eventId = String(view?.eventId || "");
    const eventPool = [
      ...(typeof state === "object" && state?.event ? [state.event] : []),
      ...(typeof state === "object" && Array.isArray(state?.events) ? state.events : []),
    ];
    return eventPool.find((item) => String(item?.id || "") === eventId) || eventPool[0] || null;
  }

  function patchCard(root, now = Date.now()) {
    const view = typeof koshienPhase2DraftView === "object" && koshienPhase2DraftView
      ? koshienPhase2DraftView
      : null;
    if (!view?.available || !["locked", "completed"].includes(String(view.status || ""))
      || !Array.isArray(view.picks) || view.picks.length !== 16) return false;
    const participant = typeof currentParticipantName === "function" ? currentParticipantName() : "";
    const event = resolveEvent(view);
    if (!participant || !event) return false;

    const phase1Rows = todayCandidatesForTeams(phase1ParticipantTeams(event, participant), event, now);
    const phase2Rows = todayCandidatesForTeams(phase2ParticipantTeams(view, participant), event, now);
    const card = root.document.querySelector("#home .home-today-card");
    if (!card) return false;

    const ownSignature = [
      participant,
      String(view.eventId || ""),
      ...phase1Rows.map((row) => `p1:${row.team}:${row.startsAt}:${row.completed}`),
      ...phase2Rows.map((row) => `p2:${row.team}:${row.startsAt}:${row.completed}`),
    ].join("|");
    if (card.dataset.todayAllPhasesSignature === ownSignature) {
      const oldGuard = guardSignature(view, participant, event, now);
      if (oldGuard) card.dataset.phase2TodaySignature = oldGuard;
      return true;
    }

    card.innerHTML = todaysYosoMarkup({
      eventName: event?.name || "夏の甲子園2026 YOSO",
      phase1Rows,
      phase2Rows,
    });
    card.dataset.todayAllPhasesSignature = ownSignature;
    const oldGuard = guardSignature(view, participant, event, now);
    if (oldGuard) card.dataset.phase2TodaySignature = oldGuard;
    return true;
  }

  function installBrowser(root) {
    if (!root?.document || root[INSTALL_FLAG]) return false;
    root[INSTALL_FLAG] = true;
    installStyles(root);
    patchCard(root);

    if (typeof renderDashboard === "function") {
      const originalRenderDashboard = renderDashboard;
      renderDashboard = function renderDashboardWithAllTodayYoso() {
        const result = originalRenderDashboard.apply(this, arguments);
        patchCard(root);
        return result;
      };
    }

    const home = root.document.querySelector("#home");
    if (home && typeof root.MutationObserver === "function") {
      const observer = new root.MutationObserver(() => patchCard(root));
      observer.observe(home, { childList: true, subtree: true });
    }

    root.document.addEventListener("visibilitychange", () => {
      if (!root.document.hidden) patchCard(root);
    });
    root.addEventListener("pageshow", () => patchCard(root));
    return true;
  }

  return Object.freeze({
    phase1ParticipantTeams,
    phase2ParticipantTeams,
    todayCandidatesForTeams,
    phase2GuardCandidate,
    guardSignature,
    todaysYosoMarkup,
    patchCard,
    installBrowser,
  });
});
