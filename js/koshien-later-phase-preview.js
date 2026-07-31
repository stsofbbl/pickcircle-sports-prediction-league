(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoKoshienLaterPhasePreview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SCREEN_IDS = Object.freeze(["phase2", "revenge", "zombie", "phase3", "results"]);

  const FIXTURE = Object.freeze({
    players: [
      { playerId: "ginji", displayName: "ぎんじ" },
      { playerId: "ino", displayName: "いの" },
      { playerId: "wada", displayName: "わだ" },
      { playerId: "takumi", displayName: "たくみ" },
    ],
    teams: [
      { teamId: "yokohama", name: "横浜" },
      { teamId: "osaka_toin", name: "大阪桐蔭" },
      { teamId: "sendai_ikuei", name: "仙台育英" },
      { teamId: "chiben_wakayama", name: "智辯和歌山" },
      { teamId: "hanamaki_higashi", name: "花巻東" },
      { teamId: "koryo", name: "広陵" },
      { teamId: "chukyo", name: "中京大中京" },
      { teamId: "meitoku", name: "明徳義塾" },
      { teamId: "okinawa_shogaku", name: "沖縄尚学" },
      { teamId: "ken_dai_takasaki", name: "健大高崎" },
      { teamId: "kyoto_kokusai", name: "京都国際" },
      { teamId: "seiryo", name: "星稜" },
      { teamId: "kanto_daiichi", name: "関東第一" },
      { teamId: "tokai_sagami", name: "東海大相模" },
      { teamId: "kamimura", name: "神村学園" },
      { teamId: "tsuruga_kehi", name: "敦賀気比" },
    ],
    snakeOrder: [
      "takumi", "wada", "ino", "ginji",
      "ginji", "ino", "takumi", "wada",
      "takumi", "wada", "ino", "ginji",
      "ginji", "ino", "takumi", "wada",
    ],
    picks: [
      { pickNo: 1, playerId: "takumi", teamId: "yokohama" },
      { pickNo: 2, playerId: "wada", teamId: "osaka_toin" },
      { pickNo: 3, playerId: "ino", teamId: "sendai_ikuei" },
      { pickNo: 4, playerId: "ginji", teamId: "chiben_wakayama" },
    ],
    ranking: [
      { rank: 1, playerId: "wada", displayName: "わだ", total: 236.5, phase1: 56.5, revenge: 0, phase2: 130, zombie: 0, phase3: 50 },
      { rank: 2, playerId: "ginji", displayName: "ぎんじ", total: 218, phase1: 48, revenge: 10, phase2: 130, zombie: 0, phase3: 30 },
      { rank: 3, playerId: "takumi", displayName: "たくみ", total: 181, phase1: 51, revenge: 0, phase2: 150, zombie: -20, phase3: 0 },
      { rank: 4, playerId: "ino", displayName: "いの", total: 139.5, phase1: 39.5, revenge: 0, phase2: 100, zombie: 0, phase3: 0 },
    ],
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function createState() {
    return {
      activeScreen: "phase2",
      players: clone(FIXTURE.players),
      teams: clone(FIXTURE.teams),
      draft: {
        snakeOrder: clone(FIXTURE.snakeOrder),
        picks: clone(FIXTURE.picks),
        selectedTeamId: "",
      },
      revenge: {
        allowedTeamIds: ["hanamaki_higashi", "koryo", "chukyo"],
        selectedTeamId: "",
        savedTeamId: "",
      },
      zombie: {
        allowedTeamIds: ["yokohama", "osaka_toin", "sendai_ikuei", "chiben_wakayama"],
        selectedTeamId: "",
        savedTeamId: "",
      },
      phase3: {
        teamAId: "yokohama",
        teamBId: "osaka_toin",
        scoreA: "",
        scoreB: "",
        savedScore: null,
      },
      ranking: clone(FIXTURE.ranking),
      pendingAction: null,
      message: "",
      messageKind: "",
      detailPlayerId: "",
    };
  }

  function selectScreen(state, screenId) {
    if (!SCREEN_IDS.includes(screenId)) return false;
    state.activeScreen = screenId;
    state.pendingAction = null;
    state.message = "";
    state.messageKind = "";
    return true;
  }

  function availableDraftTeams(state) {
    const picked = new Set(state.draft.picks.map((pick) => pick.teamId));
    return state.teams.filter((team) => !picked.has(team.teamId));
  }

  function requestSave(state, kind) {
    if (!SCREEN_IDS.includes(kind) || kind === "results") throw new Error("保存対象を確認してください。");
    if (kind === "phase2" && !state.draft.selectedTeamId) throw new Error("指名する高校を選択してください。");
    if (kind === "revenge" && !state.revenge.selectedTeamId) throw new Error("リベンジ校を選択してください。");
    if (kind === "zombie" && !state.zombie.selectedTeamId) throw new Error("ゾンビ対象校を選択してください。");
    if (kind === "phase3" && (state.phase3.scoreA === "" || state.phase3.scoreB === "")) {
      throw new Error("両校の得点を入力してください。");
    }
    state.pendingAction = kind;
    state.message = "";
    state.messageKind = "";
    return true;
  }

  function confirmSave(state) {
    const kind = state.pendingAction;
    if (!kind) return false;
    if (kind === "phase2") {
      const teamId = state.draft.selectedTeamId;
      if (!availableDraftTeams(state).some((team) => team.teamId === teamId)) {
        throw new Error("この高校はすでに指名済みです。");
      }
      const pickNo = state.draft.picks.length + 1;
      state.draft.picks.push({
        pickNo,
        playerId: state.draft.snakeOrder[pickNo - 1],
        teamId,
      });
      state.draft.selectedTeamId = "";
    }
    if (kind === "revenge") {
      state.revenge.savedTeamId = state.revenge.selectedTeamId;
    }
    if (kind === "zombie") {
      state.zombie.savedTeamId = state.zombie.selectedTeamId;
    }
    if (kind === "phase3") {
      state.phase3.savedScore = {
        scoreA: Number(state.phase3.scoreA),
        scoreB: Number(state.phase3.scoreB),
      };
    }
    state.pendingAction = null;
    state.message = "プレビュー内で操作を反映しました。本番データには保存されません。";
    state.messageKind = "success";
    return true;
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function teamName(state, teamId) {
    return state.teams.find((team) => team.teamId === teamId)?.name || "高校";
  }

  function playerName(state, playerId) {
    return state.players.find((player) => player.playerId === playerId)?.displayName || "参加者";
  }

  function formatScore(value) {
    return (Math.round(Number(value) * 100) / 100).toLocaleString("ja-JP");
  }

  function phase2Markup(state) {
    const picksByNo = new Map(state.draft.picks.map((pick) => [pick.pickNo, pick]));
    const nextPickNo = state.draft.picks.length + 1;
    const currentPlayerId = state.draft.snakeOrder[nextPickNo - 1];
    const rounds = Array.from({ length: 4 }, (_, roundIndex) => {
      const firstPickNo = (roundIndex * 4) + 1;
      const pickNumbers = Array.from({ length: 4 }, (_, index) => firstPickNo + index);
      return {
        direction: roundIndex % 2 === 0 ? "forward" : "reverse",
        pickNumbers: roundIndex % 2 === 0 ? pickNumbers : pickNumbers.reverse(),
        roundNo: roundIndex + 1,
      };
    });
    const availableTeams = availableDraftTeams(state);
    return `
      <div class="entry-block koshien-phase2-draft koshien-phase2-board koshien-preview-phase2-board">
        <div class="wc-participant-head koshien-preview-draft-head">
          <h3>フェーズ2・ベスト16ドラフト</h3>
          <button class="ghost-button small-button" type="button" data-koshien-preview-reset>リセット</button>
        </div>
        <p class="koshien-preview-draft-rule">スネーク方式：ベスト16を1人4校ずつ、重複なしで指名します</p>
        <div class="koshien-preview-draft-rounds" aria-label="4巡16枠のドラフト指名順">
          ${rounds.map(({ direction, pickNumbers, roundNo }) => `
            <section class="koshien-preview-draft-round" aria-labelledby="koshien-preview-round-${roundNo}">
              <div class="koshien-preview-draft-round-head">
                <strong id="koshien-preview-round-${roundNo}">${roundNo}巡目 <small>（${((roundNo - 1) * 4) + 1}〜${roundNo * 4}番）</small></strong>
                <span class="is-${direction}"><b aria-hidden="true">${direction === "forward" ? "→" : "←"}</b> ${direction === "forward" ? "左から右へ" : "右から左へ"}</span>
              </div>
              <div class="koshien-preview-draft-row" data-direction="${direction}">
                ${pickNumbers.map((pickNo, visualIndex) => {
                  const playerId = state.draft.snakeOrder[pickNo - 1];
                  const pick = picksByNo.get(pickNo);
                  const status = pick ? "指名済み" : pickNo === nextPickNo ? "現在の手番" : "未指名";
                  const stateClass = pick ? "is-picked" : pickNo === nextPickNo ? "is-current" : "is-empty";
                  const schoolName = pick ? teamName(state, pick.teamId) : "未指名";
                  return `<article class="koshien-preview-draft-card ${stateClass}" data-pick-no="${pickNo}">
                    <div class="koshien-preview-draft-card-head">
                      <span class="koshien-preview-pick-number">${pickNo}</span>
                      <strong>${escapeHtml(playerName(state, playerId))}</strong>
                    </div>
                    <span class="koshien-preview-school-crest" data-team-id="${escapeHtml(pick?.teamId || "")}" role="img" aria-label="${escapeHtml(schoolName)}の校章表示領域">
                      <span>校章</span>
                    </span>
                    <span class="koshien-preview-school-name">${escapeHtml(schoolName)}</span>
                    <small class="koshien-preview-pick-status">${status}</small>
                    ${visualIndex < 3 ? `<span class="koshien-preview-draft-flow" aria-hidden="true">${direction === "forward" ? "→" : "←"}</span>` : ""}
                  </article>`;
                }).join("")}
              </div>
            </section>`).join("")}
        </div>
        <div class="koshien-phase2-pick-form">
          <span class="koshien-preview-pick-form-label">高校を選択してください</span>
          <div class="koshien-preview-pick-controls">
            <select aria-label="指名する高校" data-koshien-preview-value="draft.selectedTeamId">
              <option value="">高校を選択してください</option>
              ${availableTeams.map((team) => `<option value="${team.teamId}" ${state.draft.selectedTeamId === team.teamId ? "selected" : ""}>${escapeHtml(team.name)}</option>`).join("")}
            </select>
            <span class="koshien-preview-remaining"><strong>残り${availableTeams.length}校</strong><small>（全16校中）</small></span>
          </div>
          <button class="primary-button" type="button" data-koshien-preview-save="phase2">この高校を指名する（${escapeHtml(playerName(state, currentPlayerId))}の指名）</button>
        </div>
        <div class="koshien-preview-draft-legend" aria-label="表示状態">
          <span class="is-picked">指名済み</span><span class="is-current">現在の手番</span><span class="is-empty">未指名</span>
        </div>
      </div>`;
  }

  function choiceMarkup(state, kind) {
    const choice = state[kind];
    const revenge = kind === "revenge";
    return `
      <div class="entry-block koshien-later-participant koshien-phase2-board">
        <div class="wc-participant-head"><h3>${revenge ? "リベンジカード" : "ゾンビモード"}</h3><span>${revenge ? "フェーズ1全滅者のみ" : "フェーズ2全滅者のみ"}</span></div>
        <p class="wc-phase-intro">${revenge
          ? "自分の指名校を直接倒したベスト16進出校から1校を選択します。"
          : "他プレイヤー保有のベスト4進出校から、準決勝で敗退する1校を選択します。"}</p>
        <p class="koshien-later-reception-message">受付中です。締切日時は 2026/08/14 18:00（日本時間）です。</p>
        <label class="field"><span>${revenge ? "リベンジ校" : "準決勝で敗退する高校"}</span>
          <select data-koshien-preview-value="${kind}.selectedTeamId">
            <option value="">高校を選択</option>
            ${choice.allowedTeamIds.map((teamId) => `<option value="${teamId}" ${choice.selectedTeamId === teamId ? "selected" : ""}>${escapeHtml(teamName(state, teamId))}</option>`).join("")}
          </select>
        </label>
        <div class="koshien-phase2-actions"><button class="primary-button" type="button" data-koshien-preview-save="${kind}">${revenge ? "リベンジ校を保存" : "ゾンビ予想を保存"}</button></div>
        <p class="helper-text">現在のプレビュー内選択: ${escapeHtml(choice.savedTeamId ? teamName(state, choice.savedTeamId) : "未保存")}</p>
      </div>`;
  }

  function phase3Markup(state) {
    const phase3 = state.phase3;
    const saved = phase3.savedScore ? `${phase3.savedScore.scoreA} - ${phase3.savedScore.scoreB}` : "未保存";
    return `
      <div class="entry-block koshien-later-participant koshien-phase2-board">
        <div class="wc-participant-head"><h3>フェーズ3・決勝スコア</h3><span>決勝カード確定</span></div>
        <p class="wc-phase-intro">完全一致50点。完全一致者がいない場合、最も近い予想に30点です。</p>
        <p class="koshien-later-reception-message">受付中です。締切日時は 2026/08/22 09:00（日本時間）です。</p>
        <div class="koshien-preview-final-card">
          <label class="field"><span>${escapeHtml(teamName(state, phase3.teamAId))}</span><input data-koshien-preview-value="phase3.scoreA" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(phase3.scoreA)}"></label>
          <strong>−</strong>
          <label class="field"><span>${escapeHtml(teamName(state, phase3.teamBId))}</span><input data-koshien-preview-value="phase3.scoreB" type="number" min="0" step="1" inputmode="numeric" value="${escapeHtml(phase3.scoreB)}"></label>
        </div>
        <div class="koshien-phase2-actions"><button class="primary-button" type="button" data-koshien-preview-save="phase3">決勝スコア予想を保存</button></div>
        <p class="helper-text">同点予想はできません。現在のプレビュー内選択: ${saved}</p>
      </div>`;
  }

  function resultsMarkup(state) {
    return `
      <div class="entry-block koshien-preview-results">
        <div class="wc-participant-head"><h3>夏の甲子園2026 最終結果</h3><span>大会終了</span></div>
        <div class="result-board">
          <div class="result-card result-card-accent"><span>総合優勝</span><strong>わだ</strong><small>236.5pt</small></div>
          <div class="result-card"><span>決勝結果</span><strong>横浜 5 - 3 大阪桐蔭</strong><small>固定ダミーデータ</small></div>
        </div>
        <div class="scoreboard koshien-preview-scoreboard">
          ${state.ranking.map((row) => `<div class="score-row ${row.rank === 1 ? "score-row-leader" : ""}">
            <span class="rank">${row.rank}</span>
            <div><strong>${escapeHtml(row.displayName)}</strong><small>F1 ${formatScore(row.phase1)} / F2 ${formatScore(row.phase2)} / F3 ${formatScore(row.phase3)}</small></div>
            <strong>${formatScore(row.total)}pt</strong>
            <button class="ghost-button small-button" type="button" data-koshien-preview-detail="${row.playerId}">内訳</button>
          </div>`).join("")}
        </div>
        <div class="insight-band">同点時は正式ルールどおり同順位として表示します。</div>
      </div>`;
  }

  function screenMarkup(state) {
    if (state.activeScreen === "phase2") return phase2Markup(state);
    if (state.activeScreen === "revenge") return choiceMarkup(state, "revenge");
    if (state.activeScreen === "zombie") return choiceMarkup(state, "zombie");
    if (state.activeScreen === "phase3") return phase3Markup(state);
    return resultsMarkup(state);
  }

  function overlayMarkup(state) {
    const actionLabels = {
      phase2: "この高校を指名しますか？",
      revenge: "この高校をリベンジ校にしますか？",
      zombie: "この高校をゾンビ対象にしますか？",
      phase3: "この決勝スコア予想でよいですか？",
    };
    if (state.pendingAction) {
      return `<div class="koshien-preview-overlay" role="dialog" aria-modal="true" aria-label="プレビュー操作の確認">
        <div class="koshien-preview-confirm-sheet">
          <p class="eyebrow">UIプレビュー確認</p><h3>${actionLabels[state.pendingAction]}</h3>
          <p>操作はプレビュー内だけに反映され、本番データには保存されません。</p>
          <div class="dialog-actions">
            <button class="ghost-button" type="button" data-koshien-preview-cancel>戻る</button>
            <button class="primary-button" type="button" data-koshien-preview-confirm>プレビューで反映</button>
          </div>
        </div>
      </div>`;
    }
    const row = state.ranking.find((item) => item.playerId === state.detailPlayerId);
    if (!row) return "";
    return `<div class="koshien-preview-overlay" role="dialog" aria-modal="true" aria-label="得点内訳">
      <div class="koshien-preview-confirm-sheet">
        <p class="eyebrow">POINT BREAKDOWN</p><h3>${escapeHtml(row.displayName)} / ${formatScore(row.total)}pt</h3>
        <div class="history-list">
          <div class="history-row"><span>フェーズ1</span><strong>${formatScore(row.phase1)}pt</strong></div>
          <div class="history-row"><span>リベンジ</span><strong>${formatScore(row.revenge)}pt</strong></div>
          <div class="history-row"><span>フェーズ2</span><strong>${formatScore(row.phase2)}pt</strong></div>
          <div class="history-row"><span>ゾンビ調整</span><strong>${formatScore(row.zombie)}pt</strong></div>
          <div class="history-row"><span>フェーズ3</span><strong>${formatScore(row.phase3)}pt</strong></div>
        </div>
        <button class="primary-button" type="button" data-koshien-preview-detail-close>閉じる</button>
      </div>
    </div>`;
  }

  function renderMarkup(state) {
    const labels = {
      phase2: ["フェーズ2", "ドラフト"],
      revenge: ["リベンジ", "救済カード"],
      zombie: ["ゾンビ", "妨害予想"],
      phase3: ["フェーズ3", "決勝スコア"],
      results: ["最終結果", "ランキング"],
    };
    return `
      <div class="worldcup-phase-tabs koshien-preview-tabs ${state.activeScreen === "phase2" ? "is-phase2" : ""}" aria-label="プレビュー画面切り替え">
        ${SCREEN_IDS.map((screenId) => `<button type="button" class="phase-tab ${state.activeScreen === screenId ? "is-active" : ""}" data-koshien-preview-screen="${screenId}">
          <strong>${labels[screenId][0]}</strong><span>${labels[screenId][1]}</span>
        </button>`).join("")}
      </div>
      <div class="koshien-preview-phone" data-koshien-preview-active="${state.activeScreen}">
        ${screenMarkup(state)}
        <p class="koshien-phase2-message${state.messageKind ? ` is-${state.messageKind}` : ""}" role="status" aria-live="polite">${escapeHtml(state.message)}</p>
      </div>
      ${overlayMarkup(state)}`;
  }

  return {
    SCREEN_IDS,
    availableDraftTeams,
    confirmSave,
    createState,
    renderMarkup,
    requestSave,
    selectScreen,
  };
});
