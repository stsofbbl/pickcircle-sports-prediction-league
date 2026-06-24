const STORAGE_KEY = "yoso-league-state-v1";
const AUTH_USERS_KEY = "yoso-auth-users-v1";
const AUTH_SESSION_KEY = "yoso-auth-session-v1";
const AUTH_PBKDF2_ITERATIONS = 120000;
const AUTH_DEFAULT_IDLE_TIMEOUT_MINUTES = 10080;
const AUTH_ACTIVITY_THROTTLE_MS = 30000;
const SHEETS_SYNC_TIMEOUT_MS = 12000;

const templates = {
  rankingOdds: {
    id: "rankingOdds",
    sport: "baseball",
    name: "順位予想",
    subtitle: "WBC型: 順位予想にオッズを掛ける",
    eventName: "WBC順位予想",
    teams: ["日本", "アメリカ", "ドミニカ共和国", "プエルトリコ", "ベネズエラ", "イタリア"],
    resultLabels: ["1位", "2位", "3位", "4位"],
    basePoints: [10, 7, 5, 3],
  },
  playoff: {
    id: "playoff",
    sourceTemplate: "rankingOdds",
    sport: "baseball",
    name: "プレーオフ予想",
    subtitle: "CS・プレーオフ型: 勝ち抜け、シリーズ勝者、注目枠を予想",
    eventName: "プレーオフ予想",
    teams: ["1位チーム", "2位チーム", "3位チーム", "ワイルドカード"],
    resultLabels: ["勝者", "準優勝", "ベスト4", "注目枠"],
    basePoints: [10, 7, 5, 3],
  },
  draft: {
    id: "draft",
    sport: "baseball",
    name: "ドラフト",
    subtitle: "選択型: 指名したチームの到達結果で加点",
    eventName: "選抜ドラフト",
    teams: ["大阪桐蔭", "山梨学院", "八戸学院光星", "中京大中京", "花巻東", "英明", "智弁学園", "専大松戸"],
    finishPoints: { champion: 100, runnerUp: 70, semifinal: 40, quarterfinal: 10 },
  },
  koshien: {
    id: "koshien",
    sport: "baseball",
    name: "夏の甲子園8校ピック",
    subtitle: "49代表から8校を選び、キャプテン校は2倍で加点",
    eventName: "夏の甲子園2026 YOSO",
    teams: [
      "北北海道代表", "南北海道代表", "青森代表", "岩手代表", "宮城代表", "秋田代表", "山形代表",
      "福島代表", "茨城代表", "栃木代表", "群馬代表", "埼玉代表", "千葉代表", "東東京代表",
      "西東京代表", "神奈川代表", "山梨代表", "新潟代表", "長野代表", "富山代表", "石川代表",
      "福井代表", "静岡代表", "愛知代表", "岐阜代表", "三重代表", "滋賀代表", "京都代表",
      "大阪代表", "兵庫代表", "奈良代表", "和歌山代表", "鳥取代表", "島根代表", "岡山代表",
      "広島代表", "山口代表", "香川代表", "徳島代表", "愛媛代表", "高知代表", "福岡代表",
      "佐賀代表", "長崎代表", "熊本代表", "大分代表", "宮崎代表", "鹿児島代表", "沖縄代表",
    ],
    pickCount: 8,
    stagePoints: { best32: 1, best16: 2, best8: 4, semifinal: 8, runnerUp: 16, champion: 32 },
  },
  fightCard: {
    id: "fightCard",
    sport: "boxing",
    name: "ファイトカード",
    subtitle: "ボクシング型: 勝者、決着方法、ラウンド帯を予想",
    eventName: "5.2ボクシング予想",
    markets: [
      { id: "fight1", label: "井上尚弥 vs 中谷潤人", options: ["井上尚弥 勝利", "中谷潤人 勝利", "井上尚弥 KO", "中谷潤人 KO", "判定"] },
      { id: "fight2", label: "井上拓真 vs 田中恒成", options: ["井上拓真 勝利", "田中恒成 勝利", "井上拓真 KO", "田中恒成 KO", "判定"] },
      { id: "bonus", label: "KOラウンド帯", options: ["なし", "1-3R", "4-6R", "7-9R", "10-12R"] },
    ],
  },
  scoreBonus: {
    id: "scoreBonus",
    sourceTemplate: "fightCard",
    sport: "other",
    name: "スコアボーナス型",
    subtitle: "決勝スコア、総得点、KOラウンドなどの単独ボーナス",
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
    subtitle: "GL、決勝T、決勝スコアを段階ごとに予想",
    eventName: "W杯2026予想王",
    groups: ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"],
    countries: [
      "日本", "ブラジル", "フランス", "アルゼンチン",
      "イングランド", "スペイン", "ドイツ", "ポルトガル",
      "イタリア", "オランダ", "ベルギー", "クロアチア",
      "アメリカ", "カナダ", "メキシコ", "ウルグアイ",
      "コロンビア", "チリ", "エクアドル", "パラグアイ",
      "韓国", "オーストラリア", "イラン", "サウジアラビア",
      "カタール", "UAE", "イラク", "ウズベキスタン",
      "モロッコ", "ナイジェリア", "セネガル", "エジプト",
      "カメルーン", "ガーナ", "南アフリカ", "コートジボワール",
      "スイス", "デンマーク", "スウェーデン", "ノルウェー",
      "ポーランド", "セルビア", "トルコ", "ギリシャ",
      "ウェールズ", "スコットランド", "アイルランド", "ニュージーランド",
    ],
  },
  groupStage: {
    id: "groupStage",
    sourceTemplate: "worldCup",
    sport: "soccer",
    name: "グループ突破型",
    subtitle: "W杯型: グループ突破、順位、到達結果を中心に予想",
    eventName: "グループ突破予想",
    groups: ["A", "B", "C", "D"],
    countries: ["日本", "ブラジル", "フランス", "アルゼンチン", "スペイン", "ドイツ", "アメリカ", "メキシコ"],
  },
  composite: {
    id: "composite",
    sourceTemplate: "worldCup",
    sport: "soccer",
    name: "複合型",
    subtitle: "大型大会向け: 複数の予想形式を組み合わせる",
    eventName: "複合ルール大会",
    groups: ["A", "B", "C", "D"],
    countries: ["日本", "ブラジル", "フランス", "アルゼンチン", "スペイン", "ドイツ", "アメリカ", "メキシコ"],
  },
};

const presetRuleDescriptions = {
  rankingOdds: "優勝、準優勝、ベスト4などの順位を予想する型です。WBC、甲子園、W杯の上位予想に向いています。",
  playoff: "クライマックスシリーズやプレーオフの勝ち抜け、シリーズ勝者、注目枠を予想する型です。",
  draft: "参加者がチームや選手を指名し、到達成績に応じてポイントを得る型です。",
  koshien: "夏の甲子園向けの8校ピック型です。49代表から8校を選び、キャプテン校は2倍、勝ち上がり段階ごとに累積加点します。",
  fightCard: "格闘技やボクシングの対戦カードごとに、勝者、KO、判定などを予想する型です。",
  scoreBonus: "決勝スコア、総得点、KOラウンドなど、単独のボーナス項目を予想する型です。",
  worldCup: "W杯2026専用の3フェーズ型です。第1回GL、第2回決勝T、第3回決勝スコアを段階ごとに扱います。",
  groupStage: "W杯などでグループ突破、順位、到達結果を中心に予想する型です。",
  composite: "複数の予想形式を組み合わせる大型大会向けの型です。W杯2026予想王のような大会に向いています。",
};

const defaultState = {
  leagueName: "G-UNIT 予想リーグ",
  participants: ["和田", "担当A", "担当B", "ゲスト"],
  activeTemplate: "worldCup",
  approvalPolicy: "half",
  connection: {
    mode: "local",
    scriptUrl: "",
    spreadsheetId: "",
    leagueId: "g-unit-koshien-2026",
    clientId: "",
    lastSyncAt: "",
  },
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
  authScreen: document.querySelector("#authScreen"),
  authForm: document.querySelector("#authForm"),
  authModeButtons: [...document.querySelectorAll("[data-auth-mode]")],
  authUsername: document.querySelector("#authUsername"),
  authDisplayName: document.querySelector("#authDisplayName"),
  authPassword: document.querySelector("#authPassword"),
  authRemember: document.querySelector("#authRemember"),
  authSubmitButton: document.querySelector("#authSubmitButton"),
  authResetButton: document.querySelector("#authResetButton"),
  authMessage: document.querySelector("#authMessage"),
  accountChip: document.querySelector("#accountChip"),
  accountName: document.querySelector("#accountName"),
  logoutButton: document.querySelector("#logoutButton"),
  accountUsername: document.querySelector("#accountUsername"),
  accountRole: document.querySelector("#accountRole"),
  accountDisplayNameInput: document.querySelector("#accountDisplayNameInput"),
  accountEmailInput: document.querySelector("#accountEmailInput"),
  accountIdleTimeout: document.querySelector("#accountIdleTimeout"),
  accountRememberDefault: document.querySelector("#accountRememberDefault"),
  accountCurrentPassword: document.querySelector("#accountCurrentPassword"),
  accountNewPassword: document.querySelector("#accountNewPassword"),
  accountSaveButton: document.querySelector("#accountSaveButton"),
  accountPasswordButton: document.querySelector("#accountPasswordButton"),
  settingsLogoutButton: document.querySelector("#settingsLogoutButton"),
  accountMessage: document.querySelector("#accountMessage"),
  dataConnectionMode: document.querySelector("#dataConnectionMode"),
  dataConnectionScriptUrl: document.querySelector("#dataConnectionScriptUrl"),
  dataConnectionSpreadsheetId: document.querySelector("#dataConnectionSpreadsheetId"),
  dataConnectionLeagueId: document.querySelector("#dataConnectionLeagueId"),
  dataConnectionLastSync: document.querySelector("#dataConnectionLastSync"),
  dataConnectionSaveButton: document.querySelector("#dataConnectionSaveButton"),
  dataConnectionSyncToButton: document.querySelector("#dataConnectionSyncToButton"),
  dataConnectionSyncFromButton: document.querySelector("#dataConnectionSyncFromButton"),
  dataConnectionCopyStateButton: document.querySelector("#dataConnectionCopyStateButton"),
  dataConnectionStatus: document.querySelector("#dataConnectionStatus"),
  dataConnectionSummary: document.querySelector("#dataConnectionSummary"),
  dataConnectionBadge: document.querySelector("#dataConnectionBadge"),
  dataConnectionMessage: document.querySelector("#dataConnectionMessage"),
  homeClubLine: document.querySelector("#homeClubLine"),
  homeParticipantName: document.querySelector("#homeParticipantName"),
  homeOpenCount: document.querySelector("#homeOpenCount"),
  homeMissingTournamentCount: document.querySelector("#homeMissingTournamentCount"),
  homeMonthScore: document.querySelector("#homeMonthScore"),
  homeTotalScore: document.querySelector("#homeTotalScore"),
  homeReadinessPanel: document.querySelector("#homeReadinessPanel"),
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
  presetDetails: document.querySelector("#presetDetails"),
  presetSummary: document.querySelector("#presetSummary"),
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

let authSession = loadAuthSession();
let authMode = "login";
let lastAuthActivityWrite = 0;

function loadAuthUsers() {
  try {
    const stored = localStorage.getItem(AUTH_USERS_KEY);
    const users = stored ? JSON.parse(stored) : [];
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

function saveAuthUsers(users) {
  localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

function loadAuthSession() {
  try {
    const sessionStored = sessionStorage.getItem(AUTH_SESSION_KEY);
    const localStored = localStorage.getItem(AUTH_SESSION_KEY);
    const session = sessionStored ? { ...JSON.parse(sessionStored), remember: false } : localStored ? { ...JSON.parse(localStored), remember: true } : null;
    if (!session || isAuthSessionExpired(session)) {
      clearAuthSessionStorage();
      return null;
    }
    return session;
  } catch {
    clearAuthSessionStorage();
    return null;
  }
}

function saveAuthSession(session, remember = session?.remember) {
  authSession = session;
  clearAuthSessionStorage();
  if (!session) return;
  const nextSession = {
    ...session,
    remember: Boolean(remember),
    lastActiveAt: session.lastActiveAt || new Date().toISOString(),
  };
  authSession = nextSession;
  const target = nextSession.remember ? localStorage : sessionStorage;
  target.setItem(AUTH_SESSION_KEY, JSON.stringify(nextSession));
}

function currentAuthUser() {
  if (!authSession?.userId) return null;
  if (isAuthSessionExpired(authSession)) {
    saveAuthSession(null);
    return null;
  }
  return loadAuthUsers().find((user) => user.id === authSession.userId) || null;
}

function clearAuthSessionStorage() {
  localStorage.removeItem(AUTH_SESSION_KEY);
  sessionStorage.removeItem(AUTH_SESSION_KEY);
}

function isAuthSessionExpired(session) {
  if (!session?.userId) return true;
  const user = loadAuthUsers().find((candidate) => candidate.id === session.userId);
  const timeout = Number(user?.idleTimeoutMinutes ?? AUTH_DEFAULT_IDLE_TIMEOUT_MINUTES);
  if (!timeout) return false;
  const lastActive = Date.parse(session.lastActiveAt || session.signedInAt || 0);
  if (!lastActive) return true;
  return Date.now() - lastActive > timeout * 60 * 1000;
}

function touchAuthSession(force = false) {
  if (!authSession?.userId) return;
  if (!force && Date.now() - lastAuthActivityWrite < AUTH_ACTIVITY_THROTTLE_MS) return;
  lastAuthActivityWrite = Date.now();
  saveAuthSession({ ...authSession, lastActiveAt: new Date().toISOString() }, authSession.remember);
}

function enforceAuthTimeout() {
  if (!authSession?.userId || !isAuthSessionExpired(authSession)) return;
  saveAuthSession(null);
  renderAuthState();
}

function renderAuthState() {
  const user = currentAuthUser();
  document.body.classList.toggle("auth-locked", !user);
  if (els.authScreen) els.authScreen.hidden = Boolean(user);
  if (els.accountChip) els.accountChip.hidden = !user;
  if (els.accountName) els.accountName.textContent = user ? `${user.displayName}${user.role === "admin" ? " / Admin" : ""}` : "";
  if (!user) {
    setAuthMode(loadAuthUsers().length ? "login" : "register");
    return;
  }
  ensureParticipantForAuth(user);
  renderAccountSettings(user);
}

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  els.authModeButtons?.forEach((button) => button.classList.toggle("is-active", button.dataset.authMode === authMode));
  if (els.authScreen) els.authScreen.dataset.mode = authMode;
  if (els.authSubmitButton) els.authSubmitButton.textContent = authMode === "register" ? "登録して入る" : "ログイン";
  if (els.authPassword) els.authPassword.autocomplete = authMode === "register" ? "new-password" : "current-password";
  if (els.authRemember && authMode === "register") els.authRemember.checked = true;
  setAuthMessage("");
}

function renderAccountSettings(user = currentAuthUser()) {
  if (!user) return;
  if (els.accountUsername) els.accountUsername.value = user.username || "";
  if (els.accountRole) els.accountRole.value = user.role === "admin" ? "Admin" : "member";
  if (els.accountDisplayNameInput) els.accountDisplayNameInput.value = user.displayName || "";
  if (els.accountEmailInput) els.accountEmailInput.value = user.email || "";
  if (els.accountIdleTimeout) els.accountIdleTimeout.value = String(user.idleTimeoutMinutes ?? AUTH_DEFAULT_IDLE_TIMEOUT_MINUTES);
  if (els.accountRememberDefault) els.accountRememberDefault.checked = user.rememberDefault !== false;
  if (els.authRemember) els.authRemember.checked = user.rememberDefault !== false;
}

function renderConnectionSettings() {
  state.connection = normalizeConnectionSettings(state.connection);
  const connection = state.connection;
  const isSheetsReady = connection.mode === "sheets" && connection.scriptUrl && connection.spreadsheetId && connection.leagueId;
  if (els.dataConnectionMode) els.dataConnectionMode.value = connection.mode;
  if (els.dataConnectionScriptUrl) els.dataConnectionScriptUrl.value = connection.scriptUrl;
  if (els.dataConnectionSpreadsheetId) els.dataConnectionSpreadsheetId.value = connection.spreadsheetId;
  if (els.dataConnectionLeagueId) els.dataConnectionLeagueId.value = connection.leagueId;
  if (els.dataConnectionLastSync) els.dataConnectionLastSync.value = connection.lastSyncAt ? formatDateTime(connection.lastSyncAt) : "未同期";
  if (els.dataConnectionStatus) {
    els.dataConnectionStatus.textContent = connection.mode === "sheets" ? "Google Sheets同期" : "この端末に保存中";
  }
  if (els.dataConnectionSummary) {
    els.dataConnectionSummary.textContent = isSheetsReady
      ? `League ID: ${connection.leagueId || "未設定"} / Sheetsへ保存・読込できます。`
      : connection.mode === "sheets"
        ? "Apps Script URL、Spreadsheet ID、League IDを入れると同期できます。"
        : "友達と共有する前に、次のステップでSheets同期を追加します。";
  }
  if (els.dataConnectionBadge) {
    els.dataConnectionBadge.textContent = isSheetsReady ? "SYNC READY" : connection.mode === "sheets" ? "SETUP" : "LOCAL";
    els.dataConnectionBadge.className = `status-label ${isSheetsReady ? "open" : "pending"}`;
  }
}

function setConnectionMessage(message) {
  if (els.dataConnectionMessage) els.dataConnectionMessage.textContent = message;
}

function handleConnectionSave() {
  state.connection = normalizeConnectionSettings({
    mode: els.dataConnectionMode?.value,
    scriptUrl: els.dataConnectionScriptUrl?.value.trim(),
    spreadsheetId: els.dataConnectionSpreadsheetId?.value.trim(),
    leagueId: els.dataConnectionLeagueId?.value.trim(),
    clientId: state.connection?.clientId,
    lastSyncAt: state.connection?.lastSyncAt || "",
  });
  persist();
  renderConnectionSettings();
  setConnectionMessage("接続設定を保存しました。Google側のWebアプリ公開が済んでいれば同期できます。");
  renderDashboard();
}

async function syncStateToSheets() {
  const connection = ensureSheetsConnectionReady();
  if (!connection) return;
  setConnectionMessage("Sheetsへ保存しています...");
  persist();
  const now = new Date().toISOString();
  const body = new URLSearchParams({
    action: "saveState",
    spreadsheetId: connection.spreadsheetId,
    leagueId: connection.leagueId,
    clientId: connection.clientId,
    payload: JSON.stringify({
      app: "YOSO",
      version: 1,
      savedAt: now,
      state,
    }),
  });
  try {
    await fetch(connection.scriptUrl, {
      method: "POST",
      mode: "no-cors",
      body,
    });
    state.connection.lastSyncAt = now;
    persist();
    renderConnectionSettings();
    renderDashboard();
    setConnectionMessage("Sheetsへ保存リクエストを送りました。別端末では「Sheetsから読込」で反映できます。");
  } catch {
    setConnectionMessage("Sheetsへ保存できませんでした。Apps Script URLと公開設定を確認してください。");
  }
}

async function syncStateFromSheets() {
  const connection = ensureSheetsConnectionReady();
  if (!connection) return;
  setConnectionMessage("Sheetsから読み込んでいます...");
  try {
    const response = await requestSheetsJsonp(connection, "getState");
    if (!response?.ok || !response.state) {
      setConnectionMessage(response?.error || "Sheetsに保存済みデータが見つかりませんでした。");
      return;
    }
    const localConnection = normalizeConnectionSettings(state.connection);
    state = normalizeState({
      ...response.state,
      connection: {
        ...normalizeConnectionSettings(response.state.connection),
        ...localConnection,
        lastSyncAt: response.updatedAt || new Date().toISOString(),
      },
    });
    renderAuthState();
    render();
    setConnectionMessage(`Sheetsから読み込みました。更新: ${formatDateTime(response.updatedAt || state.connection.lastSyncAt)}`);
  } catch {
    setConnectionMessage("Sheetsから読み込めませんでした。Apps Script URL、公開範囲、Spreadsheet IDを確認してください。");
  }
}

function ensureSheetsConnectionReady() {
  state.connection = normalizeConnectionSettings({
    ...state.connection,
    mode: els.dataConnectionMode?.value || state.connection?.mode,
    scriptUrl: els.dataConnectionScriptUrl?.value.trim() || state.connection?.scriptUrl,
    spreadsheetId: els.dataConnectionSpreadsheetId?.value.trim() || state.connection?.spreadsheetId,
    leagueId: els.dataConnectionLeagueId?.value.trim() || state.connection?.leagueId,
  });
  if (state.connection.mode !== "sheets") {
    setConnectionMessage("保存モードを「Google Sheets準備」に切り替えてください。");
    return null;
  }
  if (!state.connection.scriptUrl || !state.connection.spreadsheetId || !state.connection.leagueId) {
    setConnectionMessage("Apps Script URL、Spreadsheet ID、League IDを入力してください。");
    return null;
  }
  persist();
  renderConnectionSettings();
  return state.connection;
}

function requestSheetsJsonp(connection, action) {
  return new Promise((resolve, reject) => {
    const callbackName = `__yosoSheetsCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement("script");
    let timeout;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    };
    timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Sheets request timed out"));
    }, SHEETS_SYNC_TIMEOUT_MS);
    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("Sheets script failed"));
    };
    script.src = buildSheetsUrl(connection, {
      action,
      callback: callbackName,
      spreadsheetId: connection.spreadsheetId,
      leagueId: connection.leagueId,
      clientId: connection.clientId,
      t: Date.now(),
    });
    document.head.append(script);
  });
}

function buildSheetsUrl(connection, params) {
  const url = new URL(connection.scriptUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

async function copyCurrentStateForSheets() {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), state }, null, 2);
  try {
    await navigator.clipboard.writeText(payload);
    setConnectionMessage("現在の大会データをクリップボードにコピーしました。");
  } catch {
    setConnectionMessage("コピーできませんでした。ブラウザの権限設定を確認してください。");
  }
}

function setAuthMessage(message) {
  if (els.authMessage) els.authMessage.textContent = message;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!crypto?.subtle) {
    setAuthMessage("このブラウザではWeb Crypto APIが使えないため登録できません。");
    return;
  }
  const username = normalizeUsername(els.authUsername?.value || "");
  const displayName = (els.authDisplayName?.value || "").trim();
  const password = els.authPassword?.value || "";
  const remember = Boolean(els.authRemember?.checked);
  if (authMode === "register") await registerAuthUser(username, displayName, password, remember);
  else await loginAuthUser(username, password, remember);
}

async function registerAuthUser(username, displayName, password, remember = true) {
  const users = loadAuthUsers();
  if (username.length < 3) {
    setAuthMessage("ユーザーIDは3文字以上で入力してください。");
    return;
  }
  if (!displayName) {
    setAuthMessage("表示名を入力してください。");
    return;
  }
  if (password.length < 6) {
    setAuthMessage("パスワードは6文字以上で入力してください。");
    return;
  }
  if (users.some((user) => user.username === username)) {
    setAuthMessage("このユーザーIDは登録済みです。");
    return;
  }
  const salt = randomBase64(16);
  const passwordHash = await derivePasswordHash(password, salt);
  const user = {
    id: crypto.randomUUID ? crypto.randomUUID() : `user-${Date.now()}`,
    username,
    displayName,
    email: "",
    role: users.length ? "member" : "admin",
    idleTimeoutMinutes: AUTH_DEFAULT_IDLE_TIMEOUT_MINUTES,
    rememberDefault: remember,
    salt,
    passwordHash,
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  saveAuthUsers(users);
  saveAuthSession({ userId: user.id, signedInAt: new Date().toISOString(), lastActiveAt: new Date().toISOString() }, remember);
  if (els.authPassword) els.authPassword.value = "";
  ensureParticipantForAuth(user);
  renderAuthState();
  render();
}

async function loginAuthUser(username, password, remember = true) {
  const user = loadAuthUsers().find((candidate) => candidate.username === username);
  if (!user) {
    setAuthMessage("ユーザーIDまたはパスワードが違います。");
    return;
  }
  const passwordHash = await derivePasswordHash(password, user.salt);
  if (passwordHash !== user.passwordHash) {
    setAuthMessage("ユーザーIDまたはパスワードが違います。");
    return;
  }
  user.rememberDefault = remember;
  saveUpdatedAuthUser(user);
  saveAuthSession({ userId: user.id, signedInAt: new Date().toISOString(), lastActiveAt: new Date().toISOString() }, remember);
  if (els.authPassword) els.authPassword.value = "";
  ensureParticipantForAuth(user);
  renderAuthState();
  render();
}

function logoutAuthUser() {
  saveAuthSession(null);
  renderAuthState();
}

function resetLocalAuth() {
  const ok = confirm("ローカルのログイン情報だけをリセットします。大会データやYOSOは残ります。もう一度新規登録しますか？");
  if (!ok) return;
  localStorage.removeItem(AUTH_USERS_KEY);
  clearAuthSessionStorage();
  authSession = null;
  renderAuthState();
  setAuthMessage("ログイン情報をリセットしました。新規登録してください。");
}

function saveUpdatedAuthUser(nextUser) {
  const users = loadAuthUsers();
  const index = users.findIndex((user) => user.id === nextUser.id);
  if (index === -1) return false;
  users[index] = { ...users[index], ...nextUser, updatedAt: new Date().toISOString() };
  saveAuthUsers(users);
  return true;
}

function handleAccountSave() {
  const user = currentAuthUser();
  if (!user) return;
  const nextDisplayName = (els.accountDisplayNameInput?.value || "").trim();
  const nextEmail = (els.accountEmailInput?.value || "").trim();
  const nextTimeout = Number(els.accountIdleTimeout?.value ?? AUTH_DEFAULT_IDLE_TIMEOUT_MINUTES);
  const rememberDefault = Boolean(els.accountRememberDefault?.checked);
  if (!nextDisplayName) {
    setAccountMessage("表示名を入力してください。");
    return;
  }
  const users = loadAuthUsers();
  if (users.some((candidate) => candidate.id !== user.id && candidate.displayName === nextDisplayName)) {
    setAccountMessage("その表示名は別ユーザーが使っています。");
    return;
  }
  const previousDisplayName = user.displayName;
  const nextUser = {
    ...user,
    displayName: nextDisplayName,
    email: nextEmail,
    idleTimeoutMinutes: Number.isFinite(nextTimeout) ? nextTimeout : AUTH_DEFAULT_IDLE_TIMEOUT_MINUTES,
    rememberDefault,
  };
  saveUpdatedAuthUser(nextUser);
  if (previousDisplayName !== nextDisplayName) renameParticipant(previousDisplayName, nextDisplayName);
  saveAuthSession({ ...authSession, lastActiveAt: new Date().toISOString() }, authSession?.remember);
  renderAuthState();
  render();
  setAccountMessage("アカウント情報を保存しました。");
}

async function handlePasswordChange() {
  const user = currentAuthUser();
  if (!user) return;
  const currentPassword = els.accountCurrentPassword?.value || "";
  const newPassword = els.accountNewPassword?.value || "";
  if (newPassword.length < 6) {
    setAccountMessage("新しいパスワードは6文字以上で入力してください。");
    return;
  }
  const currentHash = await derivePasswordHash(currentPassword, user.salt);
  if (currentHash !== user.passwordHash) {
    setAccountMessage("現在のパスワードが違います。");
    return;
  }
  const salt = randomBase64(16);
  const passwordHash = await derivePasswordHash(newPassword, salt);
  saveUpdatedAuthUser({ ...user, salt, passwordHash });
  if (els.accountCurrentPassword) els.accountCurrentPassword.value = "";
  if (els.accountNewPassword) els.accountNewPassword.value = "";
  setAccountMessage("パスワードを変更しました。");
}

function setAccountMessage(message) {
  if (els.accountMessage) els.accountMessage.textContent = message;
}

function renameParticipant(previousName, nextName) {
  if (!previousName || !nextName || previousName === nextName) return;
  state.participants = state.participants.map((name) => (name === previousName ? nextName : name));
  if (!state.participants.includes(nextName)) state.participants.push(nextName);
  (state.events || []).forEach((event) => {
    event.predictions ||= {};
    if (event.predictions[previousName] && !event.predictions[nextName]) {
      event.predictions[nextName] = event.predictions[previousName];
    }
    delete event.predictions[previousName];
    if (event.resultFlow?.submittedBy === previousName) event.resultFlow.submittedBy = nextName;
    if (event.resultFlow?.approvals?.[previousName] !== undefined) {
      event.resultFlow.approvals[nextName] = event.resultFlow.approvals[previousName];
      delete event.resultFlow.approvals[previousName];
    }
    if (baseTemplateId(event.templateId) === "koshien") normalizeKoshienPrediction(event, nextName);
    if (baseTemplateId(event.templateId) === "worldCup") normalizeWorldCupPrediction(event, nextName);
  });
  persist();
}

function ensureParticipantForAuth(user) {
  if (!user?.displayName || state.participants.includes(user.displayName)) return;
  state.participants.push(user.displayName);
  (state.events || []).forEach((event) => {
    event.predictions ||= {};
    event.predictions[user.displayName] = createPrediction(event.templateId);
    if (baseTemplateId(event.templateId) === "koshien") normalizeKoshienPrediction(event, user.displayName);
    if (baseTemplateId(event.templateId) === "worldCup") normalizeWorldCupPrediction(event, user.displayName);
  });
  persist();
}

function normalizeUsername(value) {
  return value.trim().toLowerCase();
}

async function derivePasswordHash(password, saltBase64) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: base64ToBytes(saltBase64),
      iterations: AUTH_PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

function randomBase64(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToBase64(bytes);
}

function bytesToBase64(bytes) {
  let value = "";
  bytes.forEach((byte) => {
    value += String.fromCharCode(byte);
  });
  return btoa(value);
}

function base64ToBytes(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
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
  return {
    ...nextState,
    connection: normalizeConnectionSettings(nextState.connection),
    events,
    activeEventId,
    event,
    activeTemplate: event.templateId,
  };
}

function normalizeConnectionSettings(connection = {}) {
  const mode = connection.mode === "sheets" ? "sheets" : "local";
  const randomClientId = globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `client-${Date.now()}`;
  const clientId = connection.clientId || randomClientId;
  return {
    mode,
    scriptUrl: String(connection.scriptUrl || "").trim(),
    spreadsheetId: String(connection.spreadsheetId || "").trim(),
    leagueId: String(connection.leagueId || "g-unit-koshien-2026").trim(),
    clientId,
    lastSyncAt: String(connection.lastSyncAt || ""),
  };
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
  normalized.resultFlow = normalizeResultFlow(normalized.resultFlow, sourceState.participants || defaultState.participants);
  normalized.predictions ||= {};
  (sourceState.participants || defaultState.participants).forEach((name) => {
    normalized.predictions[name] ||= createPrediction(templateId);
  });
  normalizeKoshienEvent(normalized);
  normalizeWorldCupEvent(normalized);
  return normalized;
}

function createResultFlow() {
  return { status: "none", submittedBy: "", submittedAt: "", approvals: {}, finalizedAt: "" };
}

function normalizeResultFlow(flow, participants = state.participants || defaultState.participants) {
  const next = { ...createResultFlow(), ...(flow || {}) };
  next.status = ["none", "submitted", "finalized"].includes(next.status) ? next.status : "none";
  next.approvals = typeof next.approvals === "object" && next.approvals ? next.approvals : {};
  Object.keys(next.approvals).forEach((name) => {
    if (!participants.includes(name)) delete next.approvals[name];
  });
  participants.forEach((name) => {
    if (next.approvals[name] === undefined) return;
    if (!next.approvals[name]) delete next.approvals[name];
  });
  return next;
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
    resultFlow: createResultFlow(),
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
  if (base === "koshien") return {
    teams: [...(template.teams || templates.koshien.teams)],
    pickCount: template.pickCount || templates.koshien.pickCount,
    stagePoints: { ...templates.koshien.stagePoints, ...(template.stagePoints || {}) },
    oddsBook: {},
  };
  if (base === "fightCard") return { markets: structuredClone(template.markets || templates.fightCard.markets), oddsBook: {} };
  if (base === "worldCup") {
    const countries = [...(template.countries || templates.worldCup.countries)];
    return { countries, groups: createWorldCupGroups(template.groups || templates.worldCup.groups, countries), oddsBook: {} };
  }
  return {};
}

function createPrediction(templateId) {
  const base = baseTemplateId(templateId);
  if (base === "rankingOdds") return { picks: ["", "", "", ""], odds: [1, 1, 1, 1] };
  if (base === "draft") return { teams: ["", ""], bonusScore: "" };
  if (base === "koshien") return { teams: Array(8).fill(""), captain: "", finalTotalScore: "" };
  if (base === "fightCard") return { picks: {}, odds: {} };
  if (base === "worldCup") return {
    glPicks: {},
    thirdAdvancers: Array(8).fill(""),
    top4: ["", "", "", ""],
    futures: Array.from({ length: 10 }, () => ({ country: "", finish: "", odds: 1 })),
    awards: {},
    finalScore: { home: "", away: "" },
    gl: {},
    third: "",
  };
  return {};
}

function createResults(templateId) {
  const base = baseTemplateId(templateId);
  if (base === "rankingOdds") return { finalTop4: ["", "", "", ""] };
  if (base === "draft") return { finishes: {}, scoreBonusWinner: "" };
  if (base === "koshien") return { finishes: {}, finalTotalScore: "" };
  if (base === "fightCard") return { winners: {}, bonusWinner: "" };
  if (base === "worldCup") return {
    gl: {},
    thirdAdvancers: Array(8).fill(""),
    thirdQualified: "",
    top4: ["", "", "", ""],
    futures: {},
    awards: {},
    finalMatch: { home: "", away: "", homeScore: "", awayScore: "" },
    finalScoreWinner: "",
    exactScore: false,
  };
  return {};
}

function normalizeKoshienEvent(event) {
  if (baseTemplateId(event.templateId) !== "koshien") return;
  const template = templates[event.templateId] || templates.koshien;
  event.config ||= createConfig(event.templateId);
  event.config.teams = Array.isArray(event.config.teams) ? event.config.teams : [...templates.koshien.teams];
  event.config.pickCount = Number(event.config.pickCount) || template.pickCount || templates.koshien.pickCount;
  event.config.stagePoints = { ...templates.koshien.stagePoints, ...(event.config.stagePoints || {}) };
  event.config.oddsBook ||= {};
  event.results ||= createResults(event.templateId);
  event.results.finishes ||= {};
  event.results.finalTotalScore = event.results.finalTotalScore ?? "";
  Object.keys(event.predictions || {}).forEach((name) => normalizeKoshienPrediction(event, name));
}

function normalizeKoshienPrediction(event, name) {
  event.predictions ||= {};
  event.predictions[name] ||= createPrediction(event.templateId);
  const prediction = event.predictions[name];
  const pickCount = Number(event.config?.pickCount) || templates.koshien.pickCount;
  prediction.teams = normalizeFixedArray(prediction.teams, pickCount);
  prediction.captain = prediction.captain || "";
  prediction.finalTotalScore = prediction.finalTotalScore ?? "";
}

function createWorldCupGroups(groupIds = templates.worldCup.groups, countries = []) {
  return groupIds.map((id, groupIndex) => ({
    id,
    teams: Array.from({ length: 4 }, (_, teamIndex) => countries[groupIndex * 4 + teamIndex] || ""),
  }));
}

function normalizeWorldCupEvent(event) {
  if (baseTemplateId(event.templateId) !== "worldCup") return;
  event.config ||= createConfig(event.templateId);
  event.config.activePhase ||= "phase1";
  event.config.phaseStatus = normalizeWorldCupPhaseStatus(event.config.phaseStatus);
  event.config.countries = Array.isArray(event.config.countries) ? event.config.countries : [...templates.worldCup.countries];
  if (!Array.isArray(event.config.groups) || !event.config.groups.length) {
    const template = templates[event.templateId] || templates.worldCup;
    event.config.groups = createWorldCupGroups(template.groups || templates.worldCup.groups, event.config.countries);
  }
  event.config.groups = event.config.groups.map((group, index) => ({
    id: group.id || String.fromCharCode(65 + index),
    teams: Array.from({ length: 4 }, (_, teamIndex) => group.teams?.[teamIndex] || ""),
  }));
  event.results ||= createResults(event.templateId);
  event.results.gl ||= {};
  event.results.thirdAdvancers = normalizeFixedArray(event.results.thirdAdvancers, 8);
  event.results.top4 = normalizeFixedArray(event.results.top4, 4);
  event.results.futures ||= {};
  event.results.awards ||= {};
  event.results.finalMatch ||= { home: "", away: "", homeScore: "", awayScore: "" };
  event.config.groups.forEach((group) => {
    event.results.gl[group.id] = {
      first: event.results.gl[group.id]?.first || "",
      second: event.results.gl[group.id]?.second || "",
    };
  });
  Object.keys(event.predictions || {}).forEach((name) => normalizeWorldCupPrediction(event, name));
}

function normalizeWorldCupPrediction(event, name) {
  event.predictions ||= {};
  event.predictions[name] ||= createPrediction(event.templateId);
  const prediction = event.predictions[name];
  prediction.glPicks ||= {};
  prediction.thirdAdvancers = normalizeFixedArray(prediction.thirdAdvancers, 8);
  prediction.top4 = normalizeFixedArray(prediction.top4, 4);
  prediction.futures = normalizeWorldCupFutures(prediction.futures);
  prediction.awards ||= {};
  prediction.finalScore ||= { home: "", away: "" };
  (event.config?.groups || []).forEach((group) => {
    prediction.glPicks[group.id] = {
      first: prediction.glPicks[group.id]?.first || "",
      second: prediction.glPicks[group.id]?.second || "",
    };
  });
}

function normalizeWorldCupFutures(value) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length: 10 }, (_, index) => ({
    country: source[index]?.country || "",
    finish: source[index]?.finish || "",
    odds: Number(source[index]?.odds) || 1,
  }));
}

function normalizeWorldCupPhaseStatus(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    phase1: ["open", "resultWait", "finalized"].includes(source.phase1) ? source.phase1 : "open",
    phase2: ["locked", "open", "resultWait", "finalized"].includes(source.phase2) ? source.phase2 : "locked",
    phase3: ["locked", "open", "resultWait", "finalized"].includes(source.phase3) ? source.phase3 : "locked",
  };
}

function worldCupPhaseStatus(phaseId) {
  normalizeWorldCupEvent(state.event);
  return state.event.config.phaseStatus?.[phaseId] || "locked";
}

const worldCupPhases = [
  { id: "phase1", label: "第1回 GL予想", caption: "グループ上位2カ国 + 3位突破8カ国" },
  { id: "phase2", label: "第2回 決勝T予想", caption: "1〜4位、複勝10枠、個人賞" },
  { id: "phase3", label: "第3回 決勝スコア", caption: "第2回までの暫定ptの5%を使う最終勝負" },
];

const worldCupAwardMarkets = [
  { id: "mvp", label: "MVP", points: 50 },
  { id: "topScorer", label: "得点王", points: 30 },
  { id: "bestGk", label: "GK賞", points: 30 },
  { id: "youngPlayer", label: "若手賞", points: 30 },
  { id: "fairPlay", label: "フェアプレー", points: 30 },
];

const worldCupFinishOptions = ["champion", "runnerUp", "third", "fourth", "best8", "best16"];

function normalizeFixedArray(value, length) {
  const source = Array.isArray(value) ? value : [];
  return Array.from({ length }, (_, index) => source[index] || "");
}

function render() {
  updateEventStatuses();
  if (els.leagueName) els.leagueName.value = state.leagueName;
  renderConnectionSettings();
  renderParticipants();
  renderTemplates();
  renderPresetDescription();
  updatePresetSummary();
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
  renderHomeReadinessPanel({ participant, myScore, missingTournamentCount, openEvents });
  renderApprovalPolicy();

  if (!els.homeTournamentCards) return;
  els.homeTournamentCards.innerHTML = openEvents.length
    ? openEvents.map((event) => {
      const missingCount = missingPredictionCountForEvent(event, participant);
      return tournamentCardMarkup(event, {
        status: "予想受付中",
        statusClass: "open",
        actionLabel: "YOSO",
        missingCount,
        showDeadline: true,
      });
    }).join("")
    : emptyTournamentMarkup("受付中の大会はありません");
}

function renderHomeReadinessPanel({ participant, myScore, missingTournamentCount, openEvents }) {
  if (!els.homeReadinessPanel) return;
  const activeEvent = openEvents[0] || state.event;
  const connection = normalizeConnectionSettings(state.connection);
  const hasSheetsTarget = connection.mode === "sheets" && connection.scriptUrl && connection.spreadsheetId && connection.leagueId;
  const storageLabel = connection.mode === "sheets" ? "Google Sheets" : "この端末";
  const syncLabel = hasSheetsTarget ? "接続情報保存済み" : connection.mode === "sheets" ? "接続情報待ち" : "Sheets準備中";
  els.homeReadinessPanel.innerHTML = `
    <article class="readiness-card primary-readiness">
      <div>
        <span class="match-kicker">NEXT ACTION</span>
        <strong>${missingTournamentCount > 0 ? "未入力のYOSOがあります" : "入力はひとまず完了"}</strong>
        <small>${escapeHtml(participant)} / ${escapeHtml(activeEvent?.name || "大会未設定")}</small>
      </div>
      <a class="primary-link" href="${missingTournamentCount > 0 ? "#prediction" : "#ranking"}">${missingTournamentCount > 0 ? "YOSOへ" : "ランキングへ"}</a>
    </article>
    <div class="readiness-grid">
      <article class="readiness-card">
        <span>保存先</span>
        <strong>${escapeHtml(storageLabel)}</strong>
        <small>${escapeHtml(syncLabel)}</small>
      </article>
      <article class="readiness-card">
        <span>公開URL</span>
        <strong>GitHub Pages</strong>
        <small>スマホ確認OK</small>
      </article>
      <article class="readiness-card">
        <span>自分のpt</span>
        <strong>${formatScore(myScore)}</strong>
        <small>確定済みフェーズを反映</small>
      </article>
    </div>
  `;
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
        actionLabel: "YOSO",
        missingCount: missingPredictionCountForEvent(event, currentParticipantName()),
        showDeadline: true,
        showManageActions: true,
      })).join("")
    : emptyTournamentMarkup("開催中の大会はありません");
}

function tournamentCardMarkup(event, { status, statusClass, actionLabel, missingCount, showDeadline, showManageActions = false }) {
  const sport = sportMeta(event.templateId);
  const template = templates[event.templateId];
  const candidateCount = candidateCountForEvent(event);
  const missingText = missingCount > 0 ? `未入力 ${missingCount}項目` : "入力済み";
  const adminOnly = isCurrentUserAdmin() ? "" : "disabled";
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
      <div class="tournament-actions ${showManageActions ? "is-manage" : ""}">
        <a class="primary-link" href="#prediction" data-event-action="predict" data-event-id="${escapeAttr(event.id)}">${escapeHtml(actionLabel)}</a>
        ${showManageActions
          ? `
            <a class="ghost-link admin-action ${adminOnly ? "is-disabled" : ""}" href="#prediction" data-event-action="result" data-event-id="${escapeAttr(event.id)}">結果入力</a>
            <button class="ghost-link danger-action admin-action" type="button" data-event-delete data-event-id="${escapeAttr(event.id)}" ${adminOnly}>削除</button>
          `
          : `<a class="ghost-link" href="#active" data-event-action="settings" data-event-id="${escapeAttr(event.id)}">大会編集</a>`}
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
  const adminOnly = isCurrentUserAdmin() ? "" : "disabled";
  const finalized = isResultFinalized(event);
  return `
    <article class="tournament-card muted-card">
      <div class="tournament-main">
        <span class="sport-icon" aria-hidden="true">${sport.icon}</span>
        <div>
          <span class="match-kicker">${finalized ? "確定済み" : "締切後"}</span>
          <strong>${escapeHtml(event.name || "結果待ち")}</strong>
          <small>${finalized ? "結果は確定済みで、ランキングに反映されています。" : "締切後は管理者の結果入力と参加者の承認に進みます。"}</small>
        </div>
      </div>
      <div class="tournament-chips">
        <span class="status-label ${finalized ? "open" : "pending"}">${finalized ? "結果確定" : "結果待ち"}</span>
      </div>
      <div class="tournament-actions is-manage">
        <a class="primary-link admin-action ${adminOnly || finalized ? "is-disabled" : ""}" href="#prediction" data-event-action="result" data-event-id="${escapeAttr(event.id)}">結果入力</a>
        <a class="ghost-link ${finalized ? "is-disabled" : ""}" href="#prediction" data-event-action="approve" data-event-id="${escapeAttr(event.id)}">結果承認</a>
        <button class="ghost-link danger-action admin-action" type="button" data-event-delete data-event-id="${escapeAttr(event.id)}" ${adminOnly}>削除</button>
      </div>
    </article>
  `;
}

function emptyTournamentMarkup(message) {
  return `<div class="history-row"><strong>${escapeHtml(message)}</strong><small>設定から大会を追加できます。</small></div>`;
}

function currentParticipantName() {
  const user = currentAuthUser();
  if (user?.displayName) return user.displayName;
  return state.participants[0] || "あなた";
}

function isCurrentUserAdmin() {
  const user = currentAuthUser();
  if (user?.role === "admin") return true;
  return currentParticipantName() === state.participants[0];
}

function eventsByStatus(...statuses) {
  const allowed = new Set(statuses);
  return (state.events || []).filter((event) => allowed.has(event.status || "open"));
}

function updateEventStatuses() {
  (state.events || []).forEach((event) => {
    if ((event.status || "open") !== "open" || !event.deadline) return;
    if (tournamentStatusFromDeadline(event.deadline) === "resultWait") event.status = "resultWait";
  });
  if (state.event?.id) {
    const latest = (state.events || []).find((event) => event.id === state.event.id);
    if (latest) state.event = latest;
  }
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
  return requiredApprovalCountForEvent(state.event);
}

function requiredApprovalCountForEvent(event = state.event) {
  const policy = event?.approvalPolicy || state.approvalPolicy;
  if (policy === "admin") return 1;
  if (policy === "unanimous") return Math.max(1, state.participants.length);
  return Math.max(1, Math.ceil(state.participants.length / 2));
}

function approvalCount(event = state.event) {
  return Object.keys(event?.resultFlow?.approvals || {}).filter((name) => event.resultFlow.approvals[name]).length;
}

function isResultFinalized(event = state.event) {
  return event?.resultFlow?.status === "finalized";
}

function submitResults() {
  ensureResultFlow();
  const name = currentParticipantName();
  state.event.resultFlow.status = "submitted";
  state.event.resultFlow.submittedBy = name;
  state.event.resultFlow.submittedAt = new Date().toISOString();
  state.event.resultFlow.approvals[name] = state.event.resultFlow.submittedAt;
  finalizeResultsIfReady();
  render();
}

function approveResults(name) {
  ensureResultFlow();
  const approver = name || currentParticipantName();
  if (!approver) return;
  state.event.resultFlow.status = state.event.resultFlow.status === "none" ? "submitted" : state.event.resultFlow.status;
  state.event.resultFlow.approvals[approver] = new Date().toISOString();
  finalizeResultsIfReady();
  render();
}

function finalizeResultsIfReady() {
  ensureResultFlow();
  if (approvalCount(state.event) < requiredApprovalCountForEvent(state.event)) return;
  state.event.resultFlow.status = "finalized";
  state.event.resultFlow.finalizedAt ||= new Date().toISOString();
}

function ensureResultFlow() {
  if (!state.event.resultFlow) state.event.resultFlow = createResultFlow();
  state.event.resultFlow = normalizeResultFlow(state.event.resultFlow, state.participants);
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
  if (base === "koshien") {
    normalizeKoshienPrediction(event, name);
    if ((event.status || "open") !== "open") return 0;
    const pickCount = Number(event.config?.pickCount) || templates.koshien.pickCount;
    const picks = normalizeFixedArray(prediction.teams, pickCount);
    const pickMissing = picks.filter((team) => !team).length;
    return pickMissing + (prediction.captain ? 0 : 1) + (prediction.finalTotalScore !== "" ? 0 : 1);
  }
  if (base === "fightCard") {
    return (event.config?.markets || templates.fightCard.markets).filter((market) => !prediction.picks[market.id]).length;
  }
  if (base === "worldCup") {
    normalizeWorldCupPrediction(event, name);
    const phase = event.config?.activePhase || "phase1";
    const status = event.config?.phaseStatus?.[phase] || "locked";
    if (status !== "open") return 0;
    if (phase === "phase2") {
      const top4Missing = normalizeFixedArray(prediction.top4, 4).filter((country) => !country).length;
      const futuresMissing = normalizeWorldCupFutures(prediction.futures).filter((future) => !future.country || !future.finish).length;
      const awardsMissing = worldCupAwardMarkets.filter((award) => !prediction.awards?.[award.id]).length;
      return top4Missing + futuresMissing + awardsMissing;
    }
    if (phase === "phase3") {
      return prediction.finalScore?.home !== "" && prediction.finalScore?.away !== "" ? 0 : 1;
    }
    const groupMissing = (event.config?.groups || []).reduce((total, group) => {
      const pick = prediction.glPicks?.[group.id] || {};
      return total + (pick.first ? 0 : 1) + (pick.second ? 0 : 1);
    }, 0);
    const thirdMissing = normalizeFixedArray(prediction.thirdAdvancers, 8).filter((country) => !country).length;
    return groupMissing + thirdMissing;
  }
  return 0;
}

function ensurePredictionForEvent(event, name) {
  event.predictions ||= {};
  if (!event.predictions[name]) event.predictions[name] = createPrediction(event.templateId);
  if (baseTemplateId(event.templateId) === "koshien") normalizeKoshienPrediction(event, name);
  if (baseTemplateId(event.templateId) === "worldCup") normalizeWorldCupPrediction(event, name);
}

function formatDeadline(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
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
    status: tournamentStatusFromDeadline(els.newTournamentDeadline?.value || ""),
    approvalPolicy: state.approvalPolicy || "half",
  });
  return event;
}

function tournamentStatusFromDeadline(deadline) {
  if (!deadline) return "open";
  const time = new Date(deadline).getTime();
  if (Number.isNaN(time)) return "open";
  return time <= Date.now() ? "resultWait" : "open";
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

function resultFlowPanel() {
  if (baseTemplateId(state.event.templateId) === "worldCup") return "";
  ensureResultFlow();
  const flow = state.event.resultFlow;
  if (state.event.status === "open" && flow.status === "none") return "";
  const required = requiredApprovalCountForEvent(state.event);
  const approvedNames = Object.keys(flow.approvals || {}).filter((name) => flow.approvals[name]);
  const approvedText = approvedNames.length ? approvedNames.join("、") : "まだ承認なし";
  const isResultWait = state.event.status === "resultWait";
  const finalized = isResultFinalized(state.event);
  const canSubmit = isResultWait && isCurrentUserAdmin() && !finalized;
  const canApprove = isResultWait && flow.status === "submitted" && !finalized;
  const approverOptions = state.participants
    .filter((name) => !flow.approvals?.[name])
    .map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`)
    .join("");
  const statusText = finalized
    ? "結果確定済み"
    : flow.status === "submitted"
      ? `承認待ち ${approvalCount(state.event)} / ${required}`
      : isResultWait
        ? "結果入力待ち"
        : "予想受付中";
  return `
    <div class="entry-block result-flow-panel">
      <div class="result-flow-head">
        <div>
          <span class="match-kicker">RESULT FLOW</span>
          <h3>${escapeHtml(statusText)}</h3>
          <p class="helper-text">${escapeHtml(resultFlowMessage())}</p>
        </div>
        <span class="status-label ${finalized ? "open" : "pending"}">${escapeHtml(flow.status === "none" ? "未提出" : flow.status === "submitted" ? "承認待ち" : "確定")}</span>
      </div>
      <div class="result-flow-meta">
        <span>必要承認: ${required}人</span>
        <span>承認済み: ${escapeHtml(approvedText)}</span>
      </div>
      <div class="result-flow-actions">
        ${canSubmit ? `<button class="primary-button" type="button" data-result-submit>結果を提出</button>` : ""}
        ${canApprove && approverOptions ? `
          <select data-result-approver>${approverOptions}</select>
          <button class="ghost-button" type="button" data-result-approve>承認する</button>
        ` : ""}
      </div>
    </div>
  `;
}

function resultFlowMessage() {
  if (isResultFinalized(state.event)) return "承認条件を満たしたため、この大会の結果はランキングに反映されています。";
  if (state.event.status === "resultWait" && state.event.resultFlow?.status === "submitted") {
    return "結果は提出済みです。必要承認数に達するまでランキングには反映されません。";
  }
  if (state.event.status === "resultWait") return "管理者が結果を入力して提出すると、参加者承認へ進みます。";
  return "予想受付中です。結果はまだランキングに反映されません。";
}

function updatePresetSummary() {
  if (!els.presetDetails || !els.presetSummary) return;
  els.presetSummary.textContent = els.presetDetails.open ? "▼ プリセット一覧を閉じる" : "▶ プリセット一覧を表示";
}

function renderEvent() {
  ensureResultFlow();
  const template = templates[state.event.templateId];
  els.eventTitle.textContent = state.event.name;
  els.eventSubtitle.textContent = template.subtitle;
  const base = baseTemplateId(template.id);
  if (base === "rankingOdds") renderRankingOddsForm();
  if (base === "draft") renderDraftForm();
  if (base === "koshien") renderKoshienForm();
  if (base === "fightCard") renderFightForm();
  if (base === "worldCup") renderWorldCupTournamentForm();
}

function renderRankingOddsForm() {
  const template = { ...templates.rankingOdds, ...templates[state.event.templateId] };
  const teams = getTeams();
  els.eventForm.innerHTML = `
    ${resultFlowPanel()}
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
    ${resultFlowPanel()}
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

function renderKoshienForm() {
  normalizeKoshienEvent(state.event);
  const teams = getTeams();
  const participant = currentParticipantName();
  const showPublic = state.event.status !== "open" || isResultFinalized(state.event);
  els.eventForm.innerHTML = `
    ${resultFlowPanel()}
    <div class="worldcup-phase-panel koshien-preset-panel">
      <span class="match-kicker">KOSHIEN 2026 / 8 TEAM PICK</span>
      <h3>夏の甲子園 8校ピック</h3>
      <p>49代表から8校を選び、キャプテン校は2倍で加点します。準々決勝以降の再抽選に左右されない、甲子園向けのYOSOプリセットです。</p>
      <div class="koshien-score-strip">
        ${koshienStageOptions.map((stage) => `<span>${stage.label} +${stage.points}</span>`).join("")}
      </div>
    </div>
    <div class="form-grid">
      <label class="field"><span>イベント名</span><input data-path="event.name" value="${escapeAttr(state.event.name)}"></label>
      <label class="field"><span>決勝合計得点 結果</span><input data-koshien-final-total-result type="number" min="0" step="1" value="${escapeAttr(state.event.results.finalTotalScore)}"></label>
    </div>
    ${editableTeamsBlock("49代表校", teams)}
    ${koshienResultBlock(teams)}
    ${participantKoshienBlock(participant, teams)}
    ${showPublic ? koshienPublicPredictions(teams) : ""}
  `;
  bindGenericInputs();
}

const koshienStageOptions = [
  { value: "best32", label: "32強", points: 1 },
  { value: "best16", label: "16強", points: 2 },
  { value: "best8", label: "8強", points: 4 },
  { value: "semifinal", label: "4強", points: 8 },
  { value: "runnerUp", label: "決勝", points: 16 },
  { value: "champion", label: "優勝", points: 32 },
];

function koshienResultBlock(teams) {
  return `
    <div class="entry-block koshien-results">
      <div class="block-head">
        <div>
          <h3>勝ち上がり結果</h3>
          <p class="helper-text">管理者が各校の到達段階を入力します。優勝校は「優勝」、準優勝校は「決勝」を選びます。</p>
        </div>
      </div>
      <div class="koshien-result-list">
        ${teams.map((team) => `
          <div class="draft-row koshien-result-row">
            <span class="pill">${escapeHtml(team)}</span>
            <select data-koshien-finish="${escapeAttr(team)}">${optionList(["", ...koshienStageOptions.map((stage) => stage.value)], state.event.results.finishes[team])}</select>
            <span class="sub-label">${labelForOption(state.event.results.finishes[team])}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function participantKoshienBlock(name, teams) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  const picks = normalizeFixedArray(prediction.teams, state.event.config.pickCount || 8);
  const pickedTeams = [...new Set(picks.filter(Boolean))];
  return `
    <div class="entry-block koshien-participant">
      <div class="wc-participant-head">
        <h3>${escapeHtml(name)} のYOSO</h3>
        <span>${pickedTeams.length} / ${picks.length}</span>
      </div>
      <p class="wc-phase-intro">8校を選び、その中からキャプテンを1校選びます。友達同士で同じ学校を選んでもOKです。</p>
      <div class="prediction-grid koshien-pick-grid">
        ${picks.map((pick, index) => `
          <label class="field">
            <span>指名${index + 1}</span>
            <select data-koshien-pick="${escapeAttr(name)}:${index}">${optionList(teams, pick)}</select>
          </label>
        `).join("")}
      </div>
      <div class="form-grid">
        <label class="field"><span>キャプテン校</span><select data-koshien-captain="${escapeAttr(name)}">${optionList(pickedTeams, prediction.captain)}</select></label>
        <label class="field"><span>決勝合計得点予想</span><input data-koshien-final-total="${escapeAttr(name)}" type="number" min="0" step="1" value="${escapeAttr(prediction.finalTotalScore)}"></label>
      </div>
    </div>
  `;
}

function koshienPublicPredictions() {
  return `
    <div class="entry-block koshien-results">
      <h3>締切後公開: 全員のYOSO</h3>
      <div class="history-list">
        ${state.participants.map((name) => `
          <div class="history-row wc-public-row">
            <strong>${escapeHtml(name)}</strong>
            <small>${escapeHtml(koshienPredictionSummary(name))}</small>
            <span>${escapeHtml(koshienPredictionDetails(name))}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function koshienPredictionSummary(name) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  const picked = normalizeFixedArray(prediction.teams, state.event.config.pickCount || 8).filter(Boolean);
  return `指名 ${picked.length}/${state.event.config.pickCount || 8}、キャプテン ${prediction.captain || "未選択"}、決勝合計 ${prediction.finalTotalScore || "未入力"}`;
}

function koshienPredictionDetails(name) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  const picked = normalizeFixedArray(prediction.teams, state.event.config.pickCount || 8).filter(Boolean);
  return picked.join(" / ") || "未入力";
}

function renderFightForm() {
  const markets = getMarkets();
  els.eventForm.innerHTML = `
    ${resultFlowPanel()}
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

function getWorldCupGroups() {
  normalizeWorldCupEvent(state.event);
  return state.event.config.groups || [];
}

function worldCupPhaseOneResultBlock(groups, countries) {
  if (!["resultWait", "finalized"].includes(worldCupPhaseStatus("phase1"))) return "";
  return `
    <div class="entry-block worldcup-results">
      <h3>実際のグループリーグ結果</h3>
      <div class="wc-group-grid">
        ${groups.map((group) => `
          <div class="wc-group-card">
            <div class="wc-group-head">
              <strong>Group ${escapeHtml(group.id)}</strong>
              <span>${group.teams.filter(Boolean).length || 4} teams</span>
            </div>
            ${worldCupTeamList(group)}
            <label class="field"><span>1位結果</span><select data-wc-gl-result="${escapeAttr(group.id)}:first">${optionList(countryOptionsForGroup(group, countries), state.event.results.gl[group.id]?.first)}</select></label>
            <label class="field"><span>2位結果</span><select data-wc-gl-result="${escapeAttr(group.id)}:second">${optionList(countryOptionsForGroup(group, countries), state.event.results.gl[group.id]?.second)}</select></label>
          </div>
        `).join("")}
      </div>
      <div class="wc-third-section">
        <h4>3位突破国 8カ国</h4>
        <div class="wc-third-grid">
          ${Array.from({ length: 8 }).map((_, index) => `
            <label class="field"><span>${index + 1}枠</span><select data-wc-third-result="${index}">${optionList(countries, state.event.results.thirdAdvancers[index])}</select></label>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function participantWorldCupPhaseOneBlock(name, groups, countries) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  const pickedCount = worldCupPickedCount(prediction, groups);
  return `
    <div class="entry-block worldcup-participant">
      <div class="wc-participant-head">
        <h3>${escapeHtml(name)}</h3>
        <span>${pickedCount} / 32 入力済み</span>
      </div>
      <div class="wc-group-grid">
        ${groups.map((group) => {
          const pick = prediction.glPicks[group.id] || { first: "", second: "" };
          const options = countryOptionsForGroup(group, countries);
          return `
            <div class="wc-group-card">
              <div class="wc-group-head">
                <strong>Group ${escapeHtml(group.id)}</strong>
                <span>上位2カ国</span>
              </div>
              ${worldCupTeamList(group)}
              <label class="field"><span>1位予想</span><select data-wc-gl-pick="${escapeAttr(name)}:${escapeAttr(group.id)}:first">${optionList(options, pick.first)}</select></label>
              <label class="field"><span>2位予想</span><select data-wc-gl-pick="${escapeAttr(name)}:${escapeAttr(group.id)}:second">${optionList(options, pick.second)}</select></label>
            </div>
          `;
        }).join("")}
      </div>
      <div class="wc-third-section">
        <div class="wc-participant-head">
          <h4>3位突破国 8カ国</h4>
          <span>${prediction.thirdAdvancers.filter(Boolean).length} / 8</span>
        </div>
        <div class="wc-third-grid">
          ${Array.from({ length: 8 }).map((_, index) => `
            <label class="field"><span>${index + 1}枠</span><select data-wc-third-pick="${escapeAttr(name)}:${index}">${optionList(countries, prediction.thirdAdvancers[index])}</select></label>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function worldCupTeamList(group) {
  const teams = group.teams.filter(Boolean);
  if (!teams.length) return `<div class="wc-team-list"><span>参加国未設定</span></div>`;
  return `<div class="wc-team-list">${teams.map((team) => `<span>${escapeHtml(team)}</span>`).join("")}</div>`;
}

function countryOptionsForGroup(group, countries) {
  const groupTeams = group.teams.filter(Boolean);
  return [...new Set([...groupTeams, ...countries])];
}

function worldCupPickedCount(prediction, groups) {
  const groupCount = groups.reduce((total, group) => {
    const pick = prediction.glPicks?.[group.id] || {};
    return total + (pick.first ? 1 : 0) + (pick.second ? 1 : 0);
  }, 0);
  return groupCount + normalizeFixedArray(prediction.thirdAdvancers, 8).filter(Boolean).length;
}

function renderWorldCupTournamentForm() {
  normalizeWorldCupEvent(state.event);
  const countries = getCountries();
  const groups = getWorldCupGroups();
  const activePhase = state.event.config.activePhase || "phase1";
  const activeStatus = worldCupPhaseStatus(activePhase);
  const participant = currentParticipantName();
  const showPublic = ["resultWait", "finalized"].includes(activeStatus);
  els.eventForm.innerHTML = `
    ${resultFlowPanel()}
    <div class="worldcup-phase-panel">
      <span class="match-kicker">WORLD CUP 2026 / YOSO PRESET</span>
      <h3>W杯2026 予想王決定戦</h3>
      <p>この大会は通常の複合型ではなく、第1回・第2回・第3回が点数でつながるW杯専用プリセットです。入力は自分のYOSOだけ、締切後に全員分を公開します。</p>
      <div class="worldcup-rule-strip">
        ${worldCupPhases.map((phase) => `<button class="wc-phase-tab ${phase.id === activePhase ? "is-active" : ""}" type="button" data-wc-phase="${phase.id}">${phase.label}<small>${worldCupPhaseStatusLabel(worldCupPhaseStatus(phase.id))}</small></button>`).join("")}
      </div>
      ${worldCupPhaseAdminControls()}
      ${worldCupPhaseGuide(activePhase, activeStatus, participant, groups)}
    </div>
    <div class="form-grid">
      <label class="field"><span>大会名</span><input data-path="event.name" value="${escapeAttr(state.event.name)}"></label>
    </div>
    ${worldCupCountrySeedBlock(countries, groups)}
    ${activePhase === "phase1" ? worldCupPhaseOneScreen(participant, groups, countries, showPublic) : ""}
    ${activePhase === "phase2" ? worldCupPhaseTwoScreen(participant, countries, showPublic) : ""}
    ${activePhase === "phase3" ? worldCupPhaseThreeScreen(participant, countries, showPublic) : ""}
  `;
  bindGenericInputs();
}

function worldCupPhaseGuide(phase, status, participant, groups) {
  const phaseInfo = worldCupPhases.find((item) => item.id === phase) || worldCupPhases[0];
  const progress = worldCupPhaseProgress(participant, phase, groups);
  const actionText = {
    locked: "このフェーズはまだ入力できません。",
    open: `${participant} のYOSOを入力できます。`,
    resultWait: "受付は締切済みです。管理者が結果を入力できます。",
    finalized: "このフェーズは確定済みです。ランキングに反映されています。",
  }[status] || "";
  return `
    <div class="wc-phase-guide">
      <div>
        <span class="match-kicker">${escapeHtml(phaseInfo.caption)}</span>
        <strong>${escapeHtml(actionText)}</strong>
      </div>
      <div class="wc-progress-meter" aria-label="入力進捗">
        <span>${progress.done} / ${progress.total}</span>
        <div><i style="width: ${progress.percent}%"></i></div>
      </div>
    </div>
  `;
}

function worldCupPhaseProgress(name, phase, groups) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  if (phase === "phase1") {
    const done = worldCupPickedCount(prediction, groups);
    const total = (groups.length * 2) + 8;
    return { done, total, percent: progressPercent(done, total) };
  }
  if (phase === "phase2") {
    const top4Done = normalizeFixedArray(prediction.top4, 4).filter(Boolean).length;
    const futuresDone = normalizeWorldCupFutures(prediction.futures).filter((future) => future.country && future.finish).length;
    const awardsDone = worldCupAwardMarkets.filter((award) => prediction.awards?.[award.id]).length;
    const done = top4Done + futuresDone + awardsDone;
    return { done, total: 19, percent: progressPercent(done, 19) };
  }
  const final = prediction.finalScore || {};
  const done = (final.home !== "" ? 1 : 0) + (final.away !== "" ? 1 : 0);
  return { done, total: 2, percent: progressPercent(done, 2) };
}

function progressPercent(done, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

function worldCupCountrySeedBlock(countries, groups) {
  if (!isCurrentUserAdmin()) return "";
  const canEditSeeds = worldCupPhaseStatus("phase1") === "open";
  return `
    <details class="entry-block wc-seed-editor">
      <summary class="odds-summary">
        <span>
          <strong>出場国とグループ割り</strong>
          <small>国リストの順番で、AからLまで4カ国ずつ自動配置します。</small>
        </span>
      </summary>
      <div class="odds-tools-body">
        <div class="block-head">
          <div>
            <h3>出場国/候補国</h3>
            <p class="helper-text">${canEditSeeds ? "確定国が増えたらここを更新します。第1回のグループ表示と予想候補に反映されます。" : "第1回の受付開始後に使った国リストです。締切後は変更できません。"}</p>
          </div>
          <button class="ghost-button small-button" type="button" data-list-add="countries" ${canEditSeeds ? "" : "disabled"}>＋国を追加</button>
        </div>
        <div class="edit-list">
          ${countries.map((country, index) => `
            <div class="edit-row">
              <label class="field compact-field">
                <span>${worldCupSeedLabel(index)}</span>
                <input data-list-row="countries:${index}" value="${escapeAttr(country)}" placeholder="例: 日本" ${canEditSeeds ? "" : "disabled"}>
              </label>
              <button class="icon-button danger-button" type="button" data-list-remove="countries:${index}" aria-label="削除" ${canEditSeeds ? "" : "disabled"}>×</button>
            </div>
          `).join("")}
        </div>
        <div class="wc-seed-preview">
          ${groups.map((group) => `
            <div>
              <strong>Group ${escapeHtml(group.id)}</strong>
              <span>${group.teams.filter(Boolean).map(escapeHtml).join(" / ") || "未設定"}</span>
            </div>
          `).join("")}
        </div>
      </div>
    </details>
  `;
}

function worldCupSeedLabel(index) {
  const group = templates.worldCup.groups[Math.floor(index / 4)] || "-";
  return `Group ${group} ${index % 4 + 1}枠`;
}

function worldCupPhaseOneScreen(participant, groups, countries, showPublic) {
  return `
    ${worldCupPhaseOneResultBlock(groups, countries)}
    ${participantWorldCupPhaseOneBlock(participant, groups, countries)}
    ${showPublic ? worldCupPublicPredictions("phase1", groups, countries) : ""}
  `;
}

function worldCupPhaseTwoScreen(participant, countries, showPublic) {
  return `
    ${worldCupPhaseTwoResultBlock(countries)}
    ${participantWorldCupPhaseTwoBlock(participant, countries)}
    ${showPublic ? worldCupPublicPredictions("phase2", [], countries) : ""}
  `;
}

function worldCupPhaseThreeScreen(participant, countries, showPublic) {
  return `
    ${worldCupPhaseThreeResultBlock(countries)}
    ${participantWorldCupPhaseThreeBlock(participant)}
    ${worldCupStakePreview()}
    ${showPublic ? worldCupPublicPredictions("phase3", [], countries) : ""}
  `;
}

function worldCupPhaseAdminControls() {
  if (!isCurrentUserAdmin()) return "";
  return `
    <div class="wc-phase-admin">
      ${worldCupPhases.map((phase) => `
        <label class="field compact-field">
          <span>${phase.label}</span>
          <select data-wc-phase-status="${phase.id}">
            ${worldCupPhaseStatusOptions(phase.id).map((status) => `<option value="${status}" ${status === worldCupPhaseStatus(phase.id) ? "selected" : ""}>${worldCupPhaseStatusLabel(status)}</option>`).join("")}
          </select>
        </label>
      `).join("")}
    </div>
  `;
}

function worldCupPhaseStatusOptions(phaseId) {
  return phaseId === "phase1" ? ["open", "resultWait", "finalized"] : ["locked", "open", "resultWait", "finalized"];
}

function worldCupPhaseStatusLabel(status) {
  return { locked: "ロック中", open: "受付中", resultWait: "結果待ち", finalized: "確定済み" }[status] || status;
}

function worldCupPhaseTwoResultBlock(countries) {
  if (!["resultWait", "finalized"].includes(worldCupPhaseStatus("phase2"))) return "";
  return `
    <div class="entry-block worldcup-results">
      <h3>第2回 結果入力</h3>
      <div class="prediction-grid">
        ${[0, 1, 2, 3].map((index) => `
          <label class="field"><span>${index + 1}位結果</span><select data-wc-top-result="${index}">${optionList(countries, state.event.results.top4[index])}</select></label>
        `).join("")}
      </div>
      <div class="wc-third-section">
        <h4>ベスト16以上の到達結果</h4>
        ${countries.map((country) => `
          <div class="draft-row">
            <span class="pill">${escapeHtml(country)}</span>
            <select data-wc-country-finish="${escapeAttr(country)}">${optionList(["", ...worldCupFinishOptions], state.event.results.futures[country])}</select>
            <span class="sub-label">${labelForOption(state.event.results.futures[country]) || "未確定"}</span>
          </div>
        `).join("")}
      </div>
      <div class="wc-third-section">
        <h4>個人賞受賞国</h4>
        <div class="wc-third-grid">
          ${worldCupAwardMarkets.map((award) => `
            <label class="field"><span>${award.label}</span><select data-wc-award-result="${award.id}">${optionList(countries, state.event.results.awards[award.id])}</select></label>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function participantWorldCupPhaseTwoBlock(name, countries) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  return `
    <div class="entry-block worldcup-participant">
      <div class="wc-participant-head">
        <h3>${escapeHtml(name)} のYOSO</h3>
        <span>第2回</span>
      </div>
      <p class="wc-phase-intro">1〜4位を選び、さらにベスト16以上へ進みそうな国を10枠まで選びます。複勝枠は到達点とオッズで加点します。</p>
      <div class="prediction-grid">
        ${[0, 1, 2, 3].map((index) => `
          <label class="field"><span>${index + 1}位予想</span><select data-wc-top-pick="${escapeAttr(name)}:${index}">${optionList(countries, prediction.top4[index])}</select></label>
        `).join("")}
      </div>
      <div class="wc-third-section">
        <h4>複勝枠 10カ国</h4>
        <div class="wc-future-list">
          ${Array.from({ length: 10 }).map((_, index) => {
            const future = prediction.futures[index] || { country: "", finish: "", odds: 1 };
            return `
              <div class="phase-row wc-future-row">
                <span class="wc-row-index">${index + 1}</span>
                <label>
                  <span class="wc-row-label">国</span>
                  <select data-wc-future-country="${escapeAttr(name)}:${index}">${optionList(countries, future.country)}</select>
                </label>
                <label>
                  <span class="wc-row-label">到達</span>
                  <select data-wc-future-finish="${escapeAttr(name)}:${index}">${optionList(["", ...worldCupFinishOptions], future.finish)}</select>
                </label>
                <label>
                  <span class="wc-row-label">倍率</span>
                  <input data-wc-future-odds="${escapeAttr(name)}:${index}" type="number" min="0" max="200" step="0.1" value="${formatOddsInput(future.odds || 1)}">
                </label>
                <span class="sub-label">到達点 × オッズ</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>
      <div class="wc-third-section">
        <h4>個人賞受賞国</h4>
        <div class="wc-third-grid">
          ${worldCupAwardMarkets.map((award) => `
            <label class="field"><span>${award.label}</span><select data-wc-award-pick="${escapeAttr(name)}:${award.id}">${optionList(countries, prediction.awards[award.id])}</select></label>
          `).join("")}
        </div>
      </div>
    </div>
  `;
}

function worldCupPhaseThreeResultBlock(countries) {
  if (!["resultWait", "finalized"].includes(worldCupPhaseStatus("phase3"))) return "";
  const final = state.event.results.finalMatch || {};
  return `
    <div class="entry-block worldcup-results">
      <h3>第3回 決勝戦結果</h3>
      <div class="form-grid">
        <label class="field"><span>決勝 ホーム側</span><select data-wc-final-result="home">${optionList(countries, final.home)}</select></label>
        <label class="field"><span>決勝 アウェイ側</span><select data-wc-final-result="away">${optionList(countries, final.away)}</select></label>
        <label class="field"><span>ホーム得点</span><input data-wc-final-result="homeScore" type="number" min="0" step="1" value="${escapeAttr(final.homeScore)}"></label>
        <label class="field"><span>アウェイ得点</span><input data-wc-final-result="awayScore" type="number" min="0" step="1" value="${escapeAttr(final.awayScore)}"></label>
      </div>
    </div>
  `;
}

function participantWorldCupPhaseThreeBlock(name) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  return `
    <div class="entry-block worldcup-participant">
      <div class="wc-participant-head">
        <h3>${escapeHtml(name)} のYOSO</h3>
        <span>第3回 決勝スコア</span>
      </div>
      <div class="form-grid">
        <label class="field"><span>決勝 ホーム側得点</span><input data-wc-final-score="${escapeAttr(name)}:home" type="number" min="0" step="1" value="${escapeAttr(prediction.finalScore.home)}"></label>
        <label class="field"><span>決勝 アウェイ側得点</span><input data-wc-final-score="${escapeAttr(name)}:away" type="number" min="0" step="1" value="${escapeAttr(prediction.finalScore.away)}"></label>
      </div>
    </div>
  `;
}

function worldCupStakePreview() {
  const rows = worldCupSettlementRows();
  const pool = rows.reduce((total, row) => total + row.stake, 0);
  const final = state.event.results.finalMatch || {};
  const finalScoreKnown = final.homeScore !== "" && final.awayScore !== "";
  return `
    <div class="entry-block worldcup-results">
      <h3>5%ベット暫定計算</h3>
      <p class="helper-text">第1回 + 第2回の暫定ptから5%を掛け金として計算します。最終反映は結果確定後です。</p>
      <div class="history-list">
        ${rows.map((row) => `
          <div class="history-row">
            <span>${escapeHtml(row.name)}</span>
            <strong>${formatScore(row.base)}pt / 掛け金 ${formatScore(row.stake)}pt</strong>
            <small>${finalScoreKnown ? (row.exact ? `ピタリ賞込み +${formatScore(row.phase3)}pt` : `${formatScore(row.phase3)}pt`) : "決勝結果待ち"}</small>
          </div>
        `).join("")}
      </div>
      <div class="insight-band">プール合計 ${formatScore(pool)}pt</div>
    </div>
  `;
}

function worldCupPublicPredictions(phase, groups, countries) {
  return `
    <div class="entry-block worldcup-results">
      <h3>締切後公開: 全員のYOSO</h3>
      <div class="history-list">
        ${state.participants.map((name) => `
          <div class="history-row wc-public-row">
            <strong>${escapeHtml(name)}</strong>
            <small>${escapeHtml(worldCupPredictionSummary(name, phase, groups, countries))}</small>
            <span>${worldCupPredictionDetails(name, phase, groups)}</span>
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

function worldCupPredictionSummary(name, phase, groups) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  if (phase === "phase1") return `${worldCupPickedCount(prediction, groups)} / ${(groups.length * 2) + 8} 入力済み`;
  if (phase === "phase2") {
    const futuresDone = normalizeWorldCupFutures(prediction.futures).filter((future) => future.country && future.finish).length;
    return `単勝 ${prediction.top4.filter(Boolean).length}/4、複勝 ${futuresDone}/10、個人賞 ${Object.values(prediction.awards || {}).filter(Boolean).length}/5`;
  }
  return `決勝スコア ${prediction.finalScore?.home !== "" && prediction.finalScore?.away !== "" ? `${prediction.finalScore.home}-${prediction.finalScore.away}` : "未入力"}`;
}

function worldCupPredictionDetails(name, phase, groups) {
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  if (phase === "phase1") {
    const groupText = groups.map((group) => {
      const pick = prediction.glPicks?.[group.id] || {};
      return `${group.id}: ${pick.first || "-"} / ${pick.second || "-"}`;
    }).join(" | ");
    const thirdText = normalizeFixedArray(prediction.thirdAdvancers, 8).filter(Boolean).join("、") || "-";
    return escapeHtml(`${groupText} / 3位突破: ${thirdText}`);
  }
  if (phase === "phase2") {
    const top4Text = normalizeFixedArray(prediction.top4, 4)
      .map((country, index) => `${index + 1}位 ${country || "-"}`)
      .join(" / ");
    const futuresText = normalizeWorldCupFutures(prediction.futures)
      .filter((future) => future.country || future.finish)
      .map((future) => `${future.country || "-"} ${labelForOption(future.finish)} x${formatOddsInput(future.odds || 1)}`)
      .join("、") || "-";
    const awardsText = worldCupAwardMarkets
      .map((award) => `${award.label}: ${prediction.awards?.[award.id] || "-"}`)
      .join(" / ");
    return escapeHtml(`${top4Text} / 複勝: ${futuresText} / 個人賞: ${awardsText}`);
  }
  return escapeHtml(`決勝スコア: ${prediction.finalScore?.home || "-"}-${prediction.finalScore?.away || "-"}`);
}

function bindGenericInputs() {
  els.eventForm.querySelectorAll("[data-wc-phase]").forEach((button) => {
    button.addEventListener("click", () => {
      state.event.config.activePhase = button.dataset.wcPhase;
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-phase-status]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.config.phaseStatus ||= normalizeWorldCupPhaseStatus();
      state.event.config.phaseStatus[input.dataset.wcPhaseStatus] = input.value;
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-path]").forEach((input) => {
    input.addEventListener("input", () => setByPath(input.dataset.path, coerceValue(input.value)));
  });
  els.eventForm.querySelectorAll("[data-list-row]").forEach((input) => {
    input.addEventListener("change", () => {
      const [key, indexRaw] = input.dataset.listRow.split(":");
      ensureEditableList(key);
      state.event.config[key][Number(indexRaw)] = input.value.trim();
      state.event.config[key] = state.event.config[key].filter(Boolean);
      syncEditableListDependents(key);
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-list-add]").forEach((button) => {
    button.addEventListener("click", () => {
      const list = ensureEditableList(button.dataset.listAdd);
      list.push("");
      syncEditableListDependents(button.dataset.listAdd);
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-list-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      const [key, indexRaw] = button.dataset.listRemove.split(":");
      const list = ensureEditableList(key);
      list.splice(Number(indexRaw), 1);
      syncEditableListDependents(key);
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-config-list]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.config[input.dataset.configList] = parseLines(input.value);
      syncEditableListDependents(input.dataset.configList);
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
  els.eventForm.querySelectorAll("[data-result-submit]").forEach((button) => {
    button.addEventListener("click", submitResults);
  });
  els.eventForm.querySelectorAll("[data-result-approve]").forEach((button) => {
    button.addEventListener("click", () => {
      const select = button.closest(".result-flow-actions")?.querySelector("[data-result-approver]");
      approveResults(select?.value || currentParticipantName());
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
  els.eventForm.querySelectorAll("[data-koshien-finish]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.results.finishes[input.dataset.koshienFinish] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-koshien-final-total-result]").forEach((input) => {
    input.addEventListener("input", () => {
      state.event.results.finalTotalScore = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-koshien-pick]").forEach((input) => {
    input.addEventListener("change", () => {
      const [name, index] = input.dataset.koshienPick.split(":");
      ensurePrediction(name);
      state.event.predictions[name].teams[Number(index)] = input.value;
      if (state.event.predictions[name].captain && !state.event.predictions[name].teams.includes(state.event.predictions[name].captain)) {
        state.event.predictions[name].captain = "";
      }
      render();
    });
  });
  els.eventForm.querySelectorAll("[data-koshien-captain]").forEach((input) => {
    input.addEventListener("change", () => {
      ensurePrediction(input.dataset.koshienCaptain);
      state.event.predictions[input.dataset.koshienCaptain].captain = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-koshien-final-total]").forEach((input) => {
    input.addEventListener("input", () => {
      ensurePrediction(input.dataset.koshienFinalTotal);
      state.event.predictions[input.dataset.koshienFinalTotal].finalTotalScore = input.value;
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
  els.eventForm.querySelectorAll("[data-wc-gl-result]").forEach((input) => {
    input.addEventListener("change", () => {
      const [groupId, place] = input.dataset.wcGlResult.split(":");
      state.event.results.gl[groupId] ||= { first: "", second: "" };
      state.event.results.gl[groupId][place] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-third-result]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.results.thirdAdvancers[Number(input.dataset.wcThirdResult)] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-country-finish]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.results.futures[input.dataset.wcCountryFinish] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-award-result]").forEach((input) => {
    input.addEventListener("change", () => {
      state.event.results.awards[input.dataset.wcAwardResult] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-final-result]").forEach((input) => {
    input.addEventListener("input", () => {
      state.event.results.finalMatch ||= { home: "", away: "", homeScore: "", awayScore: "" };
      state.event.results.finalMatch[input.dataset.wcFinalResult] = input.value;
      renderScoresOnly();
    });
    input.addEventListener("change", () => {
      state.event.results.finalMatch ||= { home: "", away: "", homeScore: "", awayScore: "" };
      state.event.results.finalMatch[input.dataset.wcFinalResult] = input.value;
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
  els.eventForm.querySelectorAll("[data-wc-gl-pick]").forEach((input) => {
    input.addEventListener("change", () => {
      const [name, groupId, place] = input.dataset.wcGlPick.split(":");
      ensurePrediction(name);
      state.event.predictions[name].glPicks[groupId] ||= { first: "", second: "" };
      state.event.predictions[name].glPicks[groupId][place] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-third-pick]").forEach((input) => {
    input.addEventListener("change", () => {
      const [name, index] = input.dataset.wcThirdPick.split(":");
      ensurePrediction(name);
      state.event.predictions[name].thirdAdvancers[Number(index)] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-future-country], [data-wc-future-finish], [data-wc-future-odds]").forEach((input) => {
    input.addEventListener("input", updateFutureInput);
    input.addEventListener("change", updateFutureInput);
  });
  els.eventForm.querySelectorAll("[data-wc-award-pick]").forEach((input) => {
    input.addEventListener("change", () => {
      const [name, awardId] = input.dataset.wcAwardPick.split(":");
      ensurePrediction(name);
      state.event.predictions[name].awards[awardId] = input.value;
      renderScoresOnly();
    });
  });
  els.eventForm.querySelectorAll("[data-wc-final-score]").forEach((input) => {
    input.addEventListener("input", () => {
      const [name, side] = input.dataset.wcFinalScore.split(":");
      ensurePrediction(name);
      state.event.predictions[name].finalScore ||= { home: "", away: "" };
      state.event.predictions[name].finalScore[side] = input.value;
      renderScoresOnly();
    });
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
  applyResultInputPermissions();
}

function applyResultInputPermissions() {
  const canEditResults = state.event.status === "resultWait" && isCurrentUserAdmin() && !isResultFinalized(state.event);
  const selectors = [
    "[data-result-index]",
    "[data-result-key]",
    "[data-finish]",
    "[data-koshien-finish]",
    "[data-koshien-final-total-result]",
    "[data-market-result]",
    "[data-wc-top-result]",
    "[data-wc-gl-result]",
    "[data-wc-third-result]",
    "[data-wc-country-finish]",
    "[data-wc-award-result]",
    "[data-wc-final-result]",
    "[data-path='event.results.thirdQualified']",
  ];
  els.eventForm.querySelectorAll(selectors.join(",")).forEach((input) => {
    input.disabled = !canEditResults;
  });
  applyKoshienPermissions();
  applyWorldCupPhasePermissions();
}

function applyKoshienPermissions() {
  if (baseTemplateId(state.event.templateId) !== "koshien") return;
  const canPredict = (state.event.status || "open") === "open";
  els.eventForm.querySelectorAll(".koshien-participant input, .koshien-participant select").forEach((input) => {
    input.disabled = !canPredict;
  });
}

function applyWorldCupPhasePermissions() {
  if (baseTemplateId(state.event.templateId) !== "worldCup") return;
  const activePhase = state.event.config.activePhase || "phase1";
  const status = worldCupPhaseStatus(activePhase);
  const canPredict = status === "open";
  const canEditResults = status === "resultWait" && isCurrentUserAdmin();
  els.eventForm.querySelectorAll(".worldcup-participant input, .worldcup-participant select").forEach((input) => {
    input.disabled = !canPredict;
  });
  els.eventForm.querySelectorAll(".worldcup-results input, .worldcup-results select").forEach((input) => {
    input.disabled = !canEditResults;
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

function syncEditableListDependents(key) {
  if (key !== "countries" || baseTemplateId(state.event.templateId) !== "worldCup") return;
  syncWorldCupGroupsFromCountries();
}

function syncWorldCupGroupsFromCountries() {
  ensureConfig();
  const countries = getCountries();
  const groupIds = state.event.config.groups?.length
    ? state.event.config.groups.map((group) => group.id)
    : templates.worldCup.groups;
  state.event.config.groups = createWorldCupGroups(groupIds, countries);
  normalizeWorldCupEvent(state.event);
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
  if (templateId === "koshien") {
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
  const templateId = baseTemplateId(state.event.templateId);
  const koshienRows = templateId === "koshien" && isResultFinalized(state.event) ? koshienScoreRows() : [];
  return state.participants.map((name) => {
    ensurePrediction(name);
    if (baseTemplateId(state.event.templateId) !== "worldCup" && !isResultFinalized(state.event)) {
      return { name, score: 0, detail: state.event?.resultFlow?.status === "submitted" ? "結果承認待ち" : "結果未確定" };
    }
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
    if (templateId === "koshien") {
      const prediction = state.event.predictions[name];
      normalizeKoshienPrediction(state.event, name);
      const row = koshienRows.find((item) => item.name === name);
      score = row?.score || 0;
      detail = row?.detail || "8校ピック + キャプテン2倍";
      return { name, score, detail, tiebreakDelta: row?.tiebreakDelta };
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
      normalizeWorldCupPrediction(state.event, name);
      const phase1 = worldCupPhaseStatus("phase1") === "finalized" ? worldCupPhaseOneScore(name) : 0;
      const phase2 = worldCupPhaseStatus("phase2") === "finalized" ? worldCupPhaseTwoScore(name) : 0;
      const phase3 = worldCupPhaseStatus("phase3") === "finalized" ? worldCupPhaseThreeScore(name) : 0;
      score += phase1 + phase2 + phase3;
      detail = `W杯: 第1回 ${formatScore(phase1)} / 第2回 ${formatScore(phase2)} / 第3回 ${formatScore(phase3)}pt`;
    }
    if (templateId === "worldCup" && false) {
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
  }).sort((a, b) => (b.score - a.score) || ((a.tiebreakDelta ?? Infinity) - (b.tiebreakDelta ?? Infinity)));
}

function koshienScoreRows() {
  const actualFinalTotal = Number(state.event.results.finalTotalScore);
  const hasFinalTotal = state.event.results.finalTotalScore !== "" && Number.isFinite(actualFinalTotal);
  return state.participants.map((name) => {
    ensurePrediction(name);
    const prediction = state.event.predictions[name];
    const uniquePicks = [...new Set(normalizeFixedArray(prediction.teams, state.event.config.pickCount || 8).filter(Boolean))];
    let score = 0;
    uniquePicks.forEach((team) => {
      const teamScore = koshienTeamScore(state.event.results.finishes[team]);
      score += prediction.captain === team ? teamScore * 2 : teamScore;
    });
    const predictedFinalTotal = Number(prediction.finalTotalScore);
    const tiebreakDelta = hasFinalTotal && Number.isFinite(predictedFinalTotal)
      ? Math.abs(actualFinalTotal - predictedFinalTotal)
      : Infinity;
    const tiebreakText = hasFinalTotal && Number.isFinite(predictedFinalTotal) ? ` / 同点差 ${tiebreakDelta}` : "";
    return {
      name,
      score,
      tiebreakDelta,
      detail: `8校ピック + キャプテン2倍${tiebreakText}`,
    };
  });
}

function koshienTeamScore(finish) {
  const order = ["best32", "best16", "best8", "semifinal", "runnerUp", "champion"];
  const index = order.indexOf(finish);
  if (index === -1) return 0;
  return order.slice(0, index + 1).reduce((total, stage) => total + (state.event.config.stagePoints?.[stage] || templates.koshien.stagePoints[stage] || 0), 0);
}

function worldCupGroupStageScore(prediction, results, groups) {
  return groups.reduce((total, group) => {
    const pick = prediction.glPicks?.[group.id] || {};
    const actual = results.gl?.[group.id] || {};
    return total + worldCupGroupPickScore(pick.first, actual, "first") + worldCupGroupPickScore(pick.second, actual, "second");
  }, 0);
}

function worldCupGroupPickScore(pick, actual, expectedPlace) {
  if (!pick || !actual.first || !actual.second) return 0;
  if (pick === actual[expectedPlace]) return 10;
  if (pick === actual.first || pick === actual.second) return 5;
  return 0;
}

function worldCupThirdAdvancerScore(prediction, results) {
  const actual = new Set(normalizeFixedArray(results.thirdAdvancers, 8).filter(Boolean));
  const picks = [...new Set(normalizeFixedArray(prediction.thirdAdvancers, 8).filter(Boolean))];
  return picks.reduce((total, country) => total + (actual.has(country) ? 5 : 0), 0);
}

function worldCupPhaseOneScore(name) {
  const prediction = state.event.predictions[name];
  return worldCupGroupStageScore(prediction, state.event.results, getWorldCupGroups())
    + worldCupThirdAdvancerScore(prediction, state.event.results);
}

function worldCupPhaseTwoScore(name) {
  const prediction = state.event.predictions[name];
  const top4Points = [200, 100, 50, 30].reduce((total, points, index) => {
    return total + (prediction.top4[index] && prediction.top4[index] === state.event.results.top4[index] ? points : 0);
  }, 0);
  const futuresPoints = (prediction.futures || []).reduce((total, future) => {
    if (!future || !future.country || !future.finish) return total;
    const reached = finishForCountry(future.country);
    if (!reached) return total;
    if (finishRank(reached) > finishRank(future.finish)) return total;
    return total + futureBasePoints(reached) * Math.min(200, Number(future.odds) || 0);
  }, 0);
  const awardsPoints = worldCupAwardMarkets.reduce((total, award) => {
    const picked = prediction.awards?.[award.id];
    return total + (picked && picked === state.event.results.awards?.[award.id] ? award.points : 0);
  }, 0);
  return top4Points + futuresPoints + awardsPoints;
}

function worldCupPhaseThreeScore(name) {
  return worldCupSettlementRows().find((row) => row.name === name)?.phase3 || 0;
}

function worldCupSettlementRows() {
  const final = state.event.results.finalMatch || {};
  const finalScoreKnown = final.homeScore !== "" && final.awayScore !== "";
  const baseRows = state.participants.map((name) => ({
    name,
    base: worldCupPhaseOneScore(name) + worldCupPhaseTwoScore(name),
  }));
  const rows = baseRows.map((row) => ({
    ...row,
    stake: Math.round(row.base * 0.05 * 100) / 100,
    exact: finalScoreKnown && worldCupHasExactFinalScore(row.name),
    phase3: 0,
  }));
  if (!finalScoreKnown) return rows;
  const pool = rows.reduce((total, row) => total + row.stake, 0);
  const winners = rows.filter((row) => row.exact);
  rows.forEach((row) => {
    if (!winners.length) {
      row.phase3 = -row.stake;
      return;
    }
    if (row.exact) {
      row.phase3 = Math.round(((pool / winners.length) - row.stake + 50) * 100) / 100;
    } else {
      row.phase3 = -row.stake;
    }
  });
  return rows;
}

function worldCupHasExactFinalScore(name) {
  const final = state.event.results.finalMatch || {};
  if (final.homeScore === "" || final.awayScore === "") return false;
  const prediction = state.event.predictions[name]?.finalScore || {};
  return String(prediction.home) === String(final.homeScore) && String(prediction.away) === String(final.awayScore);
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
  if (baseTemplateId(state.event.templateId) === "koshien") normalizeKoshienPrediction(state.event, name);
  if (baseTemplateId(state.event.templateId) === "worldCup") normalizeWorldCupPrediction(state.event, name);
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
    best32: "32強",
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
  render();
});

els.presetDetails?.addEventListener("toggle", updatePresetSummary);

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

els.authModeButtons?.forEach((button) => {
  button.addEventListener("click", () => setAuthMode(button.dataset.authMode));
});

els.authForm?.addEventListener("submit", handleAuthSubmit);
els.authResetButton?.addEventListener("click", resetLocalAuth);
els.logoutButton?.addEventListener("click", logoutAuthUser);
els.settingsLogoutButton?.addEventListener("click", logoutAuthUser);
els.accountSaveButton?.addEventListener("click", handleAccountSave);
els.accountPasswordButton?.addEventListener("click", handlePasswordChange);
els.dataConnectionSaveButton?.addEventListener("click", handleConnectionSave);
els.dataConnectionSyncToButton?.addEventListener("click", syncStateToSheets);
els.dataConnectionSyncFromButton?.addEventListener("click", syncStateFromSheets);
els.dataConnectionCopyStateButton?.addEventListener("click", copyCurrentStateForSheets);

["click", "input", "keydown", "touchstart"].forEach((eventName) => {
  document.addEventListener(eventName, () => touchAuthSession(), { passive: true });
});
setInterval(enforceAuthTimeout, 60000);

applyTheme(localStorage.getItem(THEME_KEY) || "dark");
renderAuthState();
render();
