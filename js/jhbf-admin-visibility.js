(function (root) {
  "use strict";

  const PHASE2_PUBLIC_STYLE_ID = "yoso-koshien-phase2-public-style";
  const ZOMBIE_HOME_STYLE_ID = "yoso-zombie-home-theme-style";

  function install() {
    if (typeof bindActiveEventManagerInputs !== "function") return false;
    const originalBind = bindActiveEventManagerInputs;
    bindActiveEventManagerInputs = function bindActiveEventManagerInputsWithJhbfVisibility() {
      originalBind();
      const isAdmin = typeof canCurrentUserManageLeague === "function"
        ? canCurrentUserManageLeague()
        : typeof isCurrentUserAdmin === "function" && isCurrentUserAdmin();
      if (!isAdmin) {
        document.querySelectorAll(".koshien-jhbf-import").forEach((panel) => panel.remove());
      }
    };
    if (typeof renderActiveEventManager === "function") renderActiveEventManager();
    return true;
  }

  function loadHomeTodayAllPhases() {
    if (root.YosoHomeTodayAllPhases || root.document?.querySelector('script[data-yoso-home-today-all-phases]')) return;
    const script = root.document?.createElement("script");
    if (!script) return;
    script.src = "./js/home-today-all-phases.js?v=20260815-1";
    script.dataset.yosoHomeTodayAllPhases = "true";
    root.document.head?.appendChild(script);
  }

  function loadHomeDashboardPolish() {
    if (root.YosoHomeDashboardPolish) {
      loadHomeTodayAllPhases();
      return;
    }
    const existing = root.document?.querySelector('script[data-yoso-home-dashboard-polish]');
    if (existing) {
      existing.addEventListener("load", loadHomeTodayAllPhases, { once: true });
      return;
    }
    const script = root.document?.createElement("script");
    if (!script) return;
    script.src = "./js/home-dashboard-polish.js?v=20260808-2";
    script.dataset.yosoHomeDashboardPolish = "true";
    script.onload = loadHomeTodayAllPhases;
    root.document.head?.appendChild(script);
  }

  function loadHomeDashboard() {
    if (root.YosoHomeDashboard) {
      loadHomeDashboardPolish();
      return;
    }
    if (root.document?.querySelector('script[data-yoso-home-dashboard]')) return;
    const script = root.document?.createElement("script");
    if (!script) return;
    script.src = "./js/home-dashboard.js?v=20260814-1";
    script.dataset.yosoHomeDashboard = "true";
    script.onload = loadHomeDashboardPolish;
    root.document.head?.appendChild(script);
  }

  function loadKoshienScheduleSync() {
    if (root.YosoKoshienScheduleSync || root.document?.querySelector('script[data-yoso-koshien-schedule-sync]')) return;
    const script = root.document?.createElement("script");
    if (!script) return;
    script.src = "./js/koshien-schedule-sync.js?v=20260808-1";
    script.dataset.yosoKoshienScheduleSync = "true";
    script.defer = true;
    root.document.head?.appendChild(script);
  }

  function escapePhase2PublicHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function shouldPublishPhase2Draft(view) {
    return Boolean(
      view?.available
      && ["locked", "completed"].includes(String(view.status || ""))
      && Array.isArray(view.picks)
      && view.picks.length === 16,
    );
  }

  function phase2PublicRows(view) {
    const players = Array.isArray(view?.players) ? view.players : [];
    const picks = Array.isArray(view?.picks) ? view.picks : [];
    const teams = Array.isArray(view?.eligibleTeams) ? view.eligibleTeams : [];
    const playersById = new Map(players.map((player) => [String(player.playerId || ""), player]));
    const teamsById = new Map(teams.map((team) => [String(team.teamId || ""), team.name || "高校"]));
    const orderedPlayerIds = [];
    [...(Array.isArray(view?.snakeOrder) ? view.snakeOrder : []), ...players.map((player) => player.playerId)].forEach((playerId) => {
      const normalized = String(playerId || "");
      if (normalized && !orderedPlayerIds.includes(normalized)) orderedPlayerIds.push(normalized);
    });
    return orderedPlayerIds.map((playerId) => {
      const player = playersById.get(playerId) || {};
      const displayName = player.displayName || "参加者";
      return {
        playerId,
        displayName,
        initial: String(displayName).trim().slice(0, 1) || "?",
        picks: picks
          .filter((pick) => String(pick.playerId || "") === playerId)
          .sort((left, right) => Number(left.draftRound) - Number(right.draftRound) || Number(left.pickNo) - Number(right.pickNo))
          .map((pick) => ({
            draftRound: Number(pick.draftRound),
            teamName: teamsById.get(String(pick.teamId || "")) || "高校",
          })),
      };
    }).filter((row) => row.picks.length);
  }

  function phase2PublicDraftHtml(view) {
    const rows = phase2PublicRows(view);
    return `
      <div class="entry-block koshien-phase2-public" data-koshien-phase2-public>
        <div class="wc-participant-head koshien-phase2-public-head">
          <h3>フェーズ2・全員のYOSO</h3>
          <span class="koshien-phase2-public-status">公開中</span>
        </div>
        <p class="wc-phase-intro">正式フェーズ2ドラフト結果を公開しています。</p>
        <div class="koshien-phase2-public-list">
          ${rows.map((row) => `
            <article class="koshien-phase2-public-player">
              <div class="koshien-phase2-public-player-head">
                <span class="koshien-phase2-public-avatar" aria-hidden="true">${escapePhase2PublicHtml(row.initial)}</span>
                <div>
                  <strong>${escapePhase2PublicHtml(row.displayName)}</strong>
                  <small>${row.picks.length}校指名</small>
                </div>
              </div>
              <div class="koshien-phase2-public-picks">
                ${row.picks.map((pick) => `
                  <span class="koshien-phase2-public-pick">
                    <b>${escapePhase2PublicHtml(`${pick.draftRound}巡目`)}</b>
                    <strong>${escapePhase2PublicHtml(pick.teamName)}</strong>
                  </span>
                `).join("")}
              </div>
            </article>
          `).join("")}
        </div>
      </div>
    `;
  }

  function normalizedPhase2TeamName(value) {
    return String(value || "").normalize("NFKC").replace(/[\s　]+/gu, "").trim();
  }

  function completedLoserTeamIds(event, view) {
    const losers = [];
    const teams = Array.isArray(view?.eligibleTeams) ? view.eligibleTeams : [];
    const formalTeamIds = new Set(teams.map((team) => String(team.teamId || "")).filter(Boolean));
    const teamIdByName = new Map(teams.map((team) => [
      normalizedPhase2TeamName(team.name),
      String(team.teamId || ""),
    ]).filter(([name, teamId]) => name && teamId));
    const matches = Array.isArray(event?.results?.matches) ? event.results.matches : [];
    matches.forEach((match) => {
      if (String(match?.status || "") !== "completed") return;
      const directLoserId = String(
        match?.metadata?.loser_team_id
        || match?.loser_team_id
        || match?.loserTeamId
        || "",
      );
      if (directLoserId && formalTeamIds.has(directLoserId)) {
        losers.push(directLoserId);
        return;
      }
      const loserName = normalizedPhase2TeamName(
        match?.metadata?.loser_name
        || match?.loser_id
        || match?.loserName
        || "",
      );
      const mappedId = teamIdByName.get(loserName);
      if (mappedId) losers.push(mappedId);
    });
    return [...new Set(losers)];
  }

  function currentPhase2PlayerId(view) {
    const participantName = typeof currentParticipantName === "function" ? currentParticipantName() : "";
    if (!participantName) return "";
    const player = (Array.isArray(view?.players) ? view.players : [])
      .find((candidate) => String(candidate?.displayName || "") === String(participantName));
    return String(player?.playerId || "");
  }

  function zombiePreEligibility(view, event) {
    if (!shouldPublishPhase2Draft(view)) return null;
    const playerId = currentPhase2PlayerId(view);
    if (!playerId || !root.YosoKoshienLaterPhases?.deriveZombiePreEligibility) return null;
    return root.YosoKoshienLaterPhases.deriveZombiePreEligibility({
      playerId,
      formalPicks: view.picks,
      eliminatedTeamIds: completedLoserTeamIds(event, view),
    });
  }

  function zombieConfirmedWaitingHtml() {
    return `
      <div class="entry-block koshien-later-participant" data-koshien-zombie-preconfirmed>
        <div class="wc-participant-head">
          <h3>ゾンビモード</h3>
          <span>対象確定</span>
        </div>
        <p class="wc-phase-intro">フェーズ2で保有した4校がすべて敗退したため、ゾンビ対象が確定しました。</p>
        <p class="koshien-later-reception-message">ベスト4が4校出揃い次第、準決勝で敗退すると予想する高校を1校選べます。</p>
      </div>
    `;
  }

  function installZombieEarlyConfirmation() {
    if (root.__yosoZombieEarlyConfirmationInstalled) return true;
    if (typeof koshienZombieBlock !== "function") return false;
    const originalZombieBlock = koshienZombieBlock;
    koshienZombieBlock = function koshienZombieBlockWithEarlyConfirmation() {
      const round = typeof koshienLaterPhaseView === "object" ? koshienLaterPhaseView?.rounds?.zombie : null;
      if (round) return originalZombieBlock();
      const view = typeof koshienPhase2DraftView === "object" && koshienPhase2DraftView
        ? koshienPhase2DraftView
        : null;
      const event = typeof state === "object" ? state?.event : null;
      const preEligibility = zombiePreEligibility(view, event);
      if (preEligibility?.confirmed) return zombieConfirmedWaitingHtml();
      return originalZombieBlock();
    };
    root.__yosoZombieEarlyConfirmationInstalled = true;
    return true;
  }

  function zombieRoundIsOpen(view) {
    return String(view?.rounds?.zombie?.status || "") === "open";
  }

  function zombieHomePageIsVisible() {
    const pageId = typeof currentPageId === "function"
      ? currentPageId()
      : String(root.location?.hash || "#home").replace(/^#/, "") || "home";
    return pageId === "home";
  }

  function installZombieHomeStyles() {
    if (root.document?.getElementById(ZOMBIE_HOME_STYLE_ID)) return;
    const style = root.document?.createElement("style");
    if (!style) return;
    style.id = ZOMBIE_HOME_STYLE_ID;
    style.textContent = `
      body.is-zombie-mypage {
        --zombie-dirty-green: #77852d;
        --zombie-acid-green: #a7bd45;
        --zombie-rotten-green: #4d5a22;
        --zombie-purple: #6d3478;
        --zombie-purple-dark: #34203b;
      }
      body.is-zombie-mypage .app-shell {
        background:
          radial-gradient(circle at 8% 18%, rgba(119, 133, 45, .15), transparent 26%),
          radial-gradient(circle at 94% 34%, rgba(109, 52, 120, .16), transparent 30%),
          radial-gradient(circle at 42% 78%, rgba(77, 90, 34, .10), transparent 34%),
          linear-gradient(180deg, rgba(8, 9, 8, .98), rgba(16, 14, 18, .98));
      }
      body.is-zombie-mypage .topbar.is-home-page {
        border-bottom-color: rgba(126, 143, 50, .28);
        background:
          linear-gradient(112deg, rgba(255, 118, 174, .08), transparent 30%),
          radial-gradient(circle at 82% 18%, rgba(109, 52, 120, .20), transparent 34%),
          linear-gradient(180deg, rgba(11, 11, 12, .97), rgba(12, 14, 11, .95));
        box-shadow: 0 10px 28px rgba(52, 32, 59, .16);
      }
      body.is-zombie-mypage .topbar.is-home-page .account-chip.is-dashboard-header,
      body.is-zombie-mypage .topbar.is-home-page .topbar-quick-stat {
        border-color: rgba(126, 143, 50, .25);
        background:
          radial-gradient(circle at 100% 0%, rgba(109, 52, 120, .16), transparent 42%),
          linear-gradient(145deg, rgba(28, 29, 24, .88), rgba(21, 18, 24, .88));
      }
      #home.is-zombie-period {
        position: relative;
        isolation: isolate;
      }
      #home.is-zombie-period::before {
        content: "";
        position: fixed;
        inset: 92px 0 74px;
        z-index: -1;
        pointer-events: none;
        background:
          repeating-linear-gradient(128deg, transparent 0 34px, rgba(119, 133, 45, .025) 35px 36px, transparent 37px 71px),
          radial-gradient(circle at 10% 16%, rgba(119, 133, 45, .16), transparent 22%),
          radial-gradient(circle at 91% 40%, rgba(109, 52, 120, .18), transparent 28%);
      }
      #home.is-zombie-period .home-global-card,
      #home.is-zombie-period .home-event-dashboard,
      #home.is-zombie-period .home-event-inner,
      #home.is-zombie-period .entry-block,
      #home.is-zombie-period .koshien-phase2-public-player {
        border-color: rgba(126, 143, 50, .34) !important;
        background:
          radial-gradient(circle at 100% 0%, rgba(109, 52, 120, .13), transparent 37%),
          radial-gradient(circle at 0% 100%, rgba(119, 133, 45, .12), transparent 34%),
          linear-gradient(150deg, rgba(34, 35, 29, .92), rgba(23, 19, 26, .92)) !important;
        box-shadow:
          inset 0 1px 0 rgba(255, 118, 174, .06),
          inset 0 0 0 1px rgba(109, 52, 120, .08),
          0 14px 34px rgba(8, 10, 7, .26) !important;
      }
      #home.is-zombie-period .home-user-card,
      #home.is-zombie-period .home-today-card,
      #home.is-zombie-period .home-event-dashboard.is-koshien {
        border-color: rgba(135, 150, 54, .46) !important;
        background:
          radial-gradient(circle at 88% 18%, rgba(109, 52, 120, .22), transparent 31%),
          radial-gradient(circle at 8% 84%, rgba(119, 133, 45, .18), transparent 36%),
          linear-gradient(145deg, rgba(45, 39, 47, .94), rgba(24, 27, 21, .94)) !important;
      }
      #home.is-zombie-period .home-user-card .home-club-name,
      #home.is-zombie-period .home-event-head strong,
      #home.is-zombie-period .home-today-card h3,
      #home.is-zombie-period .home-event-score,
      #home.is-zombie-period .koshien-phase2-public-head h3,
      #home.is-zombie-period .koshien-phase2-public-avatar,
      #home.is-zombie-period .koshien-phase2-public-pick b {
        color: var(--soap-pink) !important;
        text-shadow: 0 0 16px rgba(119, 133, 45, .20), 0 0 22px rgba(109, 52, 120, .14);
      }
      #home.is-zombie-period .home-event-dashboard.is-koshien::after,
      #home.is-zombie-period .home-user-card::after,
      #home.is-zombie-period .home-today-card::after {
        content: "";
        position: absolute;
        inset: 0;
        pointer-events: none;
        border-radius: inherit;
        background:
          linear-gradient(118deg, transparent 0 56%, rgba(119, 133, 45, .07) 60%, transparent 66%),
          linear-gradient(26deg, transparent 0 72%, rgba(109, 52, 120, .06) 76%, transparent 82%);
      }
      #home.is-zombie-period .home-user-card,
      #home.is-zombie-period .home-today-card,
      #home.is-zombie-period .home-event-dashboard.is-koshien {
        position: relative;
      }
      #home.is-zombie-period .zombie-home-banner {
        grid-column: 1 / -1;
        display: grid;
        min-height: 112px;
        place-items: center;
        padding: 24px 18px;
        overflow: hidden;
        position: relative;
        border: 1px solid rgba(151, 167, 61, .55);
        border-radius: 22px;
        background:
          radial-gradient(circle at 12% 52%, rgba(119, 133, 45, .30), transparent 33%),
          radial-gradient(circle at 90% 36%, rgba(109, 52, 120, .32), transparent 34%),
          linear-gradient(118deg, rgba(68, 36, 56, .90), rgba(28, 32, 20, .95) 54%, rgba(42, 25, 48, .94));
        box-shadow: inset 0 0 0 1px rgba(255, 118, 174, .08), 0 14px 30px rgba(14, 17, 9, .28);
      }
      #home.is-zombie-period .zombie-home-banner::before {
        content: "";
        position: absolute;
        inset: -35%;
        opacity: .42;
        background:
          repeating-linear-gradient(143deg, transparent 0 40px, rgba(173, 192, 72, .10) 41px 43px, transparent 44px 82px),
          radial-gradient(circle at 58% 44%, rgba(123, 54, 132, .32), transparent 26%);
        transform: rotate(-4deg);
      }
      #home.is-zombie-period .zombie-home-banner strong {
        position: relative;
        z-index: 1;
        color: var(--soap-pink);
        font-size: clamp(22px, 6vw, 31px);
        font-weight: 950;
        letter-spacing: .01em;
        line-height: 1.18;
        text-align: center;
        text-shadow: 0 0 18px rgba(167, 189, 69, .34), 0 0 28px rgba(109, 52, 120, .30);
      }
      body.is-zombie-mypage .bottom-nav {
        border-color: rgba(126, 143, 50, .30);
        background:
          radial-gradient(circle at 16% 100%, rgba(119, 133, 45, .18), transparent 28%),
          radial-gradient(circle at 82% 0%, rgba(109, 52, 120, .14), transparent 30%),
          rgba(22, 21, 24, .94);
        box-shadow: 0 -10px 30px rgba(38, 25, 43, .18);
      }
      body.is-zombie-mypage .bottom-nav a[data-nav-page="home"] {
        color: var(--soap-pink);
        background:
          radial-gradient(circle at 22% 72%, rgba(119, 133, 45, .22), transparent 45%),
          linear-gradient(180deg, rgba(109, 52, 120, .13), rgba(255, 118, 174, .06));
        box-shadow: inset 0 0 0 1px rgba(132, 150, 52, .18);
      }
      @media (max-width: 420px) {
        #home.is-zombie-period .zombie-home-banner {
          min-height: 100px;
          padding: 20px 14px;
        }
      }
    `;
    root.document.head?.appendChild(style);
  }

  function ensureZombieHomeBanner(active) {
    const home = root.document?.querySelector("#home");
    const grid = home?.querySelector(".home-global-grid");
    const existing = home?.querySelector("[data-zombie-home-banner]");
    if (!active || !grid) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const banner = root.document.createElement("section");
    banner.className = "zombie-home-banner";
    banner.dataset.zombieHomeBanner = "true";
    banner.setAttribute("aria-label", "ゾンビモード発動");
    banner.innerHTML = "<strong>50銭ゾンビモード発動</strong>";
    const todayCard = grid.querySelector(".home-today-card");
    grid.insertBefore(banner, todayCard || null);
  }

  function applyZombieHomeTheme() {
    const view = typeof koshienLaterPhaseView === "object" ? koshienLaterPhaseView : null;
    const active = zombieRoundIsOpen(view) && zombieHomePageIsVisible();
    root.document?.body?.classList.toggle("is-zombie-mypage", active);
    root.document?.querySelector("#home")?.classList.toggle("is-zombie-period", active);
    ensureZombieHomeBanner(active);
    return active;
  }

  function installZombieHomeTheme() {
    if (root.__yosoZombieHomeThemeInstalled) {
      applyZombieHomeTheme();
      return true;
    }
    installZombieHomeStyles();
    root.__yosoZombieHomeThemeInstalled = true;
    const sync = () => root.setTimeout(applyZombieHomeTheme, 0);
    root.addEventListener("hashchange", sync);
    root.addEventListener("pageshow", sync);
    root.document?.addEventListener("visibilitychange", () => {
      if (!root.document.hidden) sync();
    });
    const home = root.document?.querySelector("#home");
    if (home && typeof root.MutationObserver === "function") {
      const observer = new root.MutationObserver(sync);
      observer.observe(home, { childList: true, subtree: true });
    }
    root.setInterval?.(applyZombieHomeTheme, 5000);
    sync();
    return true;
  }

  function installPhase2PublicStyles() {
    if (root.document?.getElementById(PHASE2_PUBLIC_STYLE_ID)) return;
    const style = root.document?.createElement("style");
    if (!style) return;
    style.id = PHASE2_PUBLIC_STYLE_ID;
    style.textContent = `
      .koshien-phase2-public {
        border-color: var(--line-strong);
        background: linear-gradient(145deg, rgba(70, 37, 51, 0.46), rgba(39, 37, 42, 0.94));
      }
      .koshien-phase2-public-head {
        align-items: center;
      }
      .koshien-phase2-public-head h3 {
        color: var(--soap-pink);
      }
      .koshien-phase2-public-status {
        display: inline-flex;
        align-items: center;
        min-height: 30px;
        padding: 5px 11px;
        border: 1px solid rgba(240, 168, 190, 0.28);
        border-radius: 999px;
        background: rgba(240, 168, 190, 0.12);
        color: var(--soap-pink);
        font-size: 12px;
        font-weight: 900;
      }
      .koshien-phase2-public-list {
        display: grid;
        gap: 10px;
      }
      .koshien-phase2-public-player {
        display: grid;
        gap: 11px;
        padding: 14px;
        border: 1px solid var(--line);
        border-radius: 18px;
        background: rgba(36, 35, 40, 0.72);
      }
      .koshien-phase2-public-player-head {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .koshien-phase2-public-avatar {
        display: grid;
        width: 42px;
        height: 42px;
        flex: 0 0 42px;
        place-items: center;
        border: 1px solid var(--line-strong);
        border-radius: 50%;
        color: var(--soap-pink);
        font-size: 18px;
        font-weight: 950;
      }
      .koshien-phase2-public-player-head > div {
        display: grid;
        gap: 2px;
      }
      .koshien-phase2-public-player-head strong {
        font-size: 17px;
      }
      .koshien-phase2-public-player-head small {
        color: var(--muted);
        font-weight: 750;
      }
      .koshien-phase2-public-picks {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 7px;
      }
      .koshien-phase2-public-pick {
        display: flex;
        min-width: 0;
        align-items: center;
        gap: 7px;
        padding: 9px 10px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: rgba(24, 23, 27, 0.52);
      }
      .koshien-phase2-public-pick b {
        flex: 0 0 auto;
        color: var(--soap-pink);
        font-size: 11px;
        font-weight: 950;
      }
      .koshien-phase2-public-pick strong {
        min-width: 0;
        overflow: hidden;
        font-size: 13px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      @media (max-width: 370px) {
        .koshien-phase2-public-picks {
          grid-template-columns: 1fr;
        }
      }
    `;
    root.document.head?.appendChild(style);
  }

  function installPhase2PublicDraft() {
    if (root.__yosoPhase2PublicDraftInstalled) return true;
    if (typeof participantKoshienDraftBlock !== "function") return false;
    const originalDraftBlock = participantKoshienDraftBlock;
    participantKoshienDraftBlock = function participantKoshienPublicDraftBlock() {
      const view = typeof koshienPhase2DraftView === "object" && koshienPhase2DraftView
        ? koshienPhase2DraftView
        : null;
      const draftHtml = shouldPublishPhase2Draft(view) ? phase2PublicDraftHtml(view) : originalDraftBlock();
      const round = typeof koshienLaterPhaseView === "object" ? koshienLaterPhaseView?.rounds?.zombie : null;
      const eligibility = typeof koshienLaterPhaseView === "object" ? koshienLaterPhaseView?.zombie?.eligibility : null;
      const event = typeof state === "object" ? state?.event : null;
      const showZombie = round ? Boolean(eligibility?.eligible) : Boolean(zombiePreEligibility(view, event)?.confirmed);
      if (showZombie && typeof koshienZombieBlock === "function") return `${koshienZombieBlock()}${draftHtml}`;
      return draftHtml;
    };
    root.__yosoPhase2PublicDraftInstalled = true;
    installPhase2PublicStyles();
    return true;
  }

  function installBrowserExtensions() {
    install();
    installPhase2PublicDraft();
    installZombieEarlyConfirmation();
    installZombieHomeTheme();
    loadHomeDashboard();
    loadKoshienScheduleSync();
  }

  if (!root || typeof root.addEventListener !== "function") return;
  installPhase2PublicDraft();
  installZombieEarlyConfirmation();
  installZombieHomeTheme();
  if (root.document?.readyState === "complete") root.setTimeout(installBrowserExtensions, 0);
  else root.addEventListener("load", installBrowserExtensions, { once: true });
})(typeof globalThis !== "undefined" ? globalThis : this);
