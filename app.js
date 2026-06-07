const STORAGE_KEY = "yoso-league-state-v1";

const templates = {
  rankingOdds: {
    id: "rankingOdds",
    sport: "baseball",
    name: "順位予想",
    subtitle: "WBC型: 順位ポイントにオッズを掛ける",
    eventName: "WBC順位予想",
    teams: ["日本", "アメリカ", "ドミニカ", "プエルトリコ", "ベネズエラ", "イタリア"],
    resultLabels: ["1位", "2位", "3位", "4位"],
    basePoints: [10, 7, 5, 3],
  },
  playoff: {
    id: "playoff",
    sourceTemplate: "rankingOdds",
    sport: "baseball",
    name: "プレーオフ型",
    subtitle: "CS・プレーオフ型: 勝ち抜け/シリーズ勝者を予想",
    eventName: "プレーオフ予想",
    teams: ["1位チーム", "2位チーム", "3位チーム", "ワイルドカード"],
    resultLabels: ["勝者", "準優勝", "ベスト4", "注目枠"],
    basePoints: [10, 7, 5, 3],
  },
  draft: {
    id: "draft",
    sport: "baseball",
    name: "ドラフト",
    subtitle: "選抜型: 指名したチームの到達順位で加点",
    eventName: "選抜ドラフト",
    teams: ["大阪桐蔭", "山梨学院", "八戸光星", "中京大中京", "花咲徳栄", "英明", "智弁学園", "専大松戸"],
    finishPoints: { champion: 100, runnerUp: 70, semifinal: 40, quarterfinal: 10 },
  },
  fightCard: {
    id: "fightCard",
    sport: "boxing",
    name: "ファイトカード",
    subtitle: "ボクシング型: 勝敗・決着方法・ラウンド帯",
    eventName: "5.2ボクシング予想",
    markets: [
      { id: "fight1", label: "井上尚弥 vs 中谷潤人", options: ["井上尚弥 勝利", "中谷潤人 勝利", "井上尚弥 KO", "中谷潤人 KO", "判定"] },
      { id: "fight2", label: "井上拓真 vs 井岡一翔", options: ["井上拓真 勝利", "井岡一翔 勝利", "井上拓真 KO", "井岡一翔 KO", "判定"] },
      { id: "bonus", label: "KOラウンド帯", options: ["なし", "1-3R", "4-6R", "7-9R", "10-12R"] },
    ],
  },
  scoreBonus: {
    id: "scoreBonus",
    sourceTemplate: "fightCard",
    sport: "other",
    name: "スコアボーナス型",
    subtitle: "決勝スコア・総得点・KOラウンドなどの単独ボーナス",
    eventName: "スコアボーナス予想",
    markets: [
      { id: "score", label: "スコア/得点ボーナス", options: ["完全一致", "近似", "高得点", "低得点"] },
      { id: "method", label: "決着/結果ボーナス", options: ["通常決着", "延長", "KO", "判定"] },
    ],
  },
  worldCup: {
    id: "worldCup",
    sport: "soccer",
    name: "W杯3フェーズ",
    subtitle: "GL、決勝T、決勝スコアを合算",
    eventName: "W杯2026予想王",
    groups: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
    countries: ["ブラジル", "フランス", "日本", "アルゼンチン", "イングランド", "スペイン", "ドイツ", "アメリカ", "ポルトガル", "メキシコ", "モロッコ", "ナイジェリア"],
  },
  groupStage: {
    id: "groupStage",
    sourceTemplate: "worldCup",
    sport: "soccer",
    name: "グループ突破型",
    subtitle: "W杯型: グループ突破・順位・到達結果を予想",
    eventName: "グループ突破予想",
    groups: ["A", "B", "C", "D"],
    countries: ["日本", "ブラジル", "フランス", "アルゼンチン", "スペイン", "ドイツ", "アメリカ", "メキシコ"],
  },
  composite: {
    id: "composite",
    sourceTemplate: "worldCup",
    sport: "soccer",
    name: "複合型",
    subtitle: "大型大会型: 複数の予想形式を組み合わせる",
    eventName: "複合ルール大会",
    groups: ["A", "B", "C", "D"],
    countries: ["日本", "ブラジル", "フランス", "アルゼンチン", "スペイン", "ドイツ", "アメリカ", "メキシコ"],
  },
};

const presetRuleDescriptions = {
  rankingOdds: "優勝、準優勝、ベスト4などの順位を予想する型です。WBC、甲子園、W杯の上位予想に向いています。",
  playoff: "クライマックスシリーズやプレーオフの勝ち抜け、シリーズ勝者、注目枠を予想する型です。",
  draft: "参加者がチームや選手を指名し、到達成績に応じてポイントを獲得する型です。",
  fightCard: "格闘技やボクシングの対戦カードごとに、勝者、KO、判定などを予想する型です。",
  scoreBonus: "決勝スコア、総得点、KOラウンドなど、単独のボーナス項目を予想する型です。",
  worldCup: "グループ、決勝トーナメント、順位、表彰などをまとめて扱う大型大会向けの型です。",
  groupStage: "W杯などでグループ突破、順位、到達結果を中心に予想する型です。",
  composite: "複数の予想形式を組み合わせる大型大会向けの型です。W杯2026予想王のような大会に向いています。",
};

const defaultState = {
  leagueName: "G-UNIT 予想リーグ",
  participants: ["和田", "拓洋", "銀次", "いの"],
  activeTemplate: "worldCup",
  approvalPolicy: "half",
  activeEventId: null,
  events: null,
  event: null,
};

let state = loadState();

const els = {
  pages: [...document.querySelectorAll("[data-page]")],
  navLinks: [...document.querySelectorAll("[data-nav-page]")],
  themeToggle: document.querySelector("#themeToggle"),
  themeOptions: [...document.querySelectorAll("[data-theme-label]")],
  homeClubLine: document.querySelector("#homeClubLine"),
  homeParticipantName: document.querySelector("#homeParticipantName"),
  homeOpenCount: document.querySelector("#homeOpenCount"),
  homeMissingTournamentCount: document.querySelector("#homeMissingTournamentCount"),
  homeMonthScore: document.querySelector("#homeMonthScore"),
  homeTotalScore: document.querySelector("#homeTotalScore"),
  homeTournamentCards: document.querySelector("#homeTournamentCards"),
  activeTournamentCards: document.querySelector("#activeTournamentCards"),
  archiveList: document.querySelector("#archiveList"),
  tournamentManageList: document.querySelector("#tournamentManageList"),
  approvalRuleText: document.querySelector("#approvalRuleText"),
  approvalPolicyGroup: document.querySelector("#approvalPolicyGroup"),
  leagueName: document.querySelector("#leagueName"),
  participantList: document.querySelector("#participantList"),
  participantName: document.querySelector("#participantName"),
  addParticipantButton: document.querySelector("#addParticipantButton"),
  templateGrid: document.querySelector("#templateGrid"),
  presetDescription: document.querySelector("#presetDescription"),
  eventTitle: document.querySelector("#eventTitle"),
  eventSubtitle: document.querySelector("#eventSubtitle"),
  eventForm: document.querySelector("#eventForm"),
  newEventButton: document.querySelector("#newEventButton"),
  settingsNewEventButton: document.querySelector("#settingsNewEventButton"),
  newTournamentName: document.querySelector("#newTournamentName"),
  newTournamentSport: document.querySelector("#newTournamentSport"),
  newTournamentTemplate: document.querySelector("#newTournamentTemplate"),
  newTournamentDeadline: document.querySelector("#newTournamentDeadline"),
  newTournamentStatus: document.querySelector("#newTournamentStatus"),
  saveButton: document.querySelector("#saveButton"),
  rankingTabs: document.querySelector("#rankingTabs"),
  rankingFilterPanel: document.querySelector("#rankingFilterPanel"),
  rankingEventSelect: document.querySelector("#rankingEventSelect"),
  resetButton: document.querySelector("#resetButton"),
  scoreboard: document.querySelector("#scoreboard"),
  insightBand: document.querySelector("#insightBand"),
  exportButton: { addEventListener() {} },
  exportDialog: { showModal() {} },
  exportText: { value: "" },
  confirmDialog: document.querySelector("#confirmDialog"),
  confirmSaveButton: document.querySelector("#confirmSaveButton"),
  matchFeatureIcon: document.querySelector("#matchFeatureIcon"),
  matchFeatureTitle: document.querySelector("#matchFeatureTitle"),
  matchFeatureMeta: document.querySelector("#matchFeatureMeta"),
  historyEventName: document.querySelector("#historyEventName"),
  resultEventName: document.querySelector("#resultEventName"),
};

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return createDefaultState();
    const parsed = JSON.parse(stored);
    return normalizeState({ ...createDefaultState(), ...parsed });
  } catch {
    return createDefaultState();
  }
}

function createDefaultState() {
  const base = structuredClone(defaultState);
  const event = createEvent(base.activeTemplate, base.participants, { name: templates.worldCup.eventName });
  base.events = [event];
  base.activeEventId = event.id;
  base.event = event;
  return base;
}

function normalizeState(nextState) {
  let events = Array.isArray(nextState.events) && nextState.events.length
    ? nextState.events
    : [nextState.event || createEvent(nextState.activeTemplate || "worldCup", nextState.participants || [])];
  events = events.map((event) => normalizeEvent(event, nextState));
  const activeEventId = events.some((event) => event.id === nextState.activeEventId)
    ? nextState.activeEventId
    : events[0].id;
  const event = events.find((item) => item.id === activeEventId) || events[0];
  return { ...nextState, events, activeEventId, event, activeTemplate: event.templateId };
}

function normalizeEvent(event, sourceState = state) {
  const templateId = templates[event?.templateId] ? event.templateId : sourceState.activeTemplate || "worldCup";
  const normalized = {
    ...createEvent(templateId, sourceState.participants || defaultState.participants),
    ...event,
    templateId,
  };
  normalized.status ||= "open";
  normalized.deadline ||= "";
  normalized.sport ||= templates[templateId]?.sport || "other";
  normalized.approvalPolicy ||= sourceState.approvalPolicy || "half";
  normalized.config ||= createConfig(templateId);
  normalized.results ||= createResults(templateId);
  normalized.predictions ||= {};
  (sourceState.participants || defaultState.participants).forEach((name) => {
    normalized.predictions[name] ||= createPrediction(templateId);
  });
  return normalized;
}

function persist() {
  syncActiveEvent();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function syncActiveEvent() {
  if (!state.event) return;
  state.events ||= [];
  const index = state.events.findIndex((event) => event.id === state.event.id);
  if (index >= 0) state.events[index] = state.event;
  else state.events.push(state.event);
  state.activeEventId = state.event.id;
  state.activeTemplate = state.event.templateId;
}

const PAGE_IDS = new Set(["home", "active", "prediction", "ranking", "settings"]);
const THEME_KEY = "yoso-theme";

function currentPageId() {
  const id = window.location.hash.replace("#", "") || "home";
  if (id === "matches" || id === "archive" || id === "results" || id === "history") return "active";
  return PAGE_IDS.has(id) ? id : "home";
}

function renderPage() {
  const pageId = currentPageId();
  els.pages.forEach((page) => page.classList.toggle("is-active", page.dataset.page === pageId));
  els.navLinks.forEach((link) => {
    const isActive = link.dataset.navPage === pageId;
    link.classList.toggle("is-active", isActive);
    if (isActive) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
}

function applyTheme(theme) {
  const nextTheme = theme === "day" ? "day" : "dark";
  document.body.dataset.theme = nextTheme;
  localStorage.setItem(THEME_KEY, nextTheme);
  els.themeOptions.forEach((option) => {
    option.classList.toggle("is-active", option.dataset.themeLabel === nextTheme);
  });
}

function sportMeta(templateId) {
  const sport = templates[templateId]?.sport || inferSport(state.event?.name || "");
  const map = {
    soccer: { label: "サッカー", icon: "⚽" },
    baseball: { label: "野球", icon: "⚾" },
    boxing: { label: "ボクシング", icon: "🥊" },
    basketball: { label: "バスケ", icon: "🏀" },
    combat: { label: "格闘技", icon: "🥊" },
    other: { label: "スポーツ", icon: "◌" },
  };
  return map[sport] || map.other;
}

function inferSport(text) {
  if (/W杯|サッカー|soccer|football/i.test(text)) return "soccer";
  if (/WBC|野球|甲子園|baseball/i.test(text)) return "baseball";
  if (/ボクシング|井上|KO|ラウンド|boxing|fight/i.test(text)) return "boxing";
  if (/バスケ|NBA|basket/i.test(text)) return "basketball";
  return "other";
}

function createEvent(templateId, participants, overrides = {}) {
  const template = templates[templateId];
  const predictions = Object.fromEntries(participants.map((name) => [name, createPrediction(templateId)]));
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    templateId,
    name: overrides.name || template.eventName,
    sport: overrides.sport || template.sport || "other",
    status: overrides.status || "open",
    deadline: overrides.deadline || "",
    approvalPolicy: overrides.approvalPolicy || defaultState.approvalPolicy,
    config: createConfig(templateId),
    predictions,
    results: createResults(templateId),
  };
}

function baseTemplateId(templateId = state.event?.templateId) {
  return templates[templateId]?.sourceTemplate || templateId;
}

function createConfig(templateId) {
  const template = templates[templateId];
  const base = baseTemplateId(templateId);
  if (base === "rankingOdds") return { teams: [...(template.teams || templates.rankingOdds.teams)], oddsBook: {} };
  if (base === "draft") return { teams: [...(template.teams || templates.draft.teams)], oddsBook: {} };
  if (base === "fightCard") return { markets: structuredClone(template.markets || templates.fightCard.markets), oddsBook: {} };
  if (base === "worldCup") return { countries: [...(template.countries || templates.worldCup.countries)], oddsBook: {} };
  return {};
}

function createPrediction(templateId) {
  const base = baseTemplateId(templateId);
  if (base === "rankingOdds") return { picks: ["", "", "", ""], odds: [1, 1, 1, 1] };
  if (base === "draft") return { teams: ["", ""], bonusScore: "" };
  if (base === "fightCard") return { picks: {}, odds: {} };
  if (base === "worldCup") return { gl: {}, third: "", top4: ["", "", "", ""], futures: [], awards: {} };
  return {};
}

function createResults(templateId) {
  const base = baseTemplateId(templateId);
  if (base === "rankingOdds") return { finalTop4: ["", "", "", ""] };
  if (base === "draft") return { finishes: {}, scoreBonusWinner: "" };
  if (base === "fightCard") return { winners: {}, bonusWinner: "" };
  if (base === "worldCup") return { gl: {}, thirdQualified: "", top4: ["", "", "", ""], futures: {}, awards: {}, finalScoreWinner: "", exactScore: false };
  return {};
}

function render() {
  if (els.leagueName) els.leagueName.value = state.leagueName;
  renderParticipants();
  renderTemplates();
  renderPresetDescription();
  renderTournamentCreateOptions();
  renderEvent();
  renderScores();
  renderDashboard();
  renderActiveTournaments();
  renderArchive();
  renderTournamentManageList();
  renderRankingEventOptions();
  renderShellMeta();
  renderPage();
  persist();
}

function renderDashboard() {
  const participant = currentParticipantName();
  const scores = calculateScores();
  const myScore = scores.find((row) => row.name === participant)?.score || 0;
  const openEvents = eventsByStatus("open");
  const missingTournamentCount = openEvents.filter((event) => missingPredictionCountForEvent(event, participant) > 0).length;
  const approvalRequired = requiredApprovalCount();

  if (els.homeClubLine) els.homeClubLine.textContent = `${state.leagueName} / ${state.participants.length}人参加中`;
  if (els.homeParticipantName) els.homeParticipantName.textContent = participant;
  if (els.homeOpenCount) els.homeOpenCount.textContent = openEvents.length;
  if (els.homeMissingTournamentCount) els.homeMissingTournamentCount.textContent = missingTournamentCount;
  if (els.homeMonthScore) els.homeMonthScore.textContent = formatScore(myScore);
  if (els.homeTotalScore) els.homeTotalScore.textContent = formatScore(myScore);
  if (els.approvalRuleText) els.approvalRuleText.textContent = `結果確定には${approvalRequired}人の承認が必要`;
  renderApprovalPolicy();

  if (!els.homeTournamentCards) return;
  els.homeTournamentCards.innerHTML = openEvents.length
    ? openEvents.map((event) => {
      const missingCount = missingPredictionCountForEvent(event, participant);
      return tournamentCardMarkup(event, {
        status: "予想受付中",
        statusClass: "open",
        actionLabel: missingCount > 0 ? "予想する" : "入力内容を見る",
        missingCount,
        showDeadline: true,
      });
    }).join("")
    : emptyTournamentMarkup("受付中の大会はありません");
}

function renderActiveTournaments() {
  if (!els.activeTournamentCards) return;
  const activeEvents = eventsByStatus("open", "resultWait");
  els.activeTournamentCards.innerHTML = activeEvents.length
    ? activeEvents.map((event) => event.status === "resultWait"
      ? resultWaitCardMarkup(event)
      : tournamentCardMarkup(event, {
        status: "予想受付中",
        statusClass: "open",
        actionLabel: "予想へ",
        missingCount: missingPredictionCountForEvent(event, currentParticipantName()),
        showDeadline: true,
      })).join("")
    : emptyTournamentMarkup("開催中の大会はありません");
}

function tournamentCardMarkup(event, { status, statusClass, actionLabel, missingCount, showDeadline }) {
  const sport = sportMeta(event.templateId);
  const template = templates[event.templateId];
  const candidateCount = candidateCountForEvent(event);
  const missingText = missingCount > 0 ? `未入力 ${missingCount}項目` : "入力済み";
  return `
    <article class="tournament-card">
      <div class="tournament-main">
        <span class="sport-icon" aria-hidden="true">${sport.icon}</span>
        <div>
          <span class="match-kicker">${escapeHtml(sport.label)} / ${escapeHtml(template?.name || "ルール")}</span>
          <strong>${escapeHtml(event.name || "現在の大会")}</strong>
          <small>${escapeHtml(candidateCount)}件の候補 / ${escapeHtml(state.participants.length)}人参加${event.deadline ? ` / 締切 ${escapeHtml(formatDeadline(event.deadline))}` : ""}</small>
        </div>
      </div>
      <div class="tournament-chips">
        <span class="status-label ${statusClass}">${escapeHtml(status)}</span>
        ${showDeadline ? `<span class="deadline-chip">締切間近</span>` : ""}
        <span class="missing-chip ${missingCount > 0 ? "has-missing" : ""}">${escapeHtml(missingText)}</span>
      </div>
      <div class="tournament-actions">
        <a class="primary-link" href="#prediction" data-event-action="predict" data-event-id="${escapeAttr(event.id)}">${escapeHtml(actionLabel)}</a>
        <a class="ghost-link" href="#active" data-event-action="settings" data-event-id="${escapeAttr(event.id)}">大会編集</a>
      </div>
    </article>
  `;
}

function statusPreviewCardMarkup(status, text, statusClass) {
  const sport = sportMeta(state.event?.templateId);
  return `
    <article class="tournament-card muted-card">
      <div class="tournament-main">
        <span class="sport-icon" aria-hidden="true">${sport.icon}</span>
        <div>
          <span class="match-kicker">Status sample</span>
          <strong>${escapeHtml(status)}</strong>
          <small>${escapeHtml(text)}</small>
        </div>
      </div>
      <div class="tournament-chips">
        <span class="status-label ${statusClass}">${escapeHtml(status)}</span>
      </div>
    </article>
  `;
}

function resultWaitCardMarkup(event) {
  const sport = sportMeta(event.templateId);
  return `
    <article class="tournament-card muted-card">
      <div class="tournament-main">
        <span class="sport-icon" aria-hidden="true">${sport.icon}</span>
        <div>
          <span class="match-kicker">締切後</span>
          <strong>${escapeHtml(event.name || "結果待ち")}</strong>
          <small>締切後は管理者の結果入力と参加者の承認に進みます。</small>
        </div>
      </div>
      <div class="tournament-chips">
        <span class="status-label pending">結果待ち</span>
      </div>
      <div class="tournament-actions">
        <a class="primary-link" href="#active" data-event-action="result" data-event-id="${escapeAttr(event.id)}">結果入力</a>
        <a class="ghost-link" href="#active" data-event-action="approve" data-event-id="${escapeAttr(event.id)}">結果承認</a>
      </div>
    </article>
  `;
}

function emptyTournamentMarkup(message) {
  return `<div class="history-row"><strong>${escapeHtml(message)}</strong><small>設定から大会を追加できます。</small></div>`;
}

function currentParticipantName() {
  return state.participants[0] || "あなた";
}

function eventsByStatus(...statuses) {
  const allowed = new Set(statuses);
  return (state.events || []).filter((event) => allowed.has(event.status || "open"));
}

function setActiveEvent(eventId) {
  const event = (state.events || []).find((item) => item.id === eventId);
  if (!event) return;
  state.event = event;
  state.activeEventId = event.id;
  state.activeTemplate = event.templateId;
}

function candidateCountForCurrentEvent() {
  return candidateCountForEvent(state.event);
}

function candidateCountForEvent(event) {
  const base = baseTemplateId(event?.templateId);
  if (base === "fightCard") {
    const markets = Array.isArray(event.config?.markets) ? event.config.markets : templates.fightCard.markets;
    return markets.length;
  }
  if (base === "worldCup") {
    const countries = Array.isArray(event.config?.countries) ? event.config.countries : templates.worldCup.countries;
    return countries.length;
  }
  const teams = Array.isArray(event.config?.teams) ? event.config.teams : templates[base]?.teams || [];
  return teams.length;
}

function requiredApprovalCount() {
  const policy = state.event?.approvalPolicy || state.approvalPolicy;
  if (policy === "admin") return 1;
  if (policy === "unanimous") return Math.max(1, state.participants.length);
  return Math.max(1, Math.ceil(state.participants.length / 2));
}

function renderApprovalPolicy() {
  if (!els.approvalPolicyGroup) return;
  const policy = state.event?.approvalPolicy || state.approvalPolicy || "half";
  els.approvalPolicyGroup.querySelectorAll("[data-approval-policy]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.approvalPolicy === policy);
  });
}

function missingPredictionCount(name) {
  return missingPredictionCountForEvent(state.event, name);
}

function missingPredictionCountForEvent(event, name) {
  ensurePredictionForEvent(event, name);
  const prediction = event.predictions[name];
  const base = baseTemplateId(event.templateId);
  if (base === "rankingOdds") {
    return prediction.picks.filter((pick) => !pick).length;
  }
  if (base === "draft") {
    return prediction.teams.filter((team) => !team).length;
  }
  if (base === "fightCard") {
    return (event.config?.markets || templates.fightCard.markets).filter((market) => !prediction.picks[market.id]).length;
  }
  if (base === "worldCup") {
    return prediction.top4.filter((country) => !country).length;
  }
  return 0;
}

function ensurePredictionForEvent(event, name) {
  event.predictions ||= {};
  if (!event.predictions[name]) event.predictions[name] = createPrediction(event.templateId);
}

function formatDeadline(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function renderTournamentCreateOptions() {
  if (!els.newTournamentTemplate) return;
  const currentValue = els.newTournamentTemplate.value || state.activeTemplate;
  els.newTournamentTemplate.innerHTML = Object.values(templates).map((template) => (
    `<option value="${escapeAttr(template.id)}" ${template.id === currentValue ? "selected" : ""}>${escapeHtml(template.name)}</option>`
  )).join("");
}

function createTournamentFromSettings({ fallbackName } = {}) {
  const templateId = els.newTournamentTemplate?.value || state.activeTemplate || "rankingOdds";
  const template = templates[templateId] || templates.rankingOdds;
  const name = els.newTournamentName?.value.trim() || fallbackName || template.eventName;
  const event = createEvent(templateId, state.participants, {
    name,
    sport: els.newTournamentSport?.value || template.sport || "other",
    deadline: els.newTournamentDeadline?.value || "",
    status: els.newTournamentStatus?.value || "open",
    approvalPolicy: state.approvalPolicy || "half",
  });
  return event;
}

function addAndSelectEvent(event) {
  state.events ||= [];
  state.events.push(event);
  setActiveEvent(event.id);
  if (els.newTournamentName) els.newTournamentName.value = "";
}

function renderRankingEventOptions() {
  if (!els.rankingEventSelect) return;
  const currentValue = els.rankingEventSelect.value;
  els.rankingEventSelect.innerHTML = [
    `<option value="">全大会</option>`,
    ...(state.events || []).map((event) => `<option value="${escapeAttr(event.id)}">${escapeHtml(event.name)}</option>`),
  ].join("");
  if ([...els.rankingEventSelect.options].some((option) => option.value === currentValue)) {
    els.rankingEventSelect.value = currentValue;
  }
}

function renderArchive() {
  if (!els.archiveList) return;
  const archived = eventsByStatus("archive");
  els.archiveList.innerHTML = archived.length
    ? archived.map((event) => `
      <div class="history-row">
        <span>${escapeHtml(sportMeta(event.templateId).label)} / ${escapeHtml(templates[event.templateId]?.name || "ルール")}</span>
        <strong>${escapeHtml(event.name)}</strong>
        <small>参加者 ${state.participants.length}人 / 大会別ランキングと振り返り用に保存</small>
      </div>
    `).join("")
    : `<div class="history-row"><strong>アーカイブ済みの大会はまだありません</strong><small>結果確定後の大会がここに入ります。</small></div>`;
}

function renderTournamentManageList() {
  if (!els.tournamentManageList) return;
  const events = state.events || [];
  els.tournamentManageList.innerHTML = events.length
    ? events.map((event) => {
      const isActive = event.id === state.activeEventId;
      return `
        <article class="tournament-manage-row ${isActive ? "is-active" : ""}">
          <div>
            <span>${escapeHtml(statusLabel(event.status))} / ${escapeHtml(templates[event.templateId]?.name || "ルール")}</span>
            <strong>${escapeHtml(event.name)}</strong>
            <small>${escapeHtml(sportMeta(event.templateId).label)}${event.deadline ? ` / 締切 ${escapeHtml(formatDeadline(event.deadline))}` : ""}</small>
          </div>
          <div class="tournament-manage-actions">
            <button type="button" data-event-manage="select" data-event-id="${escapeAttr(event.id)}">選択</button>
            <button type="button" data-event-status="open" data-event-id="${escapeAttr(event.id)}">受付</button>
            <button type="button" data-event-status="resultWait" data-event-id="${escapeAttr(event.id)}">結果待ち</button>
            <button type="button" data-event-status="archive" data-event-id="${escapeAttr(event.id)}">アーカイブ</button>
            <button type="button" class="danger-action" data-event-delete data-event-id="${escapeAttr(event.id)}">削除</button>
          </div>
        </article>
      `;
    }).join("")
    : emptyTournamentMarkup("大会はまだありません");
}

function statusLabel(status) {
  if (status === "resultWait") return "結果待ち";
  if (status === "archive") return "アーカイブ";
  return "予想受付中";
}

function renderParticipants() {
  if (!els.participantList) return;
  els.participantList.innerHTML = "";
  state.participants.forEach((name) => {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.innerHTML = `<span>${escapeHtml(name)}</span><button type="button" aria-label="${escapeHtml(name)}を削除">×</button>`;
    chip.querySelector("button").addEventListener("click", () => {
      state.participants = state.participants.filter((item) => item !== name);
      (state.events || []).forEach((event) => delete event.predictions?.[name]);
      render();
    });
    els.participantList.append(chip);
  });
}

function renderTemplates() {
  if (!els.templateGrid) return;
  els.templateGrid.innerHTML = "";
  Object.values(templates).forEach((template) => {
    const button = document.createElement("button");
    button.className = `template-card ${template.id === state.activeTemplate ? "active" : ""}`;
    button.innerHTML = `<strong>${template.name}</strong><span>${template.subtitle}</span>`;
    button.addEventListener("click", () => {
      state.activeTemplate = template.id;
      if (els.newTournamentTemplate) els.newTournamentTemplate.value = template.id;
      render();
    });
    els.templateGrid.append(button);
  });
}

function renderPresetDescription() {
  if (!els.presetDescription) return;
  const template = templates[state.activeTemplate] || templates.worldCup;
  els.presetDescription.innerHTML = `
    <strong>${escapeHtml(template.name)}</strong>
    <span>${escapeHtml(presetRuleDescriptions[template.id] || template.subtitle || "")}</span>
  `;
}

function renderEvent() {
  const template = templates[state.event.templateId];
  els.eventTitle.textContent = state.event.name;
  els.eventSubtitle.textContent = template.subtitle;
  const base = baseTemplateId(template.id);
  if (base === "rankingOdds") renderRankingOddsForm();
  if (base === "draft") renderDraftForm();
  if (base === "fightCard") renderFightForm();
  if (base === "worldCup") renderWorldCupForm();
}

function renderRankingOddsForm() {
  const template = { ...templates.rankingOdds, ...templates[state.event.templateId] };
  const teams = getTeams();
  els.eventForm.innerHTML = `
    <div class="form-grid">
      <label class="field"><span>イベント名</span><input data-path="event.name" value="${escapeAttr(state.event.name)}"></label>
      ${template.resultLabels.map((label, index) => `
        <label class="field"><span>結果 ${label}</span>
          <select data-result-index="${index}">${optionList(teams, state.event.results.finalTop4[index])}</select>
        </label>`).join("")}
    </div>
    ${editableTeamsBlock("候補チーム/国", teams)}
    ${oddsToolsBlock("候補別オッズ", teams)}
    ${state.participants.map((name) => participantRankingBlock(name, template, teams)).join("")}
  `;
  bindGenericInputs();
}

function participantRankingBlock(name, template, teams) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  return `
    <div class="entry-block">
      <h3>${escapeHtml(name)}</h3>
      <div class="prediction-grid">
        ${template.resultLabels.map((label, index) => `
          <label class="field">
            <span>${label}予想</span>
            <select data-pick="${escapeAttr(name)}:${index}">${optionList(teams, prediction.picks[index])}</select>
          </label>
          <label class="field">
            <span>オッズ</span>
            <input data-odds="${escapeAttr(name)}:${index}" type="number" min="0" step="0.1" value="${prediction.odds[index] || 1}">
          </label>
        `).join("")}
      </div>
    </div>
  `;
}

function renderDraftForm() {
  const template = { ...templates.draft, ...templates[state.event.templateId] };
  const teams = getTeams();
  els.eventForm.innerHTML = `
    <div class="form-grid">
      <label class="field"><span>イベント名</span><input data-path="event.name" value="${escapeAttr(state.event.name)}"></label>
      <label class="field"><span>スコア予想ボーナス勝者</span><select data-result-key="scoreBonusWinner">${optionList(["", ...state.participants], state.event.results.scoreBonusWinner)}</select></label>
    </div>
    ${editableTeamsBlock("出場チーム", teams)}
    ${oddsToolsBlock("参考オッズ", teams)}
    <div class="entry-block">
      <h3>チーム到達結果</h3>
      ${teams.map((team) => `
        <div class="draft-row">
          <span class="pill">${escapeHtml(team)}</span>
          <select data-finish="${escapeAttr(team)}">
            ${optionList(["", "champion", "runnerUp", "semifinal", "quarterfinal"], state.event.results.finishes[team])}
          </select>
          <span class="sub-label">${finishLabel(state.event.results.finishes[team])}</span>
        </div>
      `).join("")}
    </div>
    ${state.participants.map((name) => participantDraftBlock(name, teams)).join("")}
  `;
  bindGenericInputs();
}

function participantDraftBlock(name, teams) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  return `
    <div class="entry-block">
      <h3>${escapeHtml(name)}</h3>
      <div class="form-grid">
        <label class="field"><span>指名1</span><select data-draft="${escapeAttr(name)}:0">${optionList(teams, prediction.teams[0])}</select></label>
        <label class="field"><span>指名2</span><select data-draft="${escapeAttr(name)}:1">${optionList(teams, prediction.teams[1])}</select></label>
      </div>
    </div>
  `;
}

function renderFightForm() {
  const markets = getMarkets();
  els.eventForm.innerHTML = `
    <div class="form-grid">
      <label class="field"><span>イベント名</span><input data-path="event.name" value="${escapeAttr(state.event.name)}"></label>
      <label class="field"><span>KOラウンドボーナス勝者</span><select data-result-key="bonusWinner">${optionList(["", ...state.participants], state.event.results.bonusWinner)}</select></label>
    </div>
    ${editableMarketsBlock(markets)}
    ${oddsToolsBlock("カード別オッズ", marketOddsKeys(markets))}
    <div class="entry-block">
      <h3>確定結果</h3>
      ${markets.map((market) => `
        <div class="market-row">
          <span class="pill">${escapeHtml(market.label)}</span>
          <select data-market-result="${market.id}">${optionList(market.options, state.event.results.winners[market.id])}</select>
          <span></span>
        </div>
      `).join("")}
    </div>
    ${state.participants.map((name) => participantFightBlock(name, markets)).join("")}
  `;
  bindGenericInputs();
}

function participantFightBlock(name, markets) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  return `
    <div class="entry-block">
      <h3>${escapeHtml(name)}</h3>
      ${markets.map((market) => `
        <div class="market-row">
          <label class="field">
            <span>${escapeHtml(market.label)}</span>
            <select data-fight-pick="${escapeAttr(name)}:${market.id}">${optionList(market.options, prediction.picks[market.id])}</select>
          </label>
          <label class="field">
            <span>獲得pt</span>
            <input data-fight-odds="${escapeAttr(name)}:${market.id}" type="number" min="0" step="0.1" value="${formatOddsInput(prediction.odds[market.id] || 0)}">
          </label>
          <span></span>
        </div>
      `).join("")}
    </div>
  `;
}

function renderWorldCupForm() {
  const template = { ...templates.worldCup, ...templates[state.event.templateId] };
  const countries = getCountries();
  els.eventForm.innerHTML = `
    <div class="form-grid">
      <label class="field"><span>イベント名</span><input data-path="event.name" value="${escapeAttr(state.event.name)}"></label>
      <label class="field"><span>決勝スコア勝者</span><select data-result-key="finalScoreWinner">${optionList(["", ...state.participants], state.event.results.finalScoreWinner)}</select></label>
    </div>
    <div class="entry-block">
      <h3>大会結果</h3>
      <div class="prediction-grid">
        ${[0, 1, 2, 3].map((index) => `
          <label class="field"><span>${index + 1}位</span><select data-wc-top-result="${index}">${optionList(countries, state.event.results.top4[index])}</select></label>
        `).join("")}
      </div>
      <label class="field"><span>3位突破国メモ</span><input data-path="event.results.thirdQualified" value="${escapeAttr(state.event.results.thirdQualified)}"></label>
      <label class="field"><span>スコア完全一致</span><select data-result-key="exactScore">${optionList(["false", "true"], String(state.event.results.exactScore))}</select></label>
    </div>
    ${editableCountriesBlock(countries)}
    ${oddsToolsBlock("候補国別オッズ", countries)}
    <div class="entry-block">
      <h3>複勝用の到達結果</h3>
      ${countries.map((country) => `
        <div class="draft-row">
          <span class="pill">${escapeHtml(country)}</span>
          <select data-wc-country-finish="${escapeAttr(country)}">${optionList(["", "best16", "best8", "fourth", "third", "runnerUp", "champion"], state.event.results.futures[country])}</select>
          <span class="sub-label">${labelForOption(state.event.results.futures[country]) || "未確定"}</span>
        </div>
      `).join("")}
    </div>
    ${state.participants.map((name) => participantWorldCupBlock(name, countries)).join("")}
  `;
  bindGenericInputs();
}

function participantWorldCupBlock(name, countries) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  return `
    <div class="entry-block">
      <h3>${escapeHtml(name)}</h3>
      <div class="prediction-grid">
        ${[0, 1, 2, 3].map((index) => `
          <label class="field"><span>単勝 ${index + 1}位</span><select data-wc-top-pick="${escapeAttr(name)}:${index}">${optionList(countries, prediction.top4[index])}</select></label>
        `).join("")}
      </div>
      <div class="entry-block">
        <h3>複勝枠</h3>
        ${Array.from({ length: 5 }).map((_, index) => {
          const future = prediction.futures[index] || { country: "", finish: "", odds: 1 };
          return `
            <div class="phase-row">
              <select data-wc-future-country="${escapeAttr(name)}:${index}">${optionList(countries, future.country)}</select>
              <select data-wc-future-finish="${escapeAttr(name)}:${index}">${optionList(["", "champion", "runnerUp", "third", "fourth", "best8", "best16"], future.finish)}</select>
              <input data-wc-future-odds="${escapeAttr(name)}:${index}" type="number" min="0" max="200" step="0.1" value="${future.odds || 1}">
              <span class="sub-label">上限200倍</span>
            </div>
          `;
        }).join("")}
      </div>
      <label class="field"><span>第1回GL得点</span><input data-wc-gl-score="${escapeAttr(name)}" type="number" min="0" step="1" value="${prediction.glScore || 0}"></label>
      <label class="field"><span>個人賞得点</span><input data-wc-award-score="${escapeAttr(name)}" type="number" min="0" step="1" value="${prediction.awardScore || 0}"></label>
    </div>
  `;
}

function bindGenericInputs() {
  els.eventForm.querySelectorAll("[data-path]").forEach((input) => {
    input.addEventListener("input", () => setByPath(input.dataset.path, coerceValue(input.value)));
  });
  els.eventForm.querySelectorAll("[data-list-row]").forEach((input) => {
    input.addEventListener("change", () => {
      const [key, indexRaw] = input.dataset.listRow.split(":");
      ensureEditableList(key);
      state.event.config[key][Number(indexRaw)] = input.value.trim();
      state.event.config[key] = state.event.config[key].filter(Boolean);
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-list-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const list = ensureEditableList(button.dataset.listAdd);
      list.push("");
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-list-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const [key, indexRaw] = button.dataset.listRemove.split(":");
      const list = ensureEditableList(key);
      list.splice(Number(indexRaw), 1);
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-config-list]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.config[input.dataset.configList] = parseLines(input.value);
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-market-label]").forEach((input) => {
    input.addEventListener("change", () => {
      const market = getMarkets()[Number(input.dataset.marketLabel)];
      if (!market) return;
      const nextLabel = input.value.trim() || market.label;
      if (nextLabel !== market.label) {
        market.options.forEach((option) => migrateOddsKey(marketOddsKey(market, option), `${nextLabel} / ${option}`));
        market.label = nextLabel;
      }
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-market-option]").forEach((input) => {
    input.addEventListener("change", () => {
      const [marketIndexRaw, optionIndexRaw] = input.dataset.marketOption.split(":");
      const market = getMarkets()[Number(marketIndexRaw)];
      if (!market) return;
      const optionIndex = Number(optionIndexRaw);
      const previousOption = market.options[optionIndex];
      const nextOption = input.value.trim() || previousOption;
      if (nextOption !== previousOption) {
        migrateOddsKey(`${market.label} / ${previousOption}`, `${market.label} / ${nextOption}`);
        market.options[optionIndex] = nextOption;
      }
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-market-option-odds]").forEach((input) => {
    input.addEventListener("change", () => {
      const [marketIndexRaw, optionIndexRaw] = input.dataset.marketOptionOdds.split(":");
      const market = getMarkets()[Number(marketIndexRaw)];
      if (!market) return;
      const option = market.options[Number(optionIndexRaw)];
      setOddsBookValue(marketOddsKey(market, option), input.value);
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-market-option-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const market = getMarkets()[Number(button.dataset.marketOptionAdd)];
      if (!market) return;
      market.options.push("");
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-market-option-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const [marketIndexRaw, optionIndexRaw] = button.dataset.marketOptionRemove.split(":");
      const market = getMarkets()[Number(marketIndexRaw)];
      if (!market) return;
      const [removed] = market.options.splice(Number(optionIndexRaw), 1);
      delete state.event.config.oddsBook?.[marketOddsKey(market, removed)];
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-market-add]").forEach((button) => {
    button.addEventListener("click", () => {
      ensureConfig();
      state.event.config.markets ||= [];
      state.event.config.markets.push({ id: uniqueMarketId(), label: "", options: ["", ""] });
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-market-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const market = getMarkets()[Number(button.dataset.marketRemove)];
      if (!market) return;
      market.options.forEach((option) => delete state.event.config.oddsBook?.[marketOddsKey(market, option)]);
      state.event.config.markets.splice(Number(button.dataset.marketRemove), 1);
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-config-markets]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.config.markets = parseMarkets(input.value);
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-odds-key], [data-odds-value]").forEach((input) => {
    input.addEventListener("change", () => {
      const row = input.closest("[data-odds-row]");
      if (!row) return;
      const previousKey = row.dataset.oddsRow;
      const nextKey = row.querySelector("[data-odds-key]").value.trim();
      const nextValue = row.querySelector("[data-odds-value]").value;
      if (previousKey && previousKey !== nextKey) delete state.event.config.oddsBook?.[previousKey];
      setOddsBookValue(nextKey, nextValue);
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-odds-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      ensureConfig();
      delete state.event.config.oddsBook?.[button.dataset.oddsRemove];
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-odds-add]").forEach((button) => {
    button.addEventListener("click", () => {
      ensureConfig();
      state.event.config.oddsBook ||= {};
      let index = Object.keys(state.event.config.oddsBook).length + 1;
      while (state.event.config.oddsBook[`新規候補 ${index}`] !== undefined) index += 1;
      state.event.config.oddsBook[`新規候補 ${index}`] = 1;
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-odds-book]").forEach((input) => {
    input.addEventListener("change", () => {
      ensureConfig();
      state.event.config.oddsBook = parseOddsBook(input.value);
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-odds-action]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.oddsAction === "popularity") {
        generatePopularityOdds();
      }
      if (button.dataset.oddsAction === "apply") {
        applyOddsBookToPredictions();
      }
      if (button.dataset.oddsAction === "import") {
        const textarea = button.closest(".odds-tools")?.querySelector("[data-odds-book-import]");
        if (textarea) state.event.config.oddsBook = { ...(state.event.config.oddsBook || {}), ...parseOddsBook(textarea.value) };
      }
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-result-index]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.results.finalTop4[Number(input.dataset.resultIndex)] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-pick]").forEach((input) => {
    input.addEventListener("change", () => {
      const [name, index] = input.dataset.pick.split(":");
      state.event.predictions[name].picks[Number(index)] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-odds]").forEach((input) => {
    input.addEventListener("input", () => {
      const [name, index] = input.dataset.odds.split(":");
      state.event.predictions[name].odds[Number(index)] = Number(input.value) || 0;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-result-key]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.results[input.dataset.resultKey] = coerceValue(input.value);
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-finish]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.results.finishes[input.dataset.finish] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-draft]").forEach((input) => {
    input.addEventListener("change", () => {
      const [name, index] = input.dataset.draft.split(":");
      state.event.predictions[name].teams[Number(index)] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-market-result]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.results.winners[input.dataset.marketResult] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-fight-pick]").forEach((input) => {
    input.addEventListener("change", () => {
      const [name, market] = input.dataset.fightPick.split(":");
      state.event.predictions[name].picks[market] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-fight-odds]").forEach((input) => {
    input.addEventListener("input", () => {
      const [name, market] = input.dataset.fightOdds.split(":");
      state.event.predictions[name].odds[market] = Math.round((Number(input.value) || 0) * 10) / 10;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-top-result]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.results.top4[Number(input.dataset.wcTopResult)] = input.value;
      syncTop4FutureResults();
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-country-finish]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.results.futures[input.dataset.wcCountryFinish] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-top-pick]").forEach((input) => {
    input.addEventListener("change", () => {
      const [name, index] = input.dataset.wcTopPick.split(":");
      state.event.predictions[name].top4[Number(index)] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-future-country], [data-wc-future-finish], [data-wc-future-odds]").forEach((input) => {
    input.addEventListener("input", updateFutureInput);
    input.addEventListener("change", updateFutureInput);
  });
  els.eventForm.querySelectorAll("[data-wc-gl-score]").forEach((input) => {
    input.addEventListener("input", () => {
      state.event.predictions[input.dataset.wcGlScore].glScore = Number(input.value) || 0;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-award-score]").forEach((input) => {
    input.addEventListener("input", () => {
      state.event.predictions[input.dataset.wcAwardScore].awardScore = Number(input.value) || 0;
      renderScoresOnly();
    });
  });
}

function updateFutureInput(event) {
  const attr = Object.keys(event.target.dataset)[0];
  const [name, indexRaw] = event.target.dataset[attr].split(":");
  const index = Number(indexRaw);
  const prediction = state.event.predictions[name];
  prediction.futures[index] ||= { country: "", finish: "", odds: 1 };
  const future = prediction.futures[index];
  if (attr === "wcFutureCountry") future.country = event.target.value;
  if (attr === "wcFutureFinish") future.finish = event.target.value;
  if (attr === "wcFutureOdds") future.odds = Math.min(200, Number(event.target.value) || 0);
  renderScoresOnly();
}

function renderScoresOnly() {
  if (els.eventTitle) els.eventTitle.textContent = state.event.name;
  renderScores();
  renderDashboard();
  renderActiveTournaments();
  renderShellMeta();
  persist();
}

function renderShellMeta() {
  if (els.matchFeatureTitle) els.matchFeatureTitle.textContent = state.event?.name || "現在のイベント";
  if (els.matchFeatureMeta) {
    const template = templates[state.event?.templateId];
    const base = baseTemplateId(state.event?.templateId);
    const count = base === "fightCard"
      ? getMarkets().length
      : base === "worldCup"
        ? getCountries().length
        : getTeams().length;
    els.matchFeatureMeta.textContent = `${template?.name || "ルール"} / ${count}件の候補`;
  }
  if (els.historyEventName) els.historyEventName.textContent = state.event?.name || "未保存";
  if (els.resultEventName) els.resultEventName.textContent = state.event?.name || "未設定";
}

function legacyEditableTeamsBlock(title, teams) {
  return `
    <div class="entry-block">
      <h3>${escapeHtml(title)}</h3>
      <label class="field">
        <span>1行に1チームずつ入力</span>
        <textarea data-config-list="teams">${escapeHtml(teams.join("\n"))}</textarea>
      </label>
    </div>
  `;
}

function legacyEditableCountriesBlock(countries) {
  return `
    <div class="entry-block">
      <h3>出場国/候補国</h3>
      <label class="field">
        <span>1行に1カ国ずつ入力</span>
        <textarea data-config-list="countries">${escapeHtml(countries.join("\n"))}</textarea>
      </label>
    </div>
  `;
}

function legacyEditableMarketsBlock(markets) {
  return `
    <div class="entry-block">
      <h3>対戦カード/予想項目</h3>
      <label class="field">
        <span>形式: カード名 | 選択肢1, 選択肢2, 選択肢3</span>
        <textarea data-config-markets="markets">${escapeHtml(formatMarkets(markets))}</textarea>
      </label>
    </div>
  `;
}

function legacyOddsToolsBlock(title, keys) {
  ensureConfig();
  const oddsBook = state.event.config.oddsBook || {};
  const knownKeys = Array.from(new Set([...keys, ...Object.keys(oddsBook)]));
  const rows = knownKeys.map((key) => `${key}, ${oddsBook[key] ?? ""}`).join("\n");
  return `
    <div class="entry-block">
      <h3>${escapeHtml(title)}</h3>
      <label class="field">
        <span>形式: 候補名, オッズ。カード別は「カード名 / 選択肢, オッズ」</span>
        <textarea data-odds-book="oddsBook">${escapeHtml(rows)}</textarea>
      </label>
      <div class="inline-form">
        <button type="button" data-odds-action="popularity">人気度から倍率生成</button>
        <button type="button" data-odds-action="apply">選択済みに適用</button>
      </div>
    </div>
  `;
}

function editableTeamsBlock(title, teams) {
  return editableListBlock(title, "teams", teams, "候補を追加");
}

function editableCountriesBlock(countries) {
  return editableListBlock("出場国/候補国", "countries", countries, "国を追加");
}

function editableListBlock(title, key, items, addLabel) {
  return `
    <div class="entry-block">
      <div class="block-head">
        <h3>${escapeHtml(title)}</h3>
        <button class="ghost-button small-button" type="button" data-list-add="${escapeAttr(key)}">＋ ${escapeHtml(addLabel)}</button>
      </div>
      <div class="edit-list">
        ${items.map((item, index) => `
          <div class="edit-row">
            <label class="field compact-field">
              <span>候補名</span>
              <input data-list-row="${escapeAttr(key)}:${index}" value="${escapeAttr(item)}" placeholder="例: 日本 / 大阪桐蔭 / 選手名">
            </label>
            <button class="icon-button danger-button" type="button" data-list-remove="${escapeAttr(key)}:${index}" aria-label="削除">×</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function editableMarketsBlock(markets) {
  const visibleMarkets = markets.length ? markets : [{ id: uniqueMarketId(), label: "", options: ["", ""] }];
  return `
    <div class="entry-block">
      <div class="block-head">
        <h3>対戦カード/予想項目</h3>
        <button class="ghost-button small-button" type="button" data-market-add="1">＋ カードを追加</button>
      </div>
      <div class="market-editor-list">
        ${visibleMarkets.map((market, marketIndex) => `
          <div class="market-editor">
            <div class="market-editor-head">
              <label class="field compact-field market-title-field">
                <span>カード名/予想項目名</span>
                <input class="market-title-input" data-market-label="${marketIndex}" value="${escapeAttr(market.label)}" placeholder="例: 井上尚弥 vs 中谷潤人">
              </label>
              <button class="icon-button danger-button" type="button" data-market-remove="${marketIndex}" aria-label="カード削除">×</button>
            </div>
            <div class="option-editor-head">
              <span>選択肢</span>
              <span>基準オッズ/pt</span>
              <span></span>
            </div>
            ${market.options.map((option, optionIndex) => `
              <div class="option-editor-row">
                <input data-market-option="${marketIndex}:${optionIndex}" value="${escapeAttr(option)}" placeholder="例: 井上尚弥 KO">
                <input data-market-option-odds="${marketIndex}:${optionIndex}" type="number" min="0" step="0.1" value="${escapeAttr(formatOddsInput(lookupMarketOdds(market, option, "")))}" placeholder="例: 2.1">
                <button class="icon-button danger-button" type="button" data-market-option-remove="${marketIndex}:${optionIndex}" aria-label="選択肢削除">×</button>
              </div>
            `).join("")}
            <button class="ghost-button small-button" type="button" data-market-option-add="${marketIndex}">＋ 選択肢を追加</button>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function oddsToolsBlock(title, keys) {
  ensureConfig();
  const oddsBook = state.event.config.oddsBook || {};
  const knownKeys = Array.from(new Set([...keys, ...Object.keys(oddsBook)])).filter(Boolean);
  const rows = knownKeys.length ? knownKeys : [""];
  return `
    <details class="entry-block odds-tools">
      <summary class="odds-summary">
        <span>
          <strong>${escapeHtml(title)}</strong>
          <small>必要な時だけ開いて、全体の基準オッズをまとめて調整します。</small>
        </span>
      </summary>
      <div class="odds-tools-body">
        <div class="block-head">
          <div>
            <h3>${escapeHtml(title)}</h3>
            <p class="helper-text">ここが全体の基準オッズ表です。下の「予想欄へオッズ反映」で、各メンバーが選択済みの予想にこの値をコピーします。</p>
          </div>
          <button class="ghost-button small-button" type="button" data-odds-add="1">＋ 行を追加</button>
        </div>
        <div class="odds-table">
          <div class="odds-table-head">
            <span>候補/カード別選択肢</span>
            <span>オッズ/pt</span>
            <span></span>
          </div>
          ${rows.map((key) => `
            <div class="odds-row" data-odds-row="${escapeAttr(key)}">
              <input data-odds-key="1" value="${escapeAttr(key)}" placeholder="例: 日本 / 井上尚弥 vs 中谷潤人 / 井上尚弥 KO">
              <input data-odds-value="1" type="number" min="0" step="0.1" value="${escapeAttr(formatOddsInput(oddsBook[key] ?? ""))}" placeholder="例: 2.4">
              <button class="icon-button danger-button" type="button" data-odds-remove="${escapeAttr(key)}" aria-label="オッズ行削除">×</button>
            </div>
          `).join("")}
        </div>
        <div class="inline-form odds-actions">
          <button type="button" data-odds-action="popularity">人気度から倍率生成</button>
          <button type="button" data-odds-action="apply">予想欄へオッズ反映</button>
        </div>
        <details class="bulk-import">
          <summary>CSV貼り付けで一括取り込み</summary>
          <label class="field">
            <span>候補名, オッズ / カード名 / 選択肢, オッズ</span>
            <textarea data-odds-book-import>${escapeHtml(knownKeys.map((key) => `${key}, ${oddsBook[key] ?? ""}`).join("\n"))}</textarea>
          </label>
          <button class="ghost-button" type="button" data-odds-action="import">貼り付け内容をオッズ表に反映</button>
        </details>
      </div>
    </details>
  `;
}

function getTeams() {
  ensureConfig();
  const base = baseTemplateId(state.event.templateId);
  return Array.isArray(state.event.config.teams) ? state.event.config.teams : templates[state.event.templateId].teams || templates[base]?.teams || [];
}

function getCountries() {
  ensureConfig();
  return Array.isArray(state.event.config.countries) ? state.event.config.countries : templates[state.event.templateId].countries || templates.worldCup.countries;
}

function getMarkets() {
  ensureConfig();
  return Array.isArray(state.event.config.markets) ? state.event.config.markets : templates[state.event.templateId].markets || templates.fightCard.markets;
}

function ensureConfig() {
  if (!state.event.config) state.event.config = createConfig(state.event.templateId);
}

function ensureEditableList(key) {
  ensureConfig();
  if (Array.isArray(state.event.config[key])) return state.event.config[key];
  if (key === "countries") state.event.config[key] = [...getCountries()];
  else if (key === "teams") state.event.config[key] = [...getTeams()];
  else state.event.config[key] = [];
  return state.event.config[key];
}

function parseLines(value) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMarkets(value) {
  return value
    .split(/\r?\n/)
    .map((line, index) => {
      const [labelPart, optionsPart] = line.split("|");
      const label = labelPart?.trim();
      if (!label) return null;
      const options = (optionsPart || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return {
        id: `market${index + 1}`,
        label,
        options: options.length ? options : ["的中", "外れ"],
      };
    })
    .filter(Boolean);
}

function formatMarkets(markets) {
  return markets.map((market) => `${market.label} | ${market.options.join(", ")}`).join("\n");
}

function parseOddsBook(value) {
  const oddsBook = {};
  value.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const parts = trimmed.split(/,|\t/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return;
    const odds = Number(parts.at(-1));
    if (!Number.isFinite(odds) || odds <= 0) return;
    const key = parts.slice(0, -1).join(" / ");
    oddsBook[key] = odds;
  });
  return oddsBook;
}

function marketOddsKeys(markets) {
  return markets.flatMap((market) => market.options.map((option) => marketOddsKey(market, option)));
}

function marketOddsKey(market, option) {
  return `${market.label} / ${option}`;
}

function lookupOdds(key, fallback = 1) {
  ensureConfig();
  const value = state.event.config.oddsBook?.[key];
  return Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
}

function lookupMarketOdds(market, option, fallback = 0) {
  return lookupOdds(marketOddsKey(market, option), lookupOdds(option, fallback));
}

function setOddsBookValue(key, value) {
  ensureConfig();
  state.event.config.oddsBook ||= {};
  const normalizedKey = String(key || "").trim();
  const odds = Number(value);
  if (!normalizedKey || !Number.isFinite(odds) || odds <= 0) {
    if (normalizedKey) delete state.event.config.oddsBook[normalizedKey];
    return;
  }
  state.event.config.oddsBook[normalizedKey] = Math.round(odds * 10) / 10;
}

function migrateOddsKey(previousKey, nextKey) {
  ensureConfig();
  if (!previousKey || !nextKey || previousKey === nextKey) return;
  const oddsBook = state.event.config.oddsBook || {};
  if (oddsBook[previousKey] === undefined || oddsBook[nextKey] !== undefined) return;
  oddsBook[nextKey] = oddsBook[previousKey];
  delete oddsBook[previousKey];
}

function uniqueMarketId() {
  const ids = new Set((state.event.config?.markets || []).map((market) => market.id));
  let index = ids.size + 1;
  while (ids.has(`market${index}`)) index += 1;
  return `market${index}`;
}

function generatePopularityOdds() {
  ensureConfig();
  const templateId = baseTemplateId(state.event.templateId);
  const counts = new Map();
  const add = (key) => {
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  };

  if (templateId === "rankingOdds") {
    state.participants.forEach((name) => (state.event.predictions[name]?.picks || []).forEach(add));
    state.event.config.oddsBook = buildPopularityOdds(getTeams(), counts);
  }
  if (templateId === "draft") {
    state.participants.forEach((name) => (state.event.predictions[name]?.teams || []).forEach(add));
    state.event.config.oddsBook = buildPopularityOdds(getTeams(), counts);
  }
  if (templateId === "fightCard") {
    const markets = getMarkets();
    state.participants.forEach((name) => {
      const picks = state.event.predictions[name]?.picks || {};
      markets.forEach((market) => {
        if (picks[market.id]) add(marketOddsKey(market, picks[market.id]));
      });
    });
    state.event.config.oddsBook = buildPopularityOdds(marketOddsKeys(markets), counts);
  }
  if (templateId === "worldCup") {
    state.participants.forEach((name) => {
      const prediction = state.event.predictions[name] || {};
      (prediction.top4 || []).forEach(add);
      (prediction.futures || []).forEach((future) => add(future?.country));
    });
    state.event.config.oddsBook = buildPopularityOdds(getCountries(), counts);
  }
}

function buildPopularityOdds(keys, counts) {
  const total = Math.max(1, state.participants.length);
  return Object.fromEntries(keys.filter(Boolean).map((key) => {
    const count = counts.get(key) || 0;
    const raw = count === 0 ? total + 1 : (total + 1) / count;
    return [key, Math.round(Math.max(1.1, raw) * 10) / 10];
  }));
}

function applyOddsBookToPredictions() {
  ensureConfig();
  const templateId = baseTemplateId(state.event.templateId);
  if (templateId === "rankingOdds") {
    state.participants.forEach((name) => {
      const prediction = state.event.predictions[name];
      prediction.picks.forEach((pick, index) => {
        if (pick) prediction.odds[index] = lookupOdds(pick, prediction.odds[index] || 1);
      });
    });
  }
  if (templateId === "fightCard") {
    const markets = getMarkets();
    state.participants.forEach((name) => {
      const prediction = state.event.predictions[name];
      markets.forEach((market) => {
        const pick = prediction.picks[market.id];
        if (pick) prediction.odds[market.id] = lookupMarketOdds(market, pick, prediction.odds[market.id] || 0);
      });
    });
  }
  if (templateId === "worldCup") {
    state.participants.forEach((name) => {
      const prediction = state.event.predictions[name];
      (prediction.futures || []).forEach((future) => {
        if (future?.country) future.odds = lookupOdds(future.country, future.odds || 1);
      });
    });
  }
}

function renderScores() {
  const rows = calculateScores();
  els.scoreboard.innerHTML = rows.map((row, index) => `
    <div class="score-row ${scoreRowClass(index)}">
      <div class="rank ${rankClass(index)}">${rankLabel(index)}</div>
      <div class="score-meta">
        <strong>${escapeHtml(row.name)}</strong>
        <span>${escapeHtml(row.detail)}</span>
      </div>
      <div class="score-value">${formatScore(row.score)}</div>
    </div>
  `).join("");
  els.insightBand.textContent = scoreboardInsight(rows);
}

function rankLabel(index) {
  return ["1", "2", "3"][index] || String(index + 1);
}

function rankClass(index) {
  return ["rank-gold", "rank-silver", "rank-bronze"][index] || "";
}

function scoreRowClass(index) {
  return index === 0 ? "score-row-leader" : "";
}

function scoreboardInsight(rows) {
  if (!rows.length) return "参加者を追加するとスコアが表示されます。";
  const hasScore = rows.some((row) => Number(row.score) > 0);
  if (!hasScore) {
    return "まだスコアは動いていません。確定結果を入力すると順位が更新されます。";
  }
  const topScore = rows[0].score;
  const topNames = rows.filter((row) => row.score === topScore).map((row) => row.name);
  const nextDifferent = rows.find((row) => row.score < topScore);
  if (topNames.length > 1) {
    return `現在は${topNames.join("、")}が同点トップです。 このアプリはポイント記録用で、決済・送金・リアルマネーを扱う機能は含めていません。`;
  }
  return `${topNames[0]}が現在トップ。${nextDifferent ? `2位との差は${formatScore(topScore - nextDifferent.score)}ptです。` : ""} このアプリはポイント記録用で、決済・送金・リアルマネーを扱う機能は含めていません。`;
}

function calculateScores() {
  return state.participants.map((name) => {
    ensurePrediction(name);
    const templateId = baseTemplateId(state.event.templateId);
    let score = 0;
    let detail = "";
    if (templateId === "rankingOdds") {
      const template = templates.rankingOdds;
      const prediction = state.event.predictions[name];
      score = prediction.picks.reduce((total, pick, index) => {
        if (!pick) return total;
        const actualIndex = state.event.results.finalTop4.indexOf(pick);
        if (actualIndex === -1) return total;
        const base = actualIndex === index ? template.basePoints[index] : 2;
        return total + base * (Number(prediction.odds[index]) || 1);
      }, 0);
      detail = "順位予想 × オッズ";
    }
    if (templateId === "draft") {
      const template = templates.draft;
      const prediction = state.event.predictions[name];
      score = prediction.teams.reduce((total, team) => total + (template.finishPoints[state.event.results.finishes[team]] || 0), 0);
      if (state.event.results.scoreBonusWinner === name) score += 30;
      detail = "ドラフト到達点 + スコアボーナス";
    }
    if (templateId === "fightCard") {
      const prediction = state.event.predictions[name];
      score = Object.entries(state.event.results.winners).reduce((total, [market, result]) => {
        if (!result || prediction.picks[market] !== result) return total;
        return total + (Number(prediction.odds[market]) || 0);
      }, 0);
      if (state.event.results.bonusWinner === name) score += 3;
      detail = "的中マーケットのpt合計";
    }
    if (templateId === "worldCup") {
      const prediction = state.event.predictions[name];
      score += Number(prediction.glScore) || 0;
      score += Number(prediction.awardScore) || 0;
      score += [200, 100, 50, 30].reduce((total, points, index) => {
        return total + (prediction.top4[index] && prediction.top4[index] === state.event.results.top4[index] ? points : 0);
      }, 0);
      score += (prediction.futures || []).reduce((total, future) => {
        if (!future || !future.country || !future.finish) return total;
        const reached = finishForCountry(future.country);
        if (!reached) return total;
        const reachedRank = finishRank(reached);
        const pickedRank = finishRank(future.finish);
        if (reachedRank > pickedRank) return total;
        return total + futureBasePoints(reached) * Math.min(200, Number(future.odds) || 0);
      }, 0);
      if (state.event.results.finalScoreWinner === name) score += state.event.results.exactScore ? 95 : 45;
      detail = "GL + 単勝 + 複勝 + 個人賞 + 決勝";
    }
    return { name, score, detail };
  }).sort((a, b) => b.score - a.score);
}

function finishForCountry(country) {
  const top4 = state.event.results.top4;
  const index = top4.indexOf(country);
  if (index === 0) return "champion";
  if (index === 1) return "runnerUp";
  if (index === 2) return "third";
  if (index === 3) return "fourth";
  return state.event.results.futures?.[country] || "";
}

function syncTop4FutureResults() {
  const [champion, runnerUp, third, fourth] = state.event.results.top4;
  if (champion) state.event.results.futures[champion] = "champion";
  if (runnerUp) state.event.results.futures[runnerUp] = "runnerUp";
  if (third) state.event.results.futures[third] = "third";
  if (fourth) state.event.results.futures[fourth] = "fourth";
}

function futureBasePoints(finish) {
  return { champion: 3, runnerUp: 2, third: 1, fourth: 0.5, best8: 0.3, best16: 0.1 }[finish] || 0;
}

function finishRank(finish) {
  return { champion: 1, runnerUp: 2, third: 3, fourth: 4, best8: 8, best16: 16 }[finish] || 99;
}

function finishLabel(value) {
  return { champion: "優勝", runnerUp: "準優勝", semifinal: "ベスト4", quarterfinal: "ベスト8" }[value] || "未確定";
}

function ensurePrediction(name) {
  if (!state.event.predictions[name]) state.event.predictions[name] = createPrediction(state.event.templateId);
}

function optionList(options, selected) {
  const normalized = options[0] === "" ? options : ["", ...options];
  return normalized.map((option) => `<option value="${escapeAttr(option)}" ${String(option) === String(selected) ? "selected" : ""}>${escapeHtml(labelForOption(option))}</option>`).join("");
}

function labelForOption(option) {
  const labels = {
    champion: "優勝",
    runnerUp: "準優勝",
    semifinal: "ベスト4",
    quarterfinal: "ベスト8",
    third: "3位",
    fourth: "4位",
    best8: "ベスト8",
    best16: "ベスト16",
    true: "はい",
    false: "いいえ",
  };
  return labels[option] || option || "未選択";
}

function setByPath(path, value) {
  const parts = path.split(".");
  let target = state;
  while (parts.length > 1) {
    target = target[parts.shift()];
  }
  target[parts[0]] = value;
  renderScoresOnly();
}

function coerceValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function formatScore(value) {
  return `${(Math.round(value * 100) / 100).toLocaleString("ja-JP")}`;
}

function formatOddsInput(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(Math.round(number * 10) / 10);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function renderShellMeta() {
  const sport = sportMeta(state.event?.templateId);
  if (els.matchFeatureIcon) {
    els.matchFeatureIcon.textContent = sport.icon;
    els.matchFeatureIcon.setAttribute("aria-label", sport.label);
  }
  if (els.matchFeatureTitle) els.matchFeatureTitle.textContent = state.event?.name || "現在のイベント";
  if (els.matchFeatureMeta) {
    const template = templates[state.event?.templateId];
    const base = baseTemplateId(state.event?.templateId);
    const count = base === "fightCard"
      ? getMarkets().length
      : base === "worldCup"
        ? getCountries().length
        : getTeams().length;
    els.matchFeatureMeta.textContent = `${sport.label} / ${template?.name || "ルール"} / ${count}件の候補`;
  }
  if (els.historyEventName) els.historyEventName.textContent = state.event?.name || "未保存";
  if (els.resultEventName) els.resultEventName.textContent = state.event?.name || "未設定";
}

els.leagueName?.addEventListener("input", () => {
  state.leagueName = els.leagueName.value;
  persist();
});

els.addParticipantButton?.addEventListener("click", () => {
  const name = els.participantName.value.trim();
  if (!name || state.participants.includes(name)) return;
  state.participants.push(name);
  (state.events || []).forEach((event) => {
    event.predictions ||= {};
    event.predictions[name] = createPrediction(event.templateId);
  });
  els.participantName.value = "";
  render();
});

els.participantName?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") els.addParticipantButton.click();
});

els.newEventButton?.addEventListener("click", () => {
  const event = createTournamentFromSettings({ fallbackName: templates[state.activeTemplate]?.eventName });
  addAndSelectEvent(event);
  render();
});

els.settingsNewEventButton?.addEventListener("click", () => {
  const event = createTournamentFromSettings();
  addAndSelectEvent(event);
  window.location.hash = "prediction";
  render();
});

els.saveButton?.addEventListener("click", () => {
  if (els.confirmDialog?.showModal) {
    els.confirmDialog.showModal();
    return;
  }
  confirmSave();
});

els.confirmSaveButton?.addEventListener("click", () => {
  confirmSave();
});

function confirmSave() {
  persist();
  els.saveButton.textContent = "LOCKED";
  setTimeout(() => {
    els.saveButton.textContent = "LOCK IN";
  }, 900);
}

els.resetButton?.addEventListener("click", () => {
  if (!confirm("ローカル保存データを初期化しますか？")) return;
  localStorage.removeItem(STORAGE_KEY);
  state = createDefaultState();
  render();
});

els.exportButton.addEventListener("click", () => {
  els.exportText.value = JSON.stringify(state, null, 2);
  els.exportDialog.showModal();
});

els.navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    requestAnimationFrame(renderPage);
  });
});

document.addEventListener("click", (event) => {
  const deleteButton = event.target.closest("[data-event-delete]");
  if (deleteButton) {
    const eventId = deleteButton.dataset.eventId;
    const target = (state.events || []).find((candidate) => candidate.id === eventId);
    if (!target) return;
    if ((state.events || []).length <= 1) {
      alert("最後の大会は削除できません。");
      return;
    }
    if (!confirm(`「${target.name}」を削除しますか？`)) return;
    state.events = state.events.filter((candidate) => candidate.id !== eventId);
    if (state.activeEventId === eventId) setActiveEvent(state.events[0]?.id);
    render();
    return;
  }
  const statusButton = event.target.closest("[data-event-status]");
  if (statusButton) {
    const item = (state.events || []).find((candidate) => candidate.id === statusButton.dataset.eventId);
    if (!item) return;
    item.status = statusButton.dataset.eventStatus;
    if (state.event?.id === item.id) state.event = item;
    render();
    return;
  }
  const manageButton = event.target.closest("[data-event-manage]");
  if (manageButton) {
    setActiveEvent(manageButton.dataset.eventId);
    render();
    return;
  }
  const trigger = event.target.closest("[data-event-id]");
  if (!trigger) return;
  setActiveEvent(trigger.dataset.eventId);
  render();
});

els.rankingTabs?.querySelectorAll("button").forEach((button) => {
  button.addEventListener("click", () => {
    els.rankingTabs.querySelectorAll("button").forEach((item) => item.classList.toggle("is-active", item === button));
    const label = button.textContent.trim();
    const shouldShowPanel = label === "カスタム期間" || label === "大会別";
    if (els.rankingFilterPanel) {
      els.rankingFilterPanel.hidden = !shouldShowPanel;
      els.rankingFilterPanel.querySelectorAll("[data-ranking-filter]").forEach((panel) => {
        panel.hidden = panel.dataset.rankingFilter !== label;
      });
    }
  });
});

els.approvalPolicyGroup?.querySelectorAll("[data-approval-policy]").forEach((button) => {
  button.addEventListener("click", () => {
    state.approvalPolicy = button.dataset.approvalPolicy;
    if (state.event) state.event.approvalPolicy = button.dataset.approvalPolicy;
    render();
  });
});

window.addEventListener("hashchange", renderPage);

els.themeToggle?.addEventListener("click", () => {
  applyTheme(document.body.dataset.theme === "day" ? "dark" : "day");
});

applyTheme(localStorage.getItem(THEME_KEY) || "dark");
render();
