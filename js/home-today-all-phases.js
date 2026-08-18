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
  const START_TIME_CACHE_TTL_MS = 5 * 60 * 1000;
  const startTimeCacheByEvent = new Map();
  const startTimeLoadByEvent = new Map();

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

  function startTimeKey(round, number) {
    return `${String(round || "")}:${Number(number || 0)}`;
  }

  function eventWithStartTimes(event, rows = []) {
    const matches = Array.isArray(event?.results?.matches) ? event.results.matches : [];
    if (!matches.length || !Array.isArray(rows) || !rows.length) return event;
    const startTimes = new Map(rows
      .filter((row) => row?.starts_at)
      .map((row) => [startTimeKey(row.round_key || row.round, row.match_no), String(row.starts_at)]));
    if (!startTimes.size) return event;
    const enrichedMatches = matches.map((match) => {
      const startsAt = startTimes.get(startTimeKey(matchRound(match), matchNo(match)));
      if (!startsAt) return match;
      return {
        ...match,
        starts_at: startsAt,
        metadata: {
          ...(match?.metadata && typeof match.metadata === "object" ? match.metadata : {}),
          starts_at: startsAt,
        },
      };
    });
    return {
      ...event,
      results: {
        ...(event?.results && typeof event.results === "object" ? event.results : {}),
        matches: enrichedMatches,
      },
    };
  }

  function cachedStartTimeRows(eventId, now = Date.now()) {
    const cached = startTimeCacheByEvent.get(String(eventId || ""));
    if (!cached || now - cached.loadedAt > START_TIME_CACHE_TTL_MS) return [];
    return cached.rows;
  }

  async function loadStartTimeRows(root, eventId, { force = false } = {}) {
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId) return [];
    const cached = startTimeCacheByEvent.get(normalizedEventId);
    if (!force && cached && Date.now() - cached.loadedAt <= START_TIME_CACHE_TTL_MS) return cached.rows;
    if (startTimeLoadByEvent.has(normalizedEventId)) return startTimeLoadByEvent.get(normalizedEventId);

    const promise = (async () => {
      const supabase = await root.YosoSupabase?.client?.();
      if (!supabase) return cached?.rows || [];
      const { data, error } = await supabase
        .from("matches")
        .select("round_key, match_no, starts_at")
        .eq("event_id", normalizedEventId);
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []).filter((row) => row?.starts_at);
      startTimeCacheByEvent.set(normalizedEventId, { loadedAt: Date.now(), rows });
      return rows;
    })().finally(() => {
      startTimeLoadByEvent.delete(normalizedEventId);
    });
    startTimeLoadByEvent.set(normalizedEventId, promise);
    return promise;
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

  function tournamentRestDay(event, now = Date.now()) {
    const matches = Array.isArray(event?.results?.matches) ? event.results.matches : [];
    const todayKey = japanDateKey(now);
    const hasTodayMatch = matches.some((match) => {
      const startsAt = matchStartValue(match);
      return startsAt && japanDateKey(startsAt) === todayKey;
    });
    if (hasTodayMatch) return false;
    return matches.some((match) => {
      const startMs = Date.parse(matchStartValue(match) || "");
      return !matchCompleted(match) && Number.isFinite(startMs) && startMs > now;
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

  function todaysYosoMarkup({ eventName, phase1Rows, phase2Rows, restDay = false }) {
    return `
      <h3>◉ 本日のYOSO</h3>
      <span class="home-today-event">${escapeHtml(eventName || "夏の甲子園2026 YOSO")}</span>
      ${restDay ? `
        <div class="home-today-rest-day">
          <strong>本日は休養日です</strong>
          <span>試合はありません。次戦に備えてお待ちください。</span>
        </div>` : `
        <div class="home-today-phases">
          ${phaseRowsMarkup("フェーズ1", phase1Rows || [])}
          ${phaseRowsMarkup("フェーズ2", phase2Rows || [])}
        </div>`}
    `;
  }

  function zombiePublicPredictions() {
    const view = typeof koshienLaterPhaseView === "object" && koshienLaterPhaseView ? koshienLaterPhaseView : null;
    if (!zombieRoundIsActive(view)) return [];
    const rows = view?.zombie?.public_predictions;
    return Array.isArray(rows) ? rows.filter((row) => row?.team_name) : [];
  }

  function zombieHeroMarkup(rows = [], eventName = "夏の甲子園2026 YOSO") {
    const lead = rows[0] || {};
    const leadSource = lead.display_name || "参加者";
    const infections = rows.map((row) => `
      <div class="home-zombie-public-row" data-zombie-team="${escapeHtml(row.team_name)}" data-zombie-source="${escapeHtml(row.display_name || "参加者")}">
        <span class="home-zombie-infection-label">🧟 ZOMBIE INFECTION</span>
        <span class="home-zombie-infection-copy">ゾンビウイルス感染中</span>
        <span class="home-zombie-team-label">感染校</span>
        <strong class="home-zombie-team-name">${escapeHtml(row.team_name)}</strong>
        <span class="home-zombie-source-label">感染源</span>
        <strong class="home-zombie-source-name">${escapeHtml(row.display_name || "参加者")}</strong>
        <p>準決勝敗退校に${escapeHtml(row.team_name)}を指定済み<br>準決勝結果でゾンビ効果が確定します</p>
      </div>`).join("");
    return `
      <div class="home-zombie-public-inner">
        <h3 class="home-zombie-hero-title">
          <span>${escapeHtml(leadSource)}</span>
          <strong>ゾンビモード発動</strong>
        </h3>
        <span class="home-zombie-event-name">${escapeHtml(eventName)}</span>
        ${infections}
      </div>`;
  }

  function zombiePublicSignature(rows = []) {
    return JSON.stringify(rows.map((row) => ({
      playerId: row.player_id || "",
      source: row.display_name || "",
      teamId: row.team_id || "",
      team: row.team_name || "",
      updatedAt: row.updated_at || row.created_at || "",
    })));
  }

  function zombieRoundIsActive(view) {
    return String(view?.rounds?.zombie?.status || "") === "open";
  }

  function syncZombieTheme(root, view) {
    const pageId = typeof currentPageId === "function"
      ? currentPageId()
      : String(root?.location?.hash || "#home").replace(/^#/, "") || "home";
    const active = zombieRoundIsActive(view) && pageId === "home";
    root?.document?.body?.classList?.toggle("is-zombie-mypage", active);
    const home = root?.document?.querySelector?.("#home");
    home?.classList?.toggle("is-zombie-period", active);
    home?.classList?.toggle("zombie-theme-active", active);
    return active;
  }

  function patchZombieStatus(root, rows = zombiePublicPredictions()) {
    const home = root?.document?.querySelector?.("#home");
    if (!home) return false;
    const grid = home.querySelector(".home-global-grid");
    const existing = home.querySelector("[data-zombie-public-status]");
    if (!rows.length || !grid) {
      if (existing) existing.remove();
      return false;
    }

    const laterView = typeof koshienLaterPhaseView === "object" && koshienLaterPhaseView ? koshienLaterPhaseView : null;
    const eventName = resolveEvent(laterView)?.name || "夏の甲子園2026 YOSO";
    const signature = `${eventName}|${zombiePublicSignature(rows)}`;
    if (existing?.dataset?.zombiePublicSignature === signature) return true;

    let status = existing;
    if (!status) {
      status = root.document.createElement("section");
      status.className = "home-zombie-public-status";
      status.dataset.zombiePublicStatus = "true";
      status.setAttribute("aria-label", "ゾンビモード感染状況");
      grid.prepend(status);
    }
    status.innerHTML = zombieHeroMarkup(rows, eventName);
    status.dataset.zombiePublicSignature = signature;
    status.dataset.zombieSource = rows.map((row) => row.display_name || "参加者").join(" / ");
    status.dataset.zombieTeam = rows.map((row) => row.team_name).join(" / ");
    return true;
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
      #home .home-today-rest-day {
        display: grid;
        gap: 4px;
        margin-top: 14px;
        padding: 13px 14px;
        border: 1px solid rgba(238, 232, 224, .12);
        border-radius: 13px;
        background: rgba(14, 13, 17, .24);
      }
      #home .home-today-rest-day strong { font-size: 15px; }
      #home .home-today-rest-day span { color: var(--muted); font-size: 12px; }
      body.is-zombie-mypage {
        --zombie-black: #050507;
        --zombie-surface: #111015;
        --zombie-green: #9dff38;
        --zombie-green-soft: #b6ff55;
        --zombie-pink: #ff4f9a;
        --zombie-purple: #70258f;
        --zombie-purple-bright: #ba4dff;
        --zombie-text: #f5f3f5;
        --zombie-muted: #c9c5cc;
        background:
          radial-gradient(circle at 10% 16%, rgba(157, 255, 56, .10), transparent 27%),
          radial-gradient(circle at 90% 28%, rgba(112, 37, 143, .22), transparent 31%),
          #050507 !important;
      }
      body.is-zombie-mypage .app-shell {
        background:
          radial-gradient(circle at 8% 16%, rgba(157, 255, 56, .12), transparent 26%),
          radial-gradient(circle at 92% 34%, rgba(112, 37, 143, .22), transparent 31%),
          radial-gradient(ellipse at 45% 78%, rgba(255, 79, 154, .055), transparent 35%),
          linear-gradient(180deg, rgba(5, 5, 7, .985), rgba(9, 9, 13, .99) 54%, rgba(5, 5, 7, .99)) !important;
      }
      body.is-zombie-mypage .topbar.is-home-page,
      body.is-zombie-mypage .topbar.is-home-page .account-chip.is-dashboard-header,
      body.is-zombie-mypage .topbar.is-home-page .topbar-quick-stat,
      body.is-zombie-mypage .topbar.is-home-page #logoutButton {
        border-color: rgba(157, 255, 56, .12) !important;
        background:
          radial-gradient(circle at 92% 10%, rgba(112, 37, 143, .18), transparent 36%),
          linear-gradient(150deg, rgba(12, 11, 15, .98), rgba(5, 5, 7, .99)) !important;
        box-shadow: inset 0 1px 0 rgba(255, 79, 154, .06), 0 10px 30px rgba(0, 0, 0, .30) !important;
      }
      #home.zombie-theme-active {
        position: relative;
        isolation: isolate;
        color: var(--zombie-text);
        background:
          radial-gradient(circle at 8% 14%, rgba(157, 255, 56, .055), transparent 27%),
          radial-gradient(circle at 92% 35%, rgba(112, 37, 143, .12), transparent 32%),
          linear-gradient(180deg, rgba(5, 5, 7, .92), rgba(9, 9, 13, .96)) !important;
      }
      #home.zombie-theme-active::before {
        content: "";
        position: fixed;
        inset: 88px 0 72px;
        z-index: -1;
        pointer-events: none;
        opacity: .8;
        background:
          linear-gradient(121deg, transparent 0 48%, rgba(157, 255, 56, .035) 49%, transparent 50%),
          linear-gradient(57deg, transparent 0 73%, rgba(186, 77, 255, .05) 74%, transparent 75%),
          radial-gradient(ellipse at 12% 20%, rgba(121, 232, 41, .15), transparent 28%),
          radial-gradient(ellipse at 88% 45%, rgba(73, 22, 95, .32), transparent 32%);
      }
      #home.zombie-theme-active .home-user-card,
      #home.zombie-theme-active .home-today-card,
      #home.zombie-theme-active .home-event-dashboard,
      #home.zombie-theme-active .home-event-inner,
      #home.zombie-theme-active .home-phase2-card,
      #home.zombie-theme-active .home-match-row,
      #home.zombie-theme-active .home-virtual-link,
      #home.zombie-theme-active .entry-block,
      #home.zombie-theme-active .koshien-phase2-public-player,
      #home.zombie-theme-active .koshien-phase2-public-pick {
        border-color: rgba(201, 197, 204, .13) !important;
        color: var(--zombie-text) !important;
        background:
          radial-gradient(circle at 92% 8%, rgba(112, 37, 143, .15), transparent 34%),
          radial-gradient(circle at 3% 96%, rgba(157, 255, 56, .07), transparent 37%),
          linear-gradient(150deg, rgba(17, 16, 21, .97), rgba(7, 7, 10, .98)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 255, 255, .035),
          0 16px 38px rgba(0, 0, 0, .36) !important;
      }
      #home.zombie-theme-active .home-user-card {
        border-color: rgba(255, 79, 154, .24) !important;
        background:
          linear-gradient(112deg, transparent 58%, rgba(157, 255, 56, .035) 59%, transparent 61%),
          radial-gradient(circle at 90% 12%, rgba(112, 37, 143, .18), transparent 36%),
          linear-gradient(150deg, rgba(14, 13, 18, .98), rgba(6, 6, 8, .99)) !important;
        box-shadow:
          inset 3px 0 0 rgba(255, 79, 154, .46),
          inset -1px 0 0 rgba(157, 255, 56, .15),
          0 14px 34px rgba(0, 0, 0, .38) !important;
      }
      #home.zombie-theme-active .home-user-card::after,
      #home.zombie-theme-active .home-today-card::after,
      #home.zombie-theme-active .home-event-dashboard.is-koshien::after {
        opacity: .4 !important;
        background:
          linear-gradient(126deg, transparent 0 64%, rgba(157, 255, 56, .08) 64.4%, transparent 65%),
          linear-gradient(33deg, transparent 0 79%, rgba(186, 77, 255, .1) 79.4%, transparent 80%) !important;
      }
      #home.zombie-theme-active .home-user-card .home-club-name,
      #home.zombie-theme-active .home-event-head strong,
      #home.zombie-theme-active .home-today-card h3,
      #home.zombie-theme-active .home-event-score {
        color: var(--zombie-pink) !important;
        text-shadow: 0 0 16px rgba(255, 79, 154, .22) !important;
      }
      #home.zombie-theme-active .home-today-card {
        border-color: rgba(112, 37, 143, .32) !important;
      }
      #home.zombie-theme-active .home-today-rest-day {
        border-color: rgba(157, 255, 56, .14);
        background: rgba(5, 5, 7, .58);
      }
      #home.zombie-theme-active .home-today-rest-day strong { color: var(--zombie-green-soft); }
      #home.zombie-theme-active .home-today-rest-day span,
      #home.zombie-theme-active .home-today-event,
      #home.zombie-theme-active .home-event-gap,
      #home.zombie-theme-active .home-milestone { color: var(--zombie-muted) !important; }
      #home.zombie-theme-active .home-event-dashboard.is-koshien {
        border-color: rgba(255, 79, 154, .22) !important;
        background:
          radial-gradient(circle at 96% 4%, rgba(112, 37, 143, .22), transparent 32%),
          radial-gradient(circle at 5% 98%, rgba(157, 255, 56, .06), transparent 40%),
          linear-gradient(155deg, rgba(13, 12, 17, .98), rgba(5, 5, 7, .99)) !important;
      }
      #home.zombie-theme-active .home-event-dashboard.is-koshien .status-label.open {
        border-color: rgba(157, 255, 56, .28);
        background: rgba(157, 255, 56, .08);
        color: var(--zombie-green-soft);
      }
      #home.zombie-theme-active .home-progress-fill {
        background: linear-gradient(90deg, var(--zombie-pink), var(--zombie-purple-bright), var(--zombie-green));
      }
      #home.zombie-theme-active .home-virtual-link {
        border-color: rgba(186, 77, 255, .24) !important;
      }
      #home .home-zombie-public-status {
        grid-column: 1 / -1;
        position: relative;
        min-height: 260px;
        overflow: hidden;
        padding: clamp(22px, 5vw, 34px);
        border: 1px solid rgba(157, 255, 56, .46);
        border-radius: 24px;
        color: var(--zombie-text);
        background:
          radial-gradient(ellipse at 8% 80%, rgba(157, 255, 56, .18), transparent 35%),
          radial-gradient(ellipse at 90% 18%, rgba(112, 37, 143, .46), transparent 38%),
          radial-gradient(circle at 68% 76%, rgba(255, 79, 154, .10), transparent 31%),
          linear-gradient(132deg, #050507 0%, #0d0811 45%, #08050b 100%);
        box-shadow:
          inset 0 0 0 1px rgba(255, 79, 154, .12),
          inset 0 -48px 90px rgba(73, 22, 95, .18),
          0 22px 56px rgba(0, 0, 0, .52),
          0 0 34px rgba(121, 232, 41, .09);
      }
      #home .home-zombie-public-status::before,
      #home .home-zombie-public-status::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      #home .home-zombie-public-status::before {
        opacity: .66;
        background:
          linear-gradient(117deg, transparent 0 54%, rgba(157, 255, 56, .15) 54.4%, transparent 55.1%),
          linear-gradient(46deg, transparent 0 69%, rgba(186, 77, 255, .18) 69.4%, transparent 70%),
          linear-gradient(153deg, transparent 0 81%, rgba(255, 79, 154, .10) 81.3%, transparent 82%);
      }
      #home .home-zombie-public-status::after {
        inset: auto -10% -42% 22%;
        height: 75%;
        filter: blur(22px);
        opacity: .48;
        background:
          radial-gradient(ellipse at 25% 50%, rgba(157, 255, 56, .20), transparent 36%),
          radial-gradient(ellipse at 72% 40%, rgba(112, 37, 143, .46), transparent 40%);
      }
      #home .home-zombie-public-inner { position: relative; z-index: 1; display: grid; gap: 10px; }
      #home .home-zombie-hero-title {
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 4px 10px;
        margin: 0;
        line-height: 1.03;
      }
      #home .home-zombie-hero-title > span {
        color: var(--zombie-pink);
        font-size: clamp(30px, 7vw, 45px);
        font-weight: 950;
        letter-spacing: -.045em;
        text-shadow: 0 0 24px rgba(255, 79, 154, .28);
      }
      #home .home-zombie-hero-title > strong {
        color: var(--zombie-green);
        font-size: clamp(22px, 5.6vw, 35px);
        font-weight: 950;
        letter-spacing: -.025em;
        text-shadow: 0 0 22px rgba(157, 255, 56, .26);
      }
      #home .home-zombie-event-name {
        color: var(--zombie-muted);
        font-size: 11px;
        font-weight: 850;
        letter-spacing: .08em;
      }
      #home .home-zombie-public-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 5px 18px;
        margin-top: 7px;
        padding: 17px 18px;
        border: 1px solid rgba(201, 197, 204, .12);
        border-left-color: rgba(157, 255, 56, .48);
        border-radius: 16px;
        background: linear-gradient(118deg, rgba(5, 5, 7, .80), rgba(17, 8, 21, .72));
        box-shadow: inset 3px 0 0 rgba(157, 255, 56, .22);
      }
      #home .home-zombie-infection-label {
        color: var(--zombie-green-soft);
        font-size: 11px;
        font-weight: 950;
        letter-spacing: .13em;
      }
      #home .home-zombie-infection-copy {
        color: var(--zombie-muted);
        font-size: 11px;
        font-weight: 850;
        text-align: right;
      }
      #home .home-zombie-team-label,
      #home .home-zombie-source-label {
        align-self: end;
        color: var(--zombie-muted);
        font-size: 10px;
        font-weight: 850;
      }
      #home .home-zombie-source-label { text-align: right; }
      #home .home-zombie-team-name {
        color: var(--zombie-green);
        font-size: clamp(34px, 9vw, 56px);
        font-weight: 950;
        letter-spacing: -.04em;
        line-height: 1;
        text-shadow: 0 0 28px rgba(157, 255, 56, .23);
      }
      #home .home-zombie-source-name {
        align-self: end;
        color: var(--zombie-pink);
        font-size: clamp(18px, 4.8vw, 27px);
        font-weight: 950;
        text-align: right;
        text-shadow: 0 0 18px rgba(255, 79, 154, .22);
      }
      #home .home-zombie-public-row p {
        grid-column: 1 / -1;
        margin: 7px 0 0;
        padding-top: 10px;
        border-top: 1px solid rgba(201, 197, 204, .10);
        color: var(--zombie-muted);
        font-size: 12px;
        font-weight: 750;
        line-height: 1.6;
      }
      body.is-zombie-mypage .bottom-nav {
        border-color: rgba(157, 255, 56, .20) !important;
        background:
          radial-gradient(circle at 5% 100%, rgba(157, 255, 56, .10), transparent 30%),
          radial-gradient(circle at 92% 0%, rgba(112, 37, 143, .22), transparent 34%),
          rgba(5, 5, 7, .96) !important;
        box-shadow: inset 0 1px 0 rgba(255, 79, 154, .08), 0 -12px 34px rgba(0, 0, 0, .44) !important;
      }
      body.is-zombie-mypage .bottom-nav a { color: #77747d !important; }
      body.is-zombie-mypage .bottom-nav a[data-nav-page="home"] {
        color: var(--zombie-pink) !important;
        border: 1px solid rgba(157, 255, 56, .14) !important;
        background: linear-gradient(180deg, rgba(255, 79, 154, .12), rgba(73, 22, 95, .18)) !important;
        box-shadow: inset 0 0 18px rgba(157, 255, 56, .045), 0 0 18px rgba(255, 79, 154, .10) !important;
      }
      @media (max-width: 520px) {
        #home .home-zombie-public-status { min-height: 248px; padding: 22px 17px; border-radius: 21px; }
        #home .home-zombie-public-row { gap: 5px 12px; padding: 15px 14px; }
      }
      @media (prefers-reduced-motion: no-preference) {
        #home.zombie-theme-active .home-zombie-public-status { animation: zombieHeroArrival .42s ease-out both; }
      }
      @keyframes zombieHeroArrival {
        from { opacity: 0; transform: translateY(5px); }
        to { opacity: 1; transform: translateY(0); }
      }
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
    const laterView = typeof koshienLaterPhaseView === "object" && koshienLaterPhaseView ? koshienLaterPhaseView : null;
    syncZombieTheme(root, laterView);
    patchZombieStatus(root);
    const view = typeof koshienPhase2DraftView === "object" && koshienPhase2DraftView
      ? koshienPhase2DraftView
      : null;
    if (!view?.available || !["locked", "completed"].includes(String(view.status || ""))
      || !Array.isArray(view.picks) || view.picks.length !== 16) return false;
    const participant = typeof currentParticipantName === "function" ? currentParticipantName() : "";
    const event = resolveEvent(view);
    if (!participant || !event) return false;

    const eventId = String(event?.id || view.eventId || "");
    const displayEvent = eventWithStartTimes(event, cachedStartTimeRows(eventId, now));
    const phase1Rows = todayCandidatesForTeams(phase1ParticipantTeams(displayEvent, participant), displayEvent, now);
    const phase2Rows = todayCandidatesForTeams(phase2ParticipantTeams(view, participant), displayEvent, now);
    const restDay = tournamentRestDay(displayEvent, now);
    const card = root.document.querySelector("#home .home-today-card");
    if (!card) return false;

    const ownSignature = [
      participant,
      String(view.eventId || ""),
      `rest:${restDay}`,
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
      restDay,
    });
    card.dataset.todayAllPhasesSignature = ownSignature;
    const oldGuard = guardSignature(view, participant, event, now);
    if (oldGuard) card.dataset.phase2TodaySignature = oldGuard;
    return true;
  }

  async function refreshStartTimes(root, { force = false } = {}) {
    const view = typeof koshienPhase2DraftView === "object" && koshienPhase2DraftView
      ? koshienPhase2DraftView
      : null;
    const event = resolveEvent(view);
    const eventId = String(event?.id || view?.eventId || "");
    if (!eventId) return false;
    try {
      await loadStartTimeRows(root, eventId, { force });
      patchCard(root);
      return true;
    } catch (error) {
      root.console?.warn?.("Today YOSO start-time lookup failed", error);
      return false;
    }
  }

  function installBrowser(root) {
    if (!root?.document || root[INSTALL_FLAG]) return false;
    root[INSTALL_FLAG] = true;
    installStyles(root);
    patchCard(root);
    root.setTimeout(() => refreshStartTimes(root), 0);

    root.addEventListener("hashchange", () => root.setTimeout(() => patchCard(root), 0));

    if (typeof renderDashboard === "function") {
      const originalRenderDashboard = renderDashboard;
      renderDashboard = function renderDashboardWithAllTodayYoso() {
        const result = originalRenderDashboard.apply(this, arguments);
        patchCard(root);
        refreshStartTimes(root);
        return result;
      };
    }

    const home = root.document.querySelector("#home");
    if (home && typeof root.MutationObserver === "function") {
      const observer = new root.MutationObserver(() => patchCard(root));
      observer.observe(home, { childList: true, subtree: true });
    }

    root.document.addEventListener("visibilitychange", () => {
      if (!root.document.hidden) {
        patchCard(root);
        refreshStartTimes(root);
      }
    });
    root.addEventListener("pageshow", () => {
      patchCard(root);
      refreshStartTimes(root);
    });
    return true;
  }

  return Object.freeze({
    phase1ParticipantTeams,
    phase2ParticipantTeams,
    eventWithStartTimes,
    todayCandidatesForTeams,
    tournamentRestDay,
    phase2GuardCandidate,
    guardSignature,
    todaysYosoMarkup,
    zombiePublicPredictions,
    zombieHeroMarkup,
    zombiePublicSignature,
    zombieRoundIsActive,
    syncZombieTheme,
    patchZombieStatus,
    patchCard,
    loadStartTimeRows,
    refreshStartTimes,
    installBrowser,
  });
});
