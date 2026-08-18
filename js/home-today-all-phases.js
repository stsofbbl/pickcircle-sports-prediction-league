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

  function normalizeComparable(value) {
    return String(value || "").normalize("NFKC").replace(/[\s　]+/gu, "").trim();
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
      const startsAt = matchStartValue(match);
      const startMs = Date.parse(startsAt || "");
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

  function zombieView() {
    return typeof koshienLaterPhaseView === "object" && koshienLaterPhaseView ? koshienLaterPhaseView : null;
  }

  function zombieRoundOpen() {
    return String(zombieView()?.rounds?.zombie?.status || "") === "open";
  }

  function zombiePublicPredictions() {
    const rows = zombieView()?.zombie?.public_predictions;
    return Array.isArray(rows) ? rows.filter((row) => row?.team_name) : [];
  }

  function zombieHeroMarkup(rows) {
    const infections = rows.length
      ? rows.map((row) => `
          <div class="zombie-public-infection">
            <span>🧟 ゾンビウイルス感染中</span>
            <strong>${escapeHtml(row.team_name)}</strong>
            <small>感染源：${escapeHtml(row.display_name || "参加者")}</small>
          </div>`).join("")
      : '<div class="zombie-public-waiting">ゾンビ指定の確定を待っています。</div>';
    return `
      <div class="zombie-home-hero-inner">
        <span class="zombie-home-eyebrow">ZOMBIE MODE / 夏の甲子園2026 YOSO</span>
        <strong>ゾンビモード発動</strong>
        <span class="zombie-home-copy">敗者復活、最後の1枠。</span>
        <div class="zombie-public-infections">${infections}</div>
      </div>`;
  }

  function patchZombieInfectionMarkers(root, rows) {
    const teamNames = rows.map((row) => String(row.team_name || "")).filter(Boolean);
    const candidates = root.document.querySelectorAll(
      "#home .home-pick-row, #home .home-match-team, #home .home-phase2-team",
    );
    candidates.forEach((element) => {
      const previous = element.querySelector(".zombie-infected-badge");
      if (previous) previous.remove();
      element.classList.remove("is-zombie-infected");
      const text = normalizeComparable(element.textContent);
      const infected = teamNames.find((name) => text.includes(normalizeComparable(name)));
      if (!infected) return;
      element.classList.add("is-zombie-infected");
      const badge = root.document.createElement("span");
      badge.className = "zombie-infected-badge";
      badge.textContent = "🧟 感染中";
      element.appendChild(badge);
    });
  }

  function patchZombiePresentation(root) {
    const active = zombieRoundOpen();
    const home = root.document.querySelector("#home");
    if (!home) return false;
    const banner = home.querySelector("[data-zombie-home-banner]");
    const existingStatus = home.querySelector("[data-zombie-public-status]");
    if (!active) {
      existingStatus?.remove();
      patchZombieInfectionMarkers(root, []);
      return false;
    }

    const rows = zombiePublicPredictions();
    if (banner) {
      const signature = rows.map((row) => `${row.player_id}:${row.team_id}:${row.updated_at || row.created_at || ""}`).join("|");
      if (banner.dataset.zombiePublicSignature !== signature) {
        banner.innerHTML = zombieHeroMarkup(rows);
        banner.dataset.zombiePublicSignature = signature;
      }
    }

    const tournament = home.querySelector(".home-event-dashboard.is-koshien");
    if (tournament) {
      let status = tournament.querySelector("[data-zombie-public-status]");
      if (rows.length) {
        if (!status) {
          status = root.document.createElement("section");
          status.className = "home-zombie-public-status";
          status.dataset.zombiePublicStatus = "true";
          const head = tournament.querySelector(".home-event-head");
          if (head) head.insertAdjacentElement("afterend", status);
          else tournament.prepend(status);
        }
        status.innerHTML = rows.map((row) => `
          <div class="home-zombie-public-row">
            <span>🧟 ゾンビウイルス感染中</span>
            <strong>${escapeHtml(row.team_name)}</strong>
            <small>感染源：${escapeHtml(row.display_name || "参加者")}</small>
          </div>`).join("");
      } else {
        status?.remove();
      }
    }
    patchZombieInfectionMarkers(root, rows);
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

      /* Final zombie presentation: keep the existing YOSO glass UI dark and use
         toxic green / purple only as event accents, matching the approved mock. */
      body.is-zombie-mypage {
        --zombie-accent: #b4d85a;
        --zombie-purple-accent: #72477e;
      }
      body.is-zombie-mypage .app-shell {
        background:
          radial-gradient(circle at 10% 18%, rgba(180, 216, 90, .07), transparent 28%),
          radial-gradient(circle at 90% 28%, rgba(114, 71, 126, .09), transparent 30%),
          linear-gradient(180deg, rgba(13, 13, 15, .98), rgba(17, 16, 20, .98)) !important;
      }
      body.is-zombie-mypage #home.is-zombie-period .home-global-card,
      body.is-zombie-mypage #home.is-zombie-period .home-event-dashboard,
      body.is-zombie-mypage #home.is-zombie-period .home-event-inner,
      body.is-zombie-mypage #home.is-zombie-period .entry-block,
      body.is-zombie-mypage #home.is-zombie-period .koshien-phase2-public-player {
        border-color: rgba(180, 216, 90, .20) !important;
        background: linear-gradient(155deg, rgba(35, 33, 38, .94), rgba(22, 21, 25, .94)) !important;
        box-shadow: inset 0 1px 0 rgba(255,255,255,.035), 0 12px 28px rgba(0,0,0,.20) !important;
      }
      body.is-zombie-mypage #home.is-zombie-period .home-user-card,
      body.is-zombie-mypage #home.is-zombie-period .home-today-card {
        border-color: rgba(180, 216, 90, .28) !important;
        background:
          radial-gradient(circle at 100% 0%, rgba(114, 71, 126, .12), transparent 42%),
          linear-gradient(150deg, rgba(39, 36, 42, .96), rgba(24, 24, 27, .96)) !important;
      }
      body.is-zombie-mypage #home.is-zombie-period .home-event-dashboard.is-koshien {
        border-color: rgba(180, 216, 90, .36) !important;
        background:
          radial-gradient(circle at 92% 6%, rgba(114, 71, 126, .13), transparent 36%),
          linear-gradient(155deg, rgba(34, 32, 37, .97), rgba(20, 21, 22, .97)) !important;
        box-shadow: 0 18px 38px rgba(0,0,0,.26), inset 0 0 0 1px rgba(180,216,90,.045) !important;
      }
      body.is-zombie-mypage #home.is-zombie-period .home-global-card::after,
      body.is-zombie-mypage #home.is-zombie-period .home-user-card::after,
      body.is-zombie-mypage #home.is-zombie-period .home-today-card::after,
      body.is-zombie-mypage #home.is-zombie-period .home-event-dashboard.is-koshien::after {
        opacity: .18 !important;
      }
      body.is-zombie-mypage #home.is-zombie-period .zombie-home-banner {
        min-height: 0 !important;
        place-items: stretch !important;
        padding: 20px !important;
        border-color: rgba(180, 216, 90, .48) !important;
        background:
          radial-gradient(circle at 8% 80%, rgba(180, 216, 90, .19), transparent 37%),
          radial-gradient(circle at 90% 10%, rgba(114, 71, 126, .25), transparent 40%),
          linear-gradient(135deg, rgba(24, 24, 27, .98), rgba(31, 26, 34, .98)) !important;
        box-shadow: 0 16px 34px rgba(0,0,0,.28), inset 0 0 0 1px rgba(255,255,255,.025) !important;
      }
      body.is-zombie-mypage #home.is-zombie-period .zombie-home-banner::before { opacity: .12 !important; }
      #home .zombie-home-hero-inner { position: relative; z-index: 1; display: grid; gap: 8px; }
      #home .zombie-home-eyebrow { color: var(--zombie-accent); font-size: 10px; font-weight: 900; letter-spacing: .11em; }
      body.is-zombie-mypage #home.is-zombie-period .zombie-home-banner .zombie-home-hero-inner > strong {
        color: #f2a7c1 !important;
        font-size: clamp(23px, 6vw, 30px) !important;
        text-align: left !important;
        text-shadow: none !important;
      }
      #home .zombie-home-copy { color: rgba(244,240,243,.82); font-size: 13px; font-weight: 800; }
      #home .zombie-public-infections { display: grid; gap: 8px; margin-top: 4px; }
      #home .zombie-public-infection,
      #home .home-zombie-public-row {
        display: grid;
        grid-template-columns: auto minmax(0,1fr) auto;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        border: 1px solid rgba(180,216,90,.28);
        border-radius: 13px;
        background: rgba(12,14,12,.48);
      }
      #home .zombie-public-infection > span,
      #home .home-zombie-public-row > span { color: var(--zombie-accent); font-size: 11px; font-weight: 900; }
      #home .zombie-public-infection > strong,
      #home .home-zombie-public-row > strong { color: #fff; font-size: 16px; }
      #home .zombie-public-infection > small,
      #home .home-zombie-public-row > small { color: #f2a7c1; font-size: 10px; font-weight: 850; white-space: nowrap; }
      #home .zombie-public-waiting { color: var(--muted); font-size: 12px; }
      #home .home-zombie-public-status { display: grid; gap: 8px; margin: 10px 0 14px; }
      #home .zombie-infected-badge {
        display: inline-flex;
        width: max-content;
        align-items: center;
        margin-top: 4px;
        padding: 3px 7px;
        border: 1px solid rgba(180,216,90,.34);
        border-radius: 999px;
        background: rgba(180,216,90,.10);
        color: var(--zombie-accent);
        font-size: 9px;
        font-weight: 950;
        line-height: 1.2;
      }
      #home .is-zombie-infected { border-color: rgba(180,216,90,.28) !important; }
      body.is-zombie-mypage .bottom-nav {
        border-color: rgba(180,216,90,.20) !important;
        background: rgba(24,23,27,.96) !important;
        box-shadow: 0 -10px 28px rgba(0,0,0,.22) !important;
      }
      @media (max-width: 420px) {
        #home .zombie-public-infection,
        #home .home-zombie-public-row { grid-template-columns: 1fr auto; }
        #home .zombie-public-infection > span,
        #home .home-zombie-public-row > span { grid-column: 1 / -1; }
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
    const view = typeof koshienPhase2DraftView === "object" && koshienPhase2DraftView
      ? koshienPhase2DraftView
      : null;
    if (!view?.available || !["locked", "completed"].includes(String(view.status || ""))
      || !Array.isArray(view.picks) || view.picks.length !== 16) {
      patchZombiePresentation(root);
      return false;
    }
    const participant = typeof currentParticipantName === "function" ? currentParticipantName() : "";
    const event = resolveEvent(view);
    if (!participant || !event) {
      patchZombiePresentation(root);
      return false;
    }

    const eventId = String(event?.id || view.eventId || "");
    const displayEvent = eventWithStartTimes(event, cachedStartTimeRows(eventId, now));
    const phase1Rows = todayCandidatesForTeams(phase1ParticipantTeams(displayEvent, participant), displayEvent, now);
    const phase2Rows = todayCandidatesForTeams(phase2ParticipantTeams(view, participant), displayEvent, now);
    const restDay = tournamentRestDay(displayEvent, now);
    const card = root.document.querySelector("#home .home-today-card");
    if (!card) {
      patchZombiePresentation(root);
      return false;
    }

    const ownSignature = [
      participant,
      String(view.eventId || ""),
      `rest:${restDay}`,
      ...phase1Rows.map((row) => `p1:${row.team}:${row.startsAt}:${row.completed}`),
      ...phase2Rows.map((row) => `p2:${row.team}:${row.startsAt}:${row.completed}`),
    ].join("|");
    if (card.dataset.todayAllPhasesSignature === ownSignature) {
      const oldGuard = guardSignature(view, participant, displayEvent, now);
      if (oldGuard) card.dataset.phase2TodaySignature = oldGuard;
      patchZombiePresentation(root);
      return true;
    }

    card.innerHTML = todaysYosoMarkup({
      eventName: event?.name || "夏の甲子園2026 YOSO",
      phase1Rows,
      phase2Rows,
      restDay,
    });
    card.dataset.todayAllPhasesSignature = ownSignature;
    const oldGuard = guardSignature(view, participant, displayEvent, now);
    if (oldGuard) card.dataset.phase2TodaySignature = oldGuard;
    patchZombiePresentation(root);
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
        refreshStartTimes(root, { force: true });
      }
    });
    root.addEventListener("pageshow", () => {
      patchCard(root);
      refreshStartTimes(root, { force: true });
    });
    root.setInterval?.(() => patchZombiePresentation(root), 5000);
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
    patchZombiePresentation,
    patchCard,
    loadStartTimeRows,
    refreshStartTimes,
    installBrowser,
  });
});
