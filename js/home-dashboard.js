(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoHomeDashboard = api;

  if (!root || typeof root.addEventListener !== "function" || !root.document) return;

  const install = () => api.installBrowser(root);
  if (root.document.readyState === "complete") root.setTimeout(install, 0);
  else root.addEventListener("load", install, { once: true });
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STYLE_ID = "yoso-home-dashboard-v2-style";
  const INSTALLED_FLAG = "__yosoHomeDashboardV2Installed";
  const ROUND_ORDER = Object.freeze(["R1", "R2", "R3", "QF", "SF", "F"]);
  const ROUND_LABEL = Object.freeze({ R1: "1回戦", R2: "2回戦", R3: "3回戦", QF: "準々決勝", SF: "準決勝", F: "決勝" });
  const DEFAULT_ROUND_COUNTS = Object.freeze({ R1: 17, R2: 16, R3: 8, QF: 4, SF: 2, F: 1 });
  const ADVANCE_LABEL = Object.freeze({ R1: "2回戦進出", R2: "3回戦進出", R3: "ベスト8進出", QF: "ベスト4進出", SF: "決勝進出", F: "優勝" });
  const MILESTONES = Object.freeze([
    { through: "R2", label: "ベスト16確定" },
    { through: "R3", label: "ベスト8確定" },
    { through: "QF", label: "ベスト4確定" },
    { through: "SF", label: "決勝進出2校確定" },
    { through: "F", label: "優勝校確定" },
  ]);

  function safeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function roundRank(round) {
    const index = ROUND_ORDER.indexOf(String(round || ""));
    return index < 0 ? 99 : index;
  }

  function sortMatches(matches = []) {
    return [...(Array.isArray(matches) ? matches : [])].sort((left, right) => (
      roundRank(left?.round || left?.round_key) - roundRank(right?.round || right?.round_key)
      || safeNumber(left?.match_no, 0) - safeNumber(right?.match_no, 0)
    ));
  }

  function matchRound(match) {
    return String(match?.round || match?.round_key || "");
  }

  function matchTeamA(match) {
    return String(match?.team_a_id || match?.team1_id || "");
  }

  function matchTeamB(match) {
    return String(match?.team_b_id || match?.team2_id || "");
  }

  function matchWinner(match) {
    return String(match?.winner_id || match?.winner_team_id || "");
  }

  function matchLoser(match) {
    return String(match?.loser_id || match?.loser_team_id || "");
  }

  function matchStatus(match) {
    return ["completed", "final"].includes(String(match?.status || "")) ? "completed" : "scheduled";
  }

  function matchNo(match) {
    return safeNumber(match?.match_no, 0);
  }

  function matchId(match) {
    const round = matchRound(match);
    return String(match?.match_id || match?.id || `${round}-${matchNo(match)}`);
  }

  function matchStartValue(match) {
    return match?.starts_at
      || match?.startsAt
      || match?.metadata?.starts_at
      || match?.metadata?.scheduled_at
      || "";
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

  function roundProgress(matches = [], counts = DEFAULT_ROUND_COUNTS) {
    const source = Array.isArray(matches) ? matches : [];
    return ROUND_ORDER.map((round) => {
      const roundMatches = source.filter((match) => matchRound(match) === round);
      const total = roundMatches.length || safeNumber(counts?.[round], DEFAULT_ROUND_COUNTS[round]);
      const completed = roundMatches.filter((match) => matchStatus(match) === "completed").length;
      return { round, completed, total };
    });
  }

  function tournamentProgress(matches = [], counts = DEFAULT_ROUND_COUNTS) {
    const progress = roundProgress(matches, counts);
    const current = progress.find((item) => item.completed < item.total) || progress.at(-1);
    const currentIndex = Math.max(0, progress.findIndex((item) => item.round === current?.round));
    const visible = progress.slice(currentIndex, currentIndex + 2);
    const milestone = MILESTONES.find((item) => roundRank(item.through) >= currentIndex) || MILESTONES.at(-1);
    const throughIndex = roundRank(milestone.through);
    const remaining = progress
      .slice(0, throughIndex + 1)
      .reduce((total, item) => total + Math.max(0, item.total - item.completed), 0);
    return { progress, current, visible, milestone: { ...milestone, remaining } };
  }

  function phase1PickersForTeam({ event, team, participantNames = [], predictionsPublic = false } = {}) {
    if (!predictionsPublic || !team) return [];
    const predictions = event?.predictions && typeof event.predictions === "object" ? event.predictions : {};
    const orderedNames = [...new Set([...(participantNames || []), ...Object.keys(predictions)])];
    return orderedNames.filter((name) => {
      const picks = predictions?.[name]?.teams;
      return Array.isArray(picks) && picks.includes(team);
    });
  }

  function pendingMatchForTeam(matches = [], team = "") {
    if (!team) return null;
    return sortMatches(matches).find((match) => (
      matchStatus(match) !== "completed"
      && [matchTeamA(match), matchTeamB(match)].includes(team)
    )) || null;
  }

  function latestCompletedForTeam(matches = [], team = "") {
    if (!team) return null;
    return sortMatches(matches)
      .filter((match) => (
        matchStatus(match) === "completed"
        && [matchTeamA(match), matchTeamB(match), matchWinner(match), matchLoser(match)].includes(team)
      ))
      .at(-1) || null;
  }

  function teamStatus({ matches = [], team = "", now = Date.now() } = {}) {
    const completed = latestCompletedForTeam(matches, team);
    if (completed && matchLoser(completed) === team) {
      return { text: matchRound(completed) === "F" ? "準優勝" : "敗退", tone: "eliminated", match: completed };
    }
    if (completed && matchRound(completed) === "F" && matchWinner(completed) === team) {
      return { text: "優勝", tone: "alive", match: completed };
    }

    const pending = pendingMatchForTeam(matches, team);
    if (pending) {
      const startsAt = matchStartValue(pending);
      if (startsAt && japanDateKey(startsAt) === japanDateKey(now)) {
        const time = japanTimeLabel(startsAt);
        return { text: `本日${time ? ` ${time}` : ""}`, tone: "today", match: pending };
      }
      const round = matchRound(pending);
      return { text: `次戦 ${round}-${matchNo(pending)}`, tone: "alive", match: pending };
    }

    if (completed && matchWinner(completed) === team) {
      return { text: ADVANCE_LABEL[matchRound(completed)] || "勝ち残り", tone: "alive", match: completed };
    }
    return { text: "次戦未定", tone: "unknown", match: null };
  }

  function formatMultiplier(meta = {}) {
    const candidates = [meta.gameMultiplier, meta.sqrtOdds, meta.odds];
    const value = candidates.map(Number).find((number) => Number.isFinite(number) && number > 0);
    if (!value) return "—";
    return value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function escapeLocal(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function installStyles(root) {
    if (root.document.getElementById(STYLE_ID)) return;
    const style = root.document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #home .dashboard-panel {
        display: grid;
        gap: 18px;
      }
      #home .home-page-heading { margin-bottom: -2px; }
      #home .home-page-heading .status-pill { display: none; }
      #home .home-global-grid {
        display: grid;
        grid-template-columns: minmax(128px, .8fr) minmax(0, 1.65fr);
        gap: 12px;
      }
      #home .home-global-card,
      #home .home-event-dashboard,
      #home .home-event-inner {
        border: 1px solid rgba(255, 255, 255, .13);
        background: linear-gradient(155deg, rgba(38, 37, 43, .88), rgba(18, 18, 22, .82));
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, .035), 0 12px 32px rgba(0, 0, 0, .18);
        backdrop-filter: blur(18px);
        -webkit-backdrop-filter: blur(18px);
      }
      #home .home-global-card { border-radius: 22px; }
      #home .home-user-card {
        padding: 18px;
        display: grid;
        align-content: center;
        min-height: 150px;
      }
      #home .home-user-card strong {
        display: block;
        margin-top: 4px;
        font-size: clamp(34px, 8vw, 54px);
        line-height: 1;
        letter-spacing: -.04em;
      }
      #home .home-user-card small,
      #home .home-today-card small { color: var(--muted); }
      #home .home-user-card .home-club-name {
        margin-top: 14px;
        color: var(--soap-pink);
        font-size: 13px;
        font-weight: 900;
        letter-spacing: .02em;
      }
      #home .home-today-card {
        min-height: 150px;
        padding: 18px;
        border-color: color-mix(in srgb, var(--soap-pink) 58%, transparent);
        background:
          radial-gradient(circle at 86% 30%, rgba(255, 118, 174, .24), transparent 34%),
          linear-gradient(140deg, rgba(85, 29, 55, .76), rgba(22, 16, 23, .9));
        overflow: hidden;
      }
      #home .home-today-card h3,
      #home .home-event-dashboard h3,
      #home .home-event-inner h4 { margin: 0; }
      #home .home-today-card h3 { color: var(--soap-pink); font-size: 18px; }
      #home .home-today-card strong {
        display: block;
        margin-top: 12px;
        font-size: 16px;
        line-height: 1.65;
      }
      #home .home-today-card .home-today-event {
        display: block;
        margin-top: 6px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 800;
      }
      #home .home-today-card .home-today-impact {
        display: block;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid rgba(255,255,255,.1);
        color: var(--text);
        font-weight: 800;
      }
      #home .home-today-card .home-today-impact b { color: var(--soap-pink); }
      #home .home-active-heading { margin-top: 2px; }
      #home .home-tournament-dashboards { display: grid; gap: 16px; }
      #home .home-event-dashboard {
        border-radius: 24px;
        padding: 14px;
        overflow: hidden;
      }
      #home .home-event-dashboard.is-koshien {
        border-color: color-mix(in srgb, var(--soap-pink) 52%, transparent);
        background:
          radial-gradient(circle at 88% 0%, rgba(255, 82, 152, .11), transparent 28%),
          linear-gradient(155deg, rgba(41, 29, 38, .9), rgba(16, 16, 20, .88));
      }
      #home .home-event-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 12px;
        padding: 2px 4px 0;
      }
      #home .home-event-head strong {
        color: var(--soap-pink);
        font-size: 18px;
        line-height: 1.3;
      }
      #home .home-event-head .status-label { flex: 0 0 auto; }
      #home .home-event-top-grid {
        display: grid;
        grid-template-columns: minmax(0, .9fr) minmax(0, 1.1fr);
        gap: 10px;
      }
      #home .home-event-inner {
        border-radius: 18px;
        padding: 14px;
      }
      #home .home-event-inner h4 {
        margin-bottom: 10px;
        font-size: 14px;
      }
      #home .home-event-rank-meta {
        display: flex;
        align-items: baseline;
        gap: 5px;
        color: var(--muted);
        font-weight: 800;
      }
      #home .home-event-rank-meta strong { color: var(--text); font-size: 18px; }
      #home .home-event-score {
        display: block;
        margin: 8px 0 3px;
        color: var(--soap-pink);
        font-size: clamp(28px, 7vw, 44px);
        font-weight: 950;
        line-height: 1;
      }
      #home .home-event-gap { color: var(--muted); font-size: 12px; font-weight: 800; }
      #home .home-progress-row { display: grid; gap: 5px; margin-top: 8px; }
      #home .home-progress-copy { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; font-weight: 800; }
      #home .home-progress-track {
        height: 7px;
        overflow: hidden;
        border-radius: 999px;
        background: rgba(255,255,255,.08);
        box-shadow: inset 0 0 0 1px rgba(255,255,255,.06);
      }
      #home .home-progress-fill {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, var(--soap-pink), #ff86bb);
      }
      #home .home-milestone { display: block; margin-top: 11px; color: var(--muted); font-size: 12px; font-weight: 800; }
      #home .home-milestone b { color: var(--soap-pink); }
      #home .home-virtual-link {
        display: grid;
        gap: 4px;
        margin-top: 10px;
        padding: 15px 16px;
        border: 1px solid rgba(72, 161, 255, .48);
        border-radius: 18px;
        background:
          linear-gradient(90deg, rgba(13, 48, 82, .72), rgba(17, 25, 41, .78)),
          rgba(14, 20, 31, .9);
        color: #58b9ff;
        text-decoration: none;
      }
      #home .home-virtual-link strong { font-size: 17px; }
      #home .home-virtual-link span { color: rgba(229, 240, 255, .78); font-size: 12px; font-weight: 700; }
      #home .home-event-detail-grid {
        display: grid;
        grid-template-columns: minmax(0, .78fr) minmax(0, 1.22fr);
        gap: 10px;
        margin-top: 10px;
      }
      #home .home-pick-list { display: grid; gap: 4px; }
      #home .home-pick-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: center;
        gap: 8px;
        min-height: 30px;
        padding: 5px 7px;
        border-radius: 9px;
        background: rgba(255,255,255,.035);
        font-size: 11px;
      }
      #home .home-pick-team {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-weight: 850;
      }
      #home .home-pick-team .is-captain { color: #ffd45e; margin-right: 3px; }
      #home .home-pick-status { white-space: nowrap; font-weight: 950; }
      #home .home-pick-status.is-alive { color: #69d27c; }
      #home .home-pick-status.is-eliminated { color: #ff697a; }
      #home .home-pick-status.is-today { color: #ffc94f; }
      #home .home-pick-status.is-unknown { color: var(--muted); }
      #home .home-readonly-matches {
        max-height: 430px;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: thin;
      }
      #home .home-match-round {
        border-bottom: 1px solid rgba(255,255,255,.07);
      }
      #home .home-match-round:last-child { border-bottom: 0; }
      #home .home-match-round summary {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 2px;
        cursor: pointer;
        list-style: none;
        font-size: 12px;
        font-weight: 900;
      }
      #home .home-match-round summary::-webkit-details-marker { display: none; }
      #home .home-match-round summary::before { content: "▶"; color: var(--muted); font-size: 9px; margin-right: 4px; }
      #home .home-match-round[open] summary::before { content: "▼"; }
      #home .home-match-round summary span { margin-left: auto; color: var(--muted); }
      #home .home-match-list { display: grid; gap: 5px; padding: 2px 0 8px; }
      #home .home-match-row {
        display: grid;
        grid-template-columns: 42px minmax(0, 1fr) auto minmax(0, 1fr);
        gap: 7px;
        align-items: center;
        padding: 8px;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 11px;
        background: rgba(8,8,11,.28);
        font-size: 10px;
      }
      #home .home-match-id { color: var(--muted); font-weight: 850; }
      #home .home-match-team { min-width: 0; }
      #home .home-match-team strong {
        display: block;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 10.5px;
      }
      #home .home-match-pickers {
        display: block;
        min-height: 14px;
        color: var(--soap-pink);
        font-size: 9.5px;
        font-weight: 900;
      }
      #home .home-match-score {
        color: #73d785;
        font-size: 17px;
        font-weight: 950;
        white-space: nowrap;
      }
      #home .home-match-score.is-pending { color: var(--muted); font-size: 12px; }
      #home .home-generic-event {
        display: grid;
        gap: 10px;
      }
      #home .home-generic-event p { margin: 0; color: var(--muted); }
      #home .home-generic-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      @media (max-width: 619px) {
        #home .home-event-detail-grid { grid-template-columns: 1fr; }
        #home .home-readonly-matches { max-height: 390px; }
      }
      @media (max-width: 380px) {
        #home .home-global-grid,
        #home .home-event-top-grid { grid-template-columns: 1fr; }
        #home .home-user-card { min-height: 110px; }
        #home .home-match-row { grid-template-columns: 34px minmax(0, 1fr) auto minmax(0, 1fr); gap: 4px; padding: 6px; }
      }
    `;
    root.document.head.appendChild(style);
  }

  function browserEscape(value) {
    return typeof escapeHtml === "function" ? escapeHtml(value) : escapeLocal(value);
  }

  function browserEscapeAttr(value) {
    return typeof escapeAttr === "function" ? escapeAttr(value) : escapeLocal(value);
  }

  function currentClubName() {
    const club = typeof activeClubRecord === "function" ? activeClubRecord() : null;
    if (club?.league_name) return String(club.league_name);
    const league = String(state?.leagueName || "").trim();
    return league.replace(/\s*予想リーグ\s*$/u, "") || "未所属";
  }

  function participantNameForEvent(event) {
    const userId = String(typeof currentAuthUser === "function" ? currentAuthUser()?.id || "" : "");
    const predictions = event?.predictions || {};
    if (userId) {
      const match = Object.entries(predictions).find(([, prediction]) => String(prediction?.profileId || "") === userId);
      if (match) return match[0];
    }
    return typeof currentParticipantName === "function" ? currentParticipantName() : (state?.participants?.[0] || "あなた");
  }

  function predictionsArePublic(event) {
    if (typeof koshienPhase1PredictionsPublic === "function") return koshienPhase1PredictionsPublic(event);
    if (["resultWait", "finalized", "archive"].includes(String(event?.status || ""))) return true;
    const deadline = Date.parse(event?.deadline || "");
    return Number.isFinite(deadline) && Date.now() >= deadline;
  }

  function eventScoreSummary(event, participant) {
    const total = Array.isArray(state?.participants) ? state.participants.length : 0;
    if (String(state?.event?.id || "") !== String(event?.id || "") || typeof calculateScores !== "function") {
      return { rank: "—", total, score: null, gap: null };
    }
    const rows = calculateScores() || [];
    const userId = String(typeof currentAuthUser === "function" ? currentAuthUser()?.id || "" : "");
    let index = rows.findIndex((row) => userId && String(row?.profileId || "") === userId);
    if (index < 0) index = rows.findIndex((row) => row?.name === participant);
    const row = index >= 0 ? rows[index] : null;
    const leader = rows[0];
    if (!row) return { rank: "—", total: rows.length || total, score: null, gap: null };
    const rank = row.rank ?? index + 1;
    const score = safeNumber(row.score, 0);
    const gap = Math.max(0, safeNumber(leader?.score, score) - score);
    return { rank, total: rows.length || total, score, gap };
  }

  function scoreText(value) {
    if (value === null || value === undefined) return "—";
    return typeof formatScore === "function" ? formatScore(value) : String(Math.round(safeNumber(value) * 100) / 100);
  }

  function todayYoso(activeEvents = []) {
    const now = Date.now();
    const todayKey = japanDateKey(now);
    let fallback = null;

    for (const event of activeEvents) {
      if (typeof baseTemplateId === "function" && baseTemplateId(event?.templateId) !== "koshien") continue;
      const participant = participantNameForEvent(event);
      const picks = Array.isArray(event?.predictions?.[participant]?.teams) ? event.predictions[participant].teams.filter(Boolean) : [];
      const matches = event?.results?.matches || [];
      for (const team of picks) {
        const pending = pendingMatchForTeam(matches, team);
        if (!pending) continue;
        const meta = event?.config?.teamMeta?.[team] || {};
        const multiplier = formatMultiplier(meta);
        const startsAt = matchStartValue(pending);
        const candidate = {
          event,
          team,
          match: pending,
          multiplier,
          startsAt,
          isToday: Boolean(startsAt && japanDateKey(startsAt) === todayKey),
        };
        if (candidate.isToday) return candidate;
        if (!fallback) fallback = candidate;
      }
    }
    return fallback;
  }

  function todayYosoMarkup(activeEvents) {
    const item = todayYoso(activeEvents);
    if (!item) {
      return `
        <article class="home-global-card home-today-card">
          <h3>◉ 今日のYOSO</h3>
          <strong>開催中大会の最新状況をここに表示します。</strong>
          <span class="home-today-impact">試合結果・順位・次戦情報を確認できます。</span>
        </article>`;
    }
    const round = matchRound(item.match);
    const number = matchNo(item.match);
    const time = item.startsAt ? japanTimeLabel(item.startsAt) : "";
    const main = item.isToday
      ? `あなたの指名校「${browserEscape(item.team)}」が本日${time ? ` ${browserEscape(time)}` : ""}に登場`
      : `あなたの指名校「${browserEscape(item.team)}」の次戦は ${browserEscape(round)}-${number}`;
    return `
      <article class="home-global-card home-today-card">
        <h3>◉ 今日のYOSO</h3>
        <span class="home-today-event">${browserEscape(item.event?.name || "開催中大会")}</span>
        <strong>${main}</strong>
        <span class="home-today-impact">勝利すると到達ポイント × <b>${browserEscape(item.multiplier)}倍</b></span>
      </article>`;
  }

  function userIdentityMarkup() {
    const participant = typeof currentParticipantName === "function" ? currentParticipantName() : (state?.participants?.[0] || "あなた");
    return `
      <article class="home-global-card home-user-card">
        <strong>${browserEscape(participant)}</strong>
        <span class="home-club-name">参加CLUB ${browserEscape(currentClubName())}</span>
      </article>`;
  }

  function progressMarkup(event) {
    const summary = tournamentProgress(event?.results?.matches || []);
    const rows = summary.visible.map((item) => {
      const percent = item.total > 0 ? Math.round((item.completed / item.total) * 100) : 0;
      return `
        <div class="home-progress-row">
          <div class="home-progress-copy"><span>${browserEscape(ROUND_LABEL[item.round] || item.round)}</span><strong>${item.completed} / ${item.total}終了</strong></div>
          <div class="home-progress-track"><span class="home-progress-fill" style="width:${Math.max(0, Math.min(100, percent))}%"></span></div>
        </div>`;
    }).join("");
    return `${rows}<span class="home-milestone">${browserEscape(summary.milestone.label)}まであと <b>${summary.milestone.remaining}試合</b></span>`;
  }

  function picksMarkup(event, participant) {
    const prediction = event?.predictions?.[participant] || {};
    const picks = Array.isArray(prediction.teams) ? prediction.teams.filter(Boolean).slice(0, 8) : [];
    const matches = event?.results?.matches || [];
    if (!picks.length) return `<p class="helper-text">この大会の指名校はまだありません。</p>`;
    return `<div class="home-pick-list">${picks.map((team) => {
      const meta = event?.config?.teamMeta?.[team] || {};
      const status = teamStatus({ matches, team });
      const captain = prediction.captain === team;
      return `
        <div class="home-pick-row">
          <span class="home-pick-team">${captain ? '<span class="is-captain">★</span>' : ""}${browserEscape(team)}（${browserEscape(formatMultiplier(meta))}）</span>
          <span class="home-pick-status is-${browserEscapeAttr(status.tone)}">${browserEscape(status.text)}</span>
        </div>`;
    }).join("")}</div>`;
  }

  function readOnlyMatchesMarkup(event) {
    const matches = sortMatches(event?.results?.matches || []);
    const publicPicks = predictionsArePublic(event);
    const participantNames = Array.isArray(state?.participants) ? state.participants : [];
    const progress = tournamentProgress(matches).progress;
    const currentRound = progress.find((item) => item.completed < item.total)?.round || "F";
    const teamMeta = event?.config?.teamMeta || {};

    return `<div class="home-readonly-matches">${ROUND_ORDER.map((round) => {
      const roundMatches = matches.filter((match) => matchRound(match) === round);
      if (!roundMatches.length) return "";
      const completed = roundMatches.filter((match) => matchStatus(match) === "completed").length;
      const rows = roundMatches.map((match) => {
        const teamA = matchTeamA(match) || "高校未定";
        const teamB = matchTeamB(match) || "高校未定";
        const pickersA = matchTeamA(match) ? phase1PickersForTeam({ event, team: matchTeamA(match), participantNames, predictionsPublic: publicPicks }).join("・") : "";
        const pickersB = matchTeamB(match) ? phase1PickersForTeam({ event, team: matchTeamB(match), participantNames, predictionsPublic: publicPicks }).join("・") : "";
        const oddsA = matchTeamA(match) ? `（${formatMultiplier(teamMeta[matchTeamA(match)] || {})}）` : "";
        const oddsB = matchTeamB(match) ? `（${formatMultiplier(teamMeta[matchTeamB(match)] || {})}）` : "";
        const isCompleted = matchStatus(match) === "completed";
        const score = isCompleted ? `${safeNumber(match.score_a ?? match.team1_score)}-${safeNumber(match.score_b ?? match.team2_score)}` : "—";
        return `
          <div class="home-match-row">
            <span class="home-match-id">${browserEscape(matchId(match))}</span>
            <span class="home-match-team"><strong>${browserEscape(teamA)}${browserEscape(oddsA)}</strong><small class="home-match-pickers">${browserEscape(pickersA)}</small></span>
            <strong class="home-match-score ${isCompleted ? "" : "is-pending"}">${browserEscape(score)}</strong>
            <span class="home-match-team"><strong>${browserEscape(teamB)}${browserEscape(oddsB)}</strong><small class="home-match-pickers">${browserEscape(pickersB)}</small></span>
          </div>`;
      }).join("");
      return `
        <details class="home-match-round" ${round === currentRound ? "open" : ""}>
          <summary>${browserEscape(round)} <span>${completed}/${roundMatches.length}完了</span></summary>
          <div class="home-match-list">${rows}</div>
        </details>`;
    }).join("")}</div>`;
  }

  function koshienDashboardMarkup(event) {
    const participant = participantNameForEvent(event);
    const score = eventScoreSummary(event, participant);
    const rankText = score.rank === "—" ? "—" : `${score.rank}位`;
    return `
      <article class="home-event-dashboard is-koshien" data-home-event-id="${browserEscapeAttr(event?.id || "")}">
        <header class="home-event-head">
          <strong>⚾ ${browserEscape(event?.name || "夏の甲子園2026 YOSO")}</strong>
          <span class="status-label open">開催中</span>
        </header>
        <div class="home-event-top-grid">
          <section class="home-event-inner">
            <h4>1　今大会のあなた</h4>
            <span class="home-event-rank-meta">現在 <strong>${browserEscape(rankText)}</strong> / ${score.total || state?.participants?.length || 0}人</span>
            <strong class="home-event-score">${browserEscape(scoreText(score.score))}<small> pt</small></strong>
            <span class="home-event-gap">1位との差 ${score.gap === null ? "—" : browserEscape(scoreText(score.gap)) + " pt"}</span>
          </section>
          <section class="home-event-inner">
            <h4>2　大会進捗</h4>
            ${progressMarkup(event)}
          </section>
        </div>
        <a class="home-virtual-link" href="https://vk.sportsbull.jp/sp/koshien/" target="_blank" rel="noopener noreferrer">
          <strong>3　バーチャル高校野球 ↗</strong>
          <span>ライブ配信・日程・試合詳細を見る</span>
        </a>
        <div class="home-event-detail-grid">
          <section class="home-event-inner">
            <h4>4　あなたの8校</h4>
            ${picksMarkup(event, participant)}
          </section>
          <section class="home-event-inner">
            <h4>5　試合結果・組み合わせ</h4>
            ${readOnlyMatchesMarkup(event)}
          </section>
        </div>
      </article>`;
  }

  function genericDashboardMarkup(event) {
    const missing = typeof missingPredictionCountForEvent === "function"
      ? missingPredictionCountForEvent(event, participantNameForEvent(event))
      : 0;
    const status = String(event?.status || "open");
    const statusText = typeof statusLabel === "function" ? statusLabel(status) : status;
    return `
      <article class="home-event-dashboard home-generic-event" data-home-event-id="${browserEscapeAttr(event?.id || "")}">
        <header class="home-event-head">
          <strong>${browserEscape(event?.name || "開催中大会")}</strong>
          <span class="status-label ${status === "open" ? "open" : "pending"}">${browserEscape(statusText)}</span>
        </header>
        <p>${missing > 0 ? `未入力 ${missing}項目があります。` : "この大会のYOSOは入力済みです。"}</p>
        <div class="home-generic-actions">
          <a class="primary-link" href="#prediction" data-event-id="${browserEscapeAttr(event?.id || "")}">YOSOを開く</a>
          <a class="ghost-link" href="#ranking" data-event-id="${browserEscapeAttr(event?.id || "")}">ランキングを見る</a>
        </div>
      </article>`;
  }

  function ensureHomeShell() {
    const panel = document.querySelector("#home .dashboard-panel");
    if (!panel || panel.dataset.homeDashboardV2 === "true") return panel;
    panel.dataset.homeDashboardV2 = "true";
    panel.innerHTML = `
      <div class="section-heading home-page-heading">
        <div>
          <h2>マイページ</h2>
          <p id="homeClubLine">参加中のクラブと開催中大会を確認します。</p>
        </div>
      </div>
      <div class="home-readiness" id="homeReadinessPanel"></div>
      <div class="section-heading compact-heading home-active-heading">
        <div><h3>開催中大会</h3></div>
        <span class="pill"><span id="homeOpenCount">0</span>件</span>
      </div>
      <div class="home-tournament-dashboards" id="homeTournamentCards"></div>`;

    if (typeof els === "object" && els) {
      els.homeClubLine = document.querySelector("#homeClubLine");
      els.homeReadinessPanel = document.querySelector("#homeReadinessPanel");
      els.homeOpenCount = document.querySelector("#homeOpenCount");
      els.homeTournamentCards = document.querySelector("#homeTournamentCards");
    }
    return panel;
  }

  function renderDashboardV2() {
    ensureHomeShell();
    const participant = typeof currentParticipantName === "function" ? currentParticipantName() : (state?.participants?.[0] || "あなた");
    const activeEvents = typeof eventsByStatus === "function"
      ? eventsByStatus("open", "resultWait", "finalized")
      : (state?.events || []).filter((event) => ["open", "resultWait", "finalized"].includes(String(event?.status || "open")));

    if (els?.homeClubLine) els.homeClubLine.textContent = `${state?.leagueName || currentClubName()} / ${state?.participants?.length || 0}人参加中`;
    if (els?.homeOpenCount) els.homeOpenCount.textContent = String(activeEvents.length);
    if (els?.homeReadinessPanel) {
      els.homeReadinessPanel.innerHTML = `<div class="home-global-grid">${userIdentityMarkup()}${todayYosoMarkup(activeEvents)}</div>`;
    }
    if (els?.homeTournamentCards) {
      els.homeTournamentCards.innerHTML = activeEvents.length
        ? activeEvents.map((event) => {
          const base = typeof baseTemplateId === "function" ? baseTemplateId(event?.templateId) : String(event?.templateId || "");
          return base === "koshien" ? koshienDashboardMarkup(event) : genericDashboardMarkup(event);
        }).join("")
        : `<div class="history-row"><strong>開催中の大会はありません</strong><small>設定から大会を追加できます。</small></div>`;
    }

    if (typeof renderApprovalPolicy === "function") renderApprovalPolicy();
    return participant;
  }

  function installBrowser(root) {
    if (!root?.document || root[INSTALLED_FLAG]) return false;
    if (typeof renderDashboard !== "function" || typeof state === "undefined" || typeof els !== "object") return false;
    root[INSTALLED_FLAG] = true;
    installStyles(root);
    ensureHomeShell();
    renderDashboard = renderDashboardV2;
    renderDashboardV2();
    return true;
  }

  return Object.freeze({
    ROUND_ORDER,
    DEFAULT_ROUND_COUNTS,
    roundProgress,
    tournamentProgress,
    phase1PickersForTeam,
    pendingMatchForTeam,
    teamStatus,
    formatMultiplier,
    installBrowser,
  });
});