(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoHomeDashboardPolish = api;

  if (!root || typeof root.setTimeout !== "function" || !root.document) return;

  function waitForDashboard() {
    if (!root.__yosoHomeDashboardV2Installed) {
      root.setTimeout(waitForDashboard, 40);
      return;
    }
    api.installBrowser(root);
  }

  waitForDashboard();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STYLE_ID = "yoso-home-dashboard-polish-style";
  const INSTALL_FLAG = "__yosoHomeDashboardPolishInstalled";
  const REFRESH_COOLDOWN_MS = 2000;
  const PHASE2_TARGET = Object.freeze({
    R3: { label: "ベスト8進出", points: 20 },
    QF: { label: "ベスト4進出", points: 40 },
    SF: { label: "決勝進出", points: 60 },
    F: { label: "優勝", points: 100 },
  });
  let onlineHomeRefreshPromise = null;
  let lastOnlineHomeRefreshAt = 0;

  function stripSectionNumberText(value) {
    return String(value ?? "").replace(/^[1-5][\s\u3000]+/, "");
  }

  function installStyles(root) {
    if (root.document.getElementById(STYLE_ID)) return;
    const style = root.document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .topbar-quick-stat { display: none; }
      .topbar:not(.is-home-page) .topbar-quick-stat { display: none !important; }
      .topbar.is-home-page {
        min-height: 92px;
        padding: 14px 16px;
        justify-content: flex-end;
      }
      .topbar.is-home-page .brand-home,
      .topbar.is-home-page #accountName { display: none !important; }
      .topbar.is-home-page .account-chip.is-dashboard-header {
        width: 100%;
        margin-left: auto;
        display: grid;
        grid-template-columns: minmax(72px, .72fr) minmax(118px, 1.18fr) auto;
        align-items: stretch;
        gap: 7px;
        padding: 7px;
        border-radius: 18px;
      }
      .topbar.is-home-page .topbar-quick-stat { display: grid; }
      .topbar .topbar-quick-stat {
        min-width: 0;
        display: grid;
        align-content: center;
        gap: 2px;
        padding: 7px 9px;
        border: 1px solid rgba(238, 232, 224, .11);
        border-radius: 12px;
        background: rgba(12, 12, 16, .28);
      }
      .topbar .topbar-quick-stat span {
        padding: 0;
        color: var(--muted);
        font-size: 9px;
        font-weight: 800;
        line-height: 1.2;
        white-space: nowrap;
      }
      .topbar .topbar-quick-stat strong {
        min-width: 0;
        color: var(--ink);
        font-size: 16px;
        font-weight: 950;
        line-height: 1.1;
        white-space: nowrap;
      }
      .topbar .topbar-quick-stat.is-urgent strong { color: var(--soap-pink); }
      .topbar #logoutButton {
        align-self: stretch;
        min-height: 48px;
        padding-inline: 12px;
        white-space: nowrap;
      }

      #home .home-global-grid {
        grid-template-columns: minmax(0, 1fr) !important;
      }
      #home .home-user-card,
      #home .home-today-card {
        min-height: 0;
      }
      #home .home-user-card {
        padding-block: 20px;
      }
      #home .home-event-inner h4 {
        white-space: nowrap;
        font-size: 13px;
      }
      #home .home-event-score {
        display: inline-flex !important;
        align-items: baseline;
        gap: 4px;
        max-width: 100%;
        white-space: nowrap;
        font-size: clamp(30px, 8vw, 40px);
      }
      #home .home-event-score small {
        flex: 0 0 auto;
        font-size: .46em;
        line-height: 1;
      }
      #home .home-event-rank-meta,
      #home .home-event-gap {
        white-space: nowrap;
      }
      #home .home-match-id { display: none !important; }
      #home .home-match-row {
        grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) !important;
        gap: 8px !important;
      }
      #home .home-match-team strong {
        overflow: visible !important;
        text-overflow: clip !important;
        white-space: normal !important;
        overflow-wrap: anywhere;
        line-height: 1.28;
      }

      /* Strong limited-time zombie takeover. The class is only present while the zombie round is open. */
      body.is-zombie-mypage {
        --bg: #050705;
        --surface: #0b0e0a;
        --surface-2: #151019;
        --surface-3: #090c08;
        --muted: #c4c7b9;
        --line: rgba(145, 174, 43, .58);
        --line-strong: rgba(205, 229, 78, .72);
        --smoke: rgba(109, 48, 126, .30);
        --smoke-soft: rgba(122, 150, 40, .22);
        background:
          radial-gradient(circle at 10% 14%, rgba(127, 158, 33, .36), transparent 29%),
          radial-gradient(circle at 90% 20%, rgba(106, 35, 132, .42), transparent 31%),
          radial-gradient(circle at 22% 74%, rgba(83, 108, 24, .27), transparent 31%),
          radial-gradient(circle at 82% 80%, rgba(90, 37, 112, .31), transparent 34%),
          linear-gradient(180deg, #050605 0%, #0a0710 48%, #070a06 100%) !important;
      }
      body.is-zombie-mypage::before {
        opacity: .76 !important;
        background-image:
          repeating-linear-gradient(132deg, transparent 0 41px, rgba(172, 206, 56, .10) 42px 43px, transparent 44px 83px),
          repeating-linear-gradient(47deg, transparent 0 67px, rgba(119, 50, 139, .10) 68px 70px, transparent 71px 129px),
          radial-gradient(circle at 18% 26%, rgba(184, 217, 66, .15), transparent 2px),
          radial-gradient(circle at 82% 44%, rgba(142, 59, 165, .15), transparent 2px) !important;
        background-size: auto, auto, 46px 46px, 58px 58px !important;
        mix-blend-mode: screen !important;
      }
      body.is-zombie-mypage::after {
        inset: -12% !important;
        opacity: .82 !important;
        filter: blur(24px) saturate(1.25) !important;
        background:
          radial-gradient(ellipse at 16% 22%, rgba(144, 178, 41, .28), transparent 29%),
          radial-gradient(ellipse at 83% 27%, rgba(109, 43, 132, .34), transparent 31%),
          radial-gradient(ellipse at 52% 72%, rgba(72, 91, 29, .23), transparent 35%) !important;
      }
      body.is-zombie-mypage .app-shell {
        background:
          radial-gradient(circle at 5% 13%, rgba(151, 184, 45, .25), transparent 25%),
          radial-gradient(circle at 95% 27%, rgba(112, 40, 136, .31), transparent 29%),
          linear-gradient(180deg, rgba(4, 6, 4, .94), rgba(10, 7, 12, .96) 55%, rgba(5, 9, 5, .97)) !important;
      }
      body.is-zombie-mypage .topbar.is-home-page,
      body.is-zombie-mypage .topbar.is-home-page .account-chip.is-dashboard-header,
      body.is-zombie-mypage .topbar.is-home-page .topbar-quick-stat,
      body.is-zombie-mypage .topbar.is-home-page #logoutButton {
        border-color: rgba(151, 187, 48, .58) !important;
        background:
          radial-gradient(circle at 86% 18%, rgba(115, 43, 139, .35), transparent 34%),
          radial-gradient(circle at 8% 86%, rgba(120, 154, 37, .28), transparent 38%),
          linear-gradient(145deg, rgba(13, 16, 11, .97), rgba(20, 10, 23, .96)) !important;
        box-shadow:
          inset 0 0 0 1px rgba(219, 116, 166, .13),
          0 0 24px rgba(112, 145, 35, .12) !important;
      }
      #home.is-zombie-period {
        background:
          radial-gradient(circle at 7% 12%, rgba(150, 187, 43, .18), transparent 27%),
          radial-gradient(circle at 92% 31%, rgba(107, 35, 133, .23), transparent 31%),
          linear-gradient(180deg, rgba(4, 6, 4, .56), rgba(10, 7, 12, .66)) !important;
      }
      #home.is-zombie-period .home-global-card,
      #home.is-zombie-period .home-user-card,
      #home.is-zombie-period .home-today-card,
      #home.is-zombie-period .home-event-dashboard,
      #home.is-zombie-period .home-event-inner,
      #home.is-zombie-period .home-event-card,
      #home.is-zombie-period .home-event-stat,
      #home.is-zombie-period .home-match-row,
      #home.is-zombie-period .home-virtual-link,
      #home.is-zombie-period .entry-block,
      #home.is-zombie-period .koshien-phase2-public-player,
      #home.is-zombie-period .koshien-phase2-public-pick {
        border-color: rgba(150, 184, 46, .62) !important;
        background:
          repeating-linear-gradient(136deg, transparent 0 51px, rgba(166, 203, 52, .055) 52px 53px, transparent 54px 103px),
          radial-gradient(circle at 96% 7%, rgba(111, 40, 135, .36), transparent 36%),
          radial-gradient(circle at 5% 96%, rgba(119, 151, 38, .31), transparent 39%),
          linear-gradient(145deg, rgba(9, 12, 8, .97), rgba(22, 10, 25, .95) 58%, rgba(8, 13, 7, .96)) !important;
        box-shadow:
          inset 0 0 0 1px rgba(226, 104, 165, .11),
          inset 0 -18px 40px rgba(94, 117, 29, .10),
          0 0 0 1px rgba(101, 44, 119, .18),
          0 12px 32px rgba(0, 0, 0, .42) !important;
      }
      #home.is-zombie-period .home-user-card,
      #home.is-zombie-period .home-today-card,
      #home.is-zombie-period .home-event-dashboard.is-koshien,
      #home.is-zombie-period .zombie-home-banner {
        border-color: rgba(187, 216, 66, .72) !important;
        box-shadow:
          inset 0 0 0 1px rgba(127, 51, 148, .34),
          0 0 26px rgba(128, 159, 39, .15),
          0 18px 40px rgba(0, 0, 0, .44) !important;
      }
      #home.is-zombie-period .home-user-card::after,
      #home.is-zombie-period .home-today-card::after,
      #home.is-zombie-period .home-event-dashboard.is-koshien::after {
        opacity: .95 !important;
        background:
          repeating-linear-gradient(128deg, transparent 0 46px, rgba(194, 226, 67, .09) 47px 49px, transparent 50px 92px),
          repeating-linear-gradient(35deg, transparent 0 72px, rgba(127, 50, 149, .10) 73px 75px, transparent 76px 133px),
          radial-gradient(circle at 87% 12%, rgba(118, 44, 140, .21), transparent 34%),
          radial-gradient(circle at 9% 89%, rgba(137, 171, 42, .20), transparent 35%) !important;
      }
      #home.is-zombie-period .home-club-name,
      #home.is-zombie-period .home-event-head strong,
      #home.is-zombie-period .home-today-card h3,
      #home.is-zombie-period .home-event-score,
      #home.is-zombie-period .koshien-phase2-public-head h3,
      #home.is-zombie-period .koshien-phase2-public-avatar,
      #home.is-zombie-period .koshien-phase2-public-pick b {
        color: #f0a8be !important;
        text-shadow:
          0 0 8px rgba(240, 168, 190, .30),
          0 0 16px rgba(167, 202, 61, .42),
          0 0 24px rgba(111, 44, 132, .36) !important;
      }
      #home.is-zombie-period .zombie-home-banner {
        min-height: 132px !important;
        background:
          repeating-linear-gradient(137deg, transparent 0 48px, rgba(188, 221, 65, .08) 49px 51px, transparent 52px 97px),
          radial-gradient(circle at 16% 54%, rgba(147, 187, 43, .44), transparent 34%),
          radial-gradient(circle at 86% 42%, rgba(119, 45, 145, .48), transparent 35%),
          linear-gradient(112deg, rgba(40, 10, 35, .98), rgba(8, 15, 7, .98) 50%, rgba(31, 9, 37, .98)) !important;
      }
      #home.is-zombie-period .zombie-home-banner strong {
        color: transparent !important;
        background: linear-gradient(90deg, #f06ba9 0%, #e89ab9 28%, #b5d956 56%, #8aa936 72%, #a44fc0 100%);
        -webkit-background-clip: text;
        background-clip: text;
        filter: drop-shadow(0 0 9px rgba(173, 210, 64, .35));
        font-size: clamp(25px, 7vw, 34px) !important;
        letter-spacing: .015em !important;
      }
      body.is-zombie-mypage .bottom-nav {
        border-color: rgba(151, 186, 46, .62) !important;
        background:
          radial-gradient(circle at 12% 100%, rgba(135, 170, 39, .31), transparent 31%),
          radial-gradient(circle at 85% 0%, rgba(111, 40, 134, .35), transparent 34%),
          linear-gradient(180deg, rgba(8, 10, 8, .97), rgba(16, 8, 18, .98)) !important;
        box-shadow:
          inset 0 1px 0 rgba(228, 111, 168, .12),
          0 -10px 30px rgba(91, 119, 30, .14) !important;
      }
      body.is-zombie-mypage .bottom-nav a[data-nav-page="home"] {
        color: #f58db7 !important;
        border-color: rgba(177, 210, 59, .48) !important;
        background:
          radial-gradient(circle at 15% 82%, rgba(147, 184, 43, .38), transparent 46%),
          radial-gradient(circle at 84% 18%, rgba(117, 44, 140, .40), transparent 48%),
          linear-gradient(180deg, rgba(80, 18, 61, .48), rgba(15, 17, 10, .88)) !important;
        box-shadow:
          inset 0 0 0 1px rgba(239, 109, 166, .17),
          0 0 20px rgba(130, 161, 38, .16) !important;
      }

      @media (max-width: 380px) {
        .topbar.is-home-page {
          padding-inline: 10px;
        }
        .topbar.is-home-page .account-chip.is-dashboard-header {
          grid-template-columns: minmax(62px, .66fr) minmax(104px, 1.08fr) auto;
          gap: 5px;
          padding: 6px;
        }
        .topbar.is-home-page .topbar-quick-stat {
          padding-inline: 7px;
        }
        .topbar.is-home-page .topbar-quick-stat span { font-size: 8px; }
        .topbar.is-home-page .topbar-quick-stat strong { font-size: 14px; }
        .topbar.is-home-page #logoutButton { padding-inline: 9px; }
        #home .home-event-inner { padding-inline: 11px; }
        #home .home-event-inner h4 { font-size: 12px; }
      }
    `;
    root.document.head.appendChild(style);
  }

  function syncHeaderPageState(root) {
    const pageId = typeof currentPageId === "function" ? currentPageId() : "home";
    root.document.querySelector(".topbar")?.classList.toggle("is-home-page", pageId === "home");
  }

  function ensureHeader(root) {
    syncHeaderPageState(root);
    const chip = root.document.querySelector("#accountChip");
    const logout = root.document.querySelector("#logoutButton");
    if (!chip || !logout) return;
    chip.classList.add("is-dashboard-header");

    let stats = chip.querySelector("[data-yoso-header-stats]");
    if (!stats) {
      stats = root.document.createElement("div");
      stats.className = "topbar-quick-stat is-urgent";
      stats.dataset.yosoHeaderStats = "missing";
      stats.innerHTML = '<span>未入力大会</span><strong id="headerMissingTournamentCount">0</strong>';
      chip.insertBefore(stats, logout);

      const scoreStats = root.document.createElement("div");
      scoreStats.className = "topbar-quick-stat";
      scoreStats.dataset.yosoHeaderStats = "score";
      scoreStats.innerHTML = '<span>今月 / 全期間 PT</span><strong><span id="headerMonthScore">0</span> / <span id="headerTotalScore">0</span></strong>';
      chip.insertBefore(scoreStats, logout);
    }
  }

  function updateHeaderStats(root) {
    const missingEl = root.document.querySelector("#headerMissingTournamentCount");
    const monthEl = root.document.querySelector("#headerMonthScore");
    const totalEl = root.document.querySelector("#headerTotalScore");
    if (!missingEl || !monthEl || !totalEl) return;

    let missingTournamentCount = 0;
    let myScore = 0;
    try {
      const participant = typeof currentParticipantName === "function" ? currentParticipantName() : "";
      const openEvents = typeof eventsByStatus === "function" ? eventsByStatus("open") : [];
      if (typeof missingPredictionCountForEvent === "function") {
        missingTournamentCount = openEvents.filter((event) => missingPredictionCountForEvent(event, participant) > 0).length;
      }
      if (typeof calculateScores === "function") {
        const scores = calculateScores() || [];
        myScore = Number(scores.find((row) => row?.name === participant)?.score || 0);
      }
    } catch (_) {
      missingTournamentCount = 0;
      myScore = 0;
    }

    const scoreText = typeof formatScore === "function" ? formatScore(myScore) : String(Math.round(myScore * 100) / 100);
    missingEl.textContent = String(missingTournamentCount);
    monthEl.textContent = scoreText;
    totalEl.textContent = scoreText;
  }

  function isVisibleHome(root) {
    if (!root?.document || root.document.hidden) return false;
    const pageId = typeof currentPageId === "function"
      ? currentPageId()
      : String(root.location?.hash || "#home").replace(/^#/, "") || "home";
    return pageId === "home";
  }

  function refreshOnlineHome(root, { force = false } = {}) {
    if (!isVisibleHome(root)) return Promise.resolve(false);
    const loader = typeof root.loadKoshienOnlineState === "function"
      ? root.loadKoshienOnlineState
      : (typeof loadKoshienOnlineState === "function" ? loadKoshienOnlineState : null);
    if (!loader) return Promise.resolve(false);

    const now = Date.now();
    if (onlineHomeRefreshPromise) return onlineHomeRefreshPromise;
    if (!force && now - lastOnlineHomeRefreshAt < REFRESH_COOLDOWN_MS) return Promise.resolve(false);
    lastOnlineHomeRefreshAt = now;
    onlineHomeRefreshPromise = Promise.resolve(loader({ force: true }))
      .then(() => true)
      .catch((error) => {
        root.console?.warn?.("My Page online refresh failed", error);
        return false;
      })
      .finally(() => {
        onlineHomeRefreshPromise = null;
      });
    return onlineHomeRefreshPromise;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function phase2MatchStartValue(match) {
    return match?.starts_at || match?.startsAt || match?.metadata?.starts_at || match?.metadata?.scheduled_at || "";
  }

  function phase2MatchRound(match) {
    return String(match?.round || match?.round_key || "");
  }

  function phase2MatchNo(match) {
    return Number(match?.match_no || 0);
  }

  function phase2MatchTeams(match) {
    return [String(match?.team_a_id || match?.team1_id || ""), String(match?.team_b_id || match?.team2_id || "")];
  }

  function phase2MatchCompleted(match) {
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

  function japanMonthDayTimeLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.month}/${map.day} ${map.hour}:${map.minute}`;
  }

  function phase2TodayCandidate({ view, participantName, event, now = Date.now() } = {}) {
    const teamNames = phase2ParticipantTeams(view, participantName);
    if (!teamNames.length) return null;
    const teamSet = new Set(teamNames);
    const matches = Array.isArray(event?.results?.matches) ? event.results.matches : [];
    const candidates = matches
      .filter((match) => !phase2MatchCompleted(match))
      .flatMap((match) => phase2MatchTeams(match)
        .filter((team) => teamSet.has(team))
        .map((team) => ({ team, match, startsAt: phase2MatchStartValue(match) })))
      .sort((left, right) => {
        const leftTime = Date.parse(left.startsAt || "");
        const rightTime = Date.parse(right.startsAt || "");
        const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
        const safeRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
        return safeLeft - safeRight || phase2MatchNo(left.match) - phase2MatchNo(right.match);
      });
    if (!candidates.length) return null;
    const todayKey = japanDateKey(now);
    return candidates.find((item) => item.startsAt && japanDateKey(item.startsAt) === todayKey) || candidates[0];
  }

  function phase2TodayCardMarkup(candidate, eventName, now = Date.now()) {
    if (!candidate) return "";
    const startsAt = candidate.startsAt;
    const isToday = Boolean(startsAt && japanDateKey(startsAt) === japanDateKey(now));
    const round = phase2MatchRound(candidate.match);
    const target = PHASE2_TARGET[round] || null;
    const schedule = startsAt
      ? (isToday ? `本日 ${japanTimeLabel(startsAt)}` : japanMonthDayTimeLabel(startsAt))
      : `${round}-${phase2MatchNo(candidate.match)}`;
    const main = isToday
      ? `あなたのフェーズ2指名校「${escapeHtml(candidate.team)}」が${escapeHtml(schedule)}に登場`
      : `あなたのフェーズ2指名校「${escapeHtml(candidate.team)}」の次戦は ${escapeHtml(schedule)}`;
    const impact = target
      ? `勝利すると <b>${escapeHtml(target.label)}</b>・フェーズ2暫定 <b>${target.points}pt</b>`
      : "フェーズ2指名校の次戦情報を確認できます。";
    return `
      <h3>◉ 今日のYOSO</h3>
      <span class="home-today-event">${escapeHtml(eventName || "夏の甲子園2026 YOSO")}</span>
      <strong>${main}</strong>
      <span class="home-today-impact">${impact}</span>`;
  }

  function patchPhase2TodayCard(root) {
    const view = typeof koshienPhase2DraftView === "object" && koshienPhase2DraftView
      ? koshienPhase2DraftView
      : null;
    if (!view?.available || !["locked", "completed"].includes(String(view.status || ""))
      || !Array.isArray(view.picks) || view.picks.length !== 16) return false;
    const participant = typeof currentParticipantName === "function" ? currentParticipantName() : "";
    const eventId = String(view.eventId || "");
    const eventPool = [
      ...(typeof state === "object" && state?.event ? [state.event] : []),
      ...(typeof state === "object" && Array.isArray(state?.events) ? state.events : []),
    ];
    const event = eventPool.find((item) => String(item?.id || "") === eventId) || eventPool[0] || null;
    const candidate = phase2TodayCandidate({ view, participantName: participant, event });
    if (!candidate) return false;
    const card = root.document.querySelector("#home .home-today-card");
    if (!card) return false;
    const signature = [participant, eventId, candidate.team, phase2MatchRound(candidate.match), phase2MatchNo(candidate.match), candidate.startsAt].join("|");
    if (card.dataset.phase2TodaySignature === signature) return true;
    card.innerHTML = phase2TodayCardMarkup(candidate, event?.name || "夏の甲子園2026 YOSO");
    card.dataset.phase2TodaySignature = signature;
    return true;
  }

  function polishHome(root) {
    root.document.querySelectorAll("#home .home-event-inner h4, #home .home-virtual-link strong").forEach((node) => {
      const next = stripSectionNumberText(node.textContent);
      if (node.textContent !== next) node.textContent = next;
    });
  }

  function installBrowser(root) {
    if (!root?.document || root[INSTALL_FLAG]) return false;
    root[INSTALL_FLAG] = true;
    installStyles(root);
    ensureHeader(root);
    polishHome(root);
    patchPhase2TodayCard(root);
    updateHeaderStats(root);

    if (typeof renderDashboard === "function") {
      const originalRenderDashboard = renderDashboard;
      renderDashboard = function renderDashboardWithHomePolish() {
        const result = originalRenderDashboard.apply(this, arguments);
        ensureHeader(root);
        polishHome(root);
        patchPhase2TodayCard(root);
        updateHeaderStats(root);
        return result;
      };
    }
    if (typeof renderPage === "function") {
      const originalRenderPage = renderPage;
      renderPage = function renderPageWithHeaderState() {
        const result = originalRenderPage.apply(this, arguments);
        syncHeaderPageState(root);
        return result;
      };
    }
    root.addEventListener("hashchange", () => root.setTimeout(() => {
      syncHeaderPageState(root);
      refreshOnlineHome(root);
    }, 0));

    const home = root.document.querySelector("#home");
    if (home && typeof root.MutationObserver === "function") {
      const observer = new root.MutationObserver(() => {
        polishHome(root);
        patchPhase2TodayCard(root);
      });
      observer.observe(home, { childList: true, subtree: true });
    }

    root.document.addEventListener("visibilitychange", () => {
      if (!root.document.hidden) {
        updateHeaderStats(root);
        patchPhase2TodayCard(root);
        refreshOnlineHome(root);
      }
    });
    root.addEventListener("pageshow", () => refreshOnlineHome(root));
    root.setTimeout(() => refreshOnlineHome(root), 0);
    return true;
  }

  return Object.freeze({
    stripSectionNumberText,
    refreshOnlineHome,
    phase2ParticipantTeams,
    phase2TodayCandidate,
    phase2TodayCardMarkup,
    patchPhase2TodayCard,
    installBrowser,
  });
});