(function (root) {
  "use strict";

  const PHASE2_PUBLIC_STYLE_ID = "yoso-koshien-phase2-public-style";

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
      if (!shouldPublishPhase2Draft(view)) return originalDraftBlock();
      return phase2PublicDraftHtml(view);
    };
    root.__yosoPhase2PublicDraftInstalled = true;
    installPhase2PublicStyles();
    return true;
  }

  function installBrowserExtensions() {
    install();
    installPhase2PublicDraft();
    loadHomeDashboard();
    loadKoshienScheduleSync();
  }

  if (!root || typeof root.addEventListener !== "function") return;
  installPhase2PublicDraft();
  if (root.document?.readyState === "complete") root.setTimeout(installBrowserExtensions, 0);
  else root.addEventListener("load", installBrowserExtensions, { once: true });
})(typeof globalThis !== "undefined" ? globalThis : this);
