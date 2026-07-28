Warning: truncated output (original token count: 77447)
Total output lines: 6723

const STORAGE_KEY = "yoso-league-state-v1";
const AUTH_USERS_KEY = "yoso-auth-users-v1";
const AUTH_SESSION_KEY = "yoso-auth-session-v1";
const AUTH_PBKDF2_ITERATIONS = 120000;
const AUTH_DEFAULT_IDLE_TIMEOUT_MINUTES = 10080;
const AUTH_ACTIVITY_THROTTLE_MS = 30000;
const AUTH_MIN_PASSWORD_LENGTH = 6;
const SHEETS_SYNC_TIMEOUT_MS = 12000;
const PUBLIC_CONFIG = window.YOSO_PUBLIC_CONFIG || {};
const DEFAULT_SAVE_MODE = PUBLIC_CONFIG.DEFAULT_SAVE_MODE || "supabase";
const DEFAULT_LEAGUE_ID = PUBLIC_CONFIG.DEFAULT_LEAGUE_ID || "g-unit-koshien-2026";

const UI_TEXT = Object.freeze({
  connection: Object.freeze({
    onlineReady: "オンライン接続可能",
    error: "接続エラー",
    syncReady: "同期準備完了",
    setup: "設定が必要",
    local: "ローカル保存",
  }),
  save: Object.freeze({
    syncing: "保存中…",
    local: "ローカル保存",
    partial: "一部保存",
    saved: "保存済み",
    confirm: "確定",
    confirmed: "確定済み",
  }),
});

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
    subtitle: "49代表から8校を選び、キャプテン校は1.2倍で加点",
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
    stagePoints: { ...window.YosoKoshienResults.OFFICIAL_PHASE1_POINTS },
    phase2Points: { best16: 0, best8: 20, best4: 40, runner_up: 60, champion: 100 },
    captainMultiplier: 1.2,
    sqrtOddsCap: 50,
    revengeMode: "full",
    zombieEnabled: true,
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
  koshien: "夏の甲子園向けの8校ピック型です。49代表から8校を選び、キャプテン校は1.2倍、正式到達ポイントと√オッズで加点します。",
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
    mode: DEFAULT_SAVE_MODE,
    scriptUrl: "",
    spreadsheetId: "",
    leagueId: DEFAULT_LEAGUE_ID,
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
  authRecoveryForm: document.querySelector("#authRecoveryForm"),
  authModeButtons: [...document.querySelectorAll("[data-auth-mode]")],
  authModeSwitch: document.querySelector("#authModeSwitch"),
  authIdentityLabel: document.querySelector("#authIdentityLabel"),
  authUsername: document.querySelector("#authUsername"),
  authDisplayName: document.querySelector("#authDisplayName"),
  authPassword: document.querySelector("#authPassword"),
  authPasswordConfirm: document.querySelector("#authPasswordConfirm"),
  authRecoveryPassword: document.querySelector("#authRecoveryPassword"),
  authRecoveryPasswordConfirm: document.querySelector("#authRecoveryPasswordConfirm"),
  authRecoverySubmitButton: document.querySelector("#authRecoverySubmitButton"),
  authRecoveryCancelButton: document.querySelector("#authRecoveryCancelButton"),
  authRemember: document.querySelector("#authRemember"),
  authSubmitButton: document.querySelector("#authSubmitButton"),
  authHelp: document.querySelector("#authHelp"),
  authResetButton: document.querySelector("#authResetButton"),
  authMessage: document.querySelector("#authMessage"),
  authNote: document.querySelector("#authNote"),
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
  accountDeletePassword: document.querySelector("#accountDeletePassword"),
  accountDeleteButton: document.querySelector("#accountDeleteButton"),
  settingsLogoutButton: document.querySelector("#settingsLogoutButton"),
  accountMessage: document.querySelector("#accountMessage"),
  dataConnectionMode: document.querySelector("#dataConnectionMode"),
  dataConnectionScriptUrlLabel: document.querySelector("#dataConnectionScriptUrlLabel"),
  dataConnectionScriptUrl: document.querySelector("#dataConnectionScriptUrl"),
  dataConnectionSpreadsheetIdLabel: document.querySelector("#dataConnectionSpreadsheetIdLabel"),
  dataConnectionSpreadsheetId: document.querySelector("#dataConnectionSpreadsheetId"),
  dataConnectionLeagueId: document.querySelector("#dataConnectionLeagueId"),
  dataConnectionLastSync: document.querySelector("#dataConnectionLastSync"),
  dataConnectionSaveButton: document.querySelector("#dataConnectionSaveButton"),
  dataConnectionTestButton: document.querySelector("#dataConnectionTestButton"),
  dataConnectionSyncToButton: document.querySelector("#dataConnectionSyncToButton"),
  dataConnectionSyncFromButton: document.querySelector("#dataConnectionSyncFromButton"),
  dataConnectionCopyStateButton: document.querySelector("#dataConnectionCopyStateButton"),
  dataConnectionStatus: document.querySelector("#dataConnectionStatus"),
  dataConnectionSummary: document.querySelector("#dataConnectionSummary"),
  dataConnectionBadge: document.querySelector("#dataConnectionBadge"),
  dataConnectionNote: document.querySelector("#dataConnectionNote"),
  dataConnectionMessage: document.querySelector("#dataConnectionMessage"),
  homeClubLine: document.querySelector("#homeClubLine"),
  homeParticipantName: document.querySelector("#homeParticipantName"),
  homeOpenCount: document.querySelector("#homeOpenCount"),
  homeMissingTournamentCount: document.querySelector("#homeMissingTournamentCount"),
  homeMonthScore: document.querySelector("#homeMonthScore"),
  homeTotalScore: document.querySelector("#homeTotalScore"),
  homeReadinessPanel: document.querySelector("#homeReadinessPanel"),
  clubPathwayHosts: [...document.querySelectorAll("[data-club-pathway-host]")],
  homeTournamentCards: document.querySelector("#homeTournamentCards"),
  activeTournamentCards: document.querySelector("#activeTournamentCards"),
  activeEventManager: document.querySelector("#activeEventManager"),
  archiveList: document.querySelector("#archiveList"),
  tournamentManageList: document.querySelector("#tournamentManageList"),
  approvalRuleText: document.querySelector("#approvalRuleText"),
  approvalPolicyGroup: document.querySelector("#approvalPolicyGroup"),
  leagueName: document.querySelector("#leagueName"),
  participantList: document.querySelector("#participantList"),
  leagueAdminManager: document.querySelector("#leagueAdminManager"),
  participantName: document.querySelector("#participantName"),
  addParticipantButton: document.querySelector("#addParticipantButton"),
  presetDetails: document.querySelector("#presetDetails"),
  presetSummary: document.querySelector("#presetSummary"),
  templateGrid: document.querySelector("#templateGrid"),
  presetDescription: document.querySelector("#presetDescription"),
  eventTitle: document.querySelector("#eventTitle"),
  eventSubtitle: document.querySelector("#eventSubtitle"),
  eventRuleGuide: document.querySelector("#eventRuleGuide"),
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

if (els.newEventButton) els.newEventButton.hidden = true;

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
let authRecoveryMode = false;
let lastAuthActivityWrite = 0;
let onlineAuthUser = null;
let onlineLeagueId = "";
let onlineLeagueMembers = [];
let onlineLeagueAdminMessage = "";
let onlineLeagueAdminSaving = false;
let clubPathwayState = {
  mode: "",
  busy: false,
  message: "",
  messageKind: "",
  searchResults: [],
  inviteMatch: null,
  myClubs: [],
  myRequests: [],
  pendingRequests: [],
};
let pendingKoshienSyncTimer = null;
let pendingKoshienLoadPromise = null;
let lastKoshienOnlineLoadUserId = "";
let koshienPhase2DraftView = { available: false, eventId: "", formalDraftExists: false, loadedFromDb: false, status: "not_ready" };
let koshienPhase2DraftLoading = false;
let koshienPhase2DraftSaving = false;
let koshienPhase2DraftMessage = "";
let koshienPhase2DraftMessageKind = "";
let koshienLaterPhaseView = { eventId: "", loadedFromDb: false, rounds: {}, teams: [] };
let koshienLaterPhaseLoading = false;
let koshienLaterPhaseSaving = false;
let koshienLaterPhaseMessage = "";
let koshienLaterPhaseMessageKind = "";

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
  if (authRecoveryMode) return null;
  if (isSupabaseAuthEnabled()) return onlineAuthUser;
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
  renderAuthFormMode();
  document.body.classList.toggle("auth-locked", !user);
  if (els.authScreen) els.authScreen.hidden = Boolean(user);
  if (els.accountChip) els.accountChip.hidden = !user;
  if (els.accountName) els.accountName.textContent = user ? `${user.displayName}${user.role === "admin" ? " / 管理者" : ""}` : "";
  if (!user) {
    if (!authRecoveryMode && !isSupabaseAuthEnabled()) setAuthMode(loadAuthUsers().length ? "login" : "register");
    return;
  }
  ensureParticipantForAuth(user);
  renderAccountSettings(user);
}

function isSupabaseAuthEnabled() {
  return Boolean(window.YosoDataService?.isAuthEnabled?.());
}

function applyOnlineAuthUser(user) {
  onlineAuthUser = user || null;
  if (onlineAuthUser) ensureParticipantForAuth(onlineAuthUser);
}

async function bootstrapSupabaseAuth() {
  if (!isSupabaseAuthEnabled()) return;
  try {
    await window.YosoDataService.auth.onAuthStateChange?.(handleSupabaseAuthEvent);
    applyOnlineAuthUser(await window.YosoDataService.auth.currentUser());
    if (onlineAuthUser) await loadKoshienOnlineState();
    if (onlineAuthUser) await refreshClubPathwayData({ renderAfter: false });
  } catch (error) {
    console.warn("Supabase auth bootstrap failed", error);
    applyOnlineAuthUser(null);
  }
  renderAuthState();
  render();
}

async function handleSupabaseAuthEvent(event) {
  if (event === "PASSWORD_RECOVERY") {
    authRecoveryMode = true;
    applyOnlineAuthUser(null);
    renderAuthState();
    setAuthMessage("新しいパスワードを入力してください。");
    return;
  }
  if (authRecoveryMode) return;
  if (event === "SIGNED_OUT") {
    applyOnlineAuthUser(null);
    onlineLeagueId = "";
    onlineLeagueMembers = [];
    onlineLeagueAdminMessage = "";
    clubPathwayState = { ...clubPathwayState, mode: "", message: "", searchResults: [], inviteMatch: null, myClubs: [], myRequests: [], pendingRequests: [] };
    lastKoshienOnlineLoadUserId = "";
    koshienPhase2DraftView = { available: false, eventId: "", formalDraftExists: false, loadedFromDb: false, status: "not_ready" };
    koshienPhase2DraftMessage = "";
    koshienLaterPhaseView = { eventId: "", loadedFromDb: false, rounds: {}, teams: [] };
    koshienLaterPhaseMessage = "";
    renderAuthState();
    render();
    return;
  }
  if (event === "SIGNED_IN" || event === "USER_UPDATED") {
    try {
      applyOnlineAuthUser(await window.YosoDataService.auth.currentUser());
      if (onlineAuthUser) await loadKoshienOnlineState();
      if (onlineAuthUser) await refreshClubPathwayData({ renderAfter: false });
      renderAuthState();
      render();
    } catch (error) {
      console.warn("Supabase auth state sync failed", error);
    }
  }
}

function setAuthMode(mode) {
  authMode = mode === "register" ? "register" : "login";
  els.authModeButtons?.forEach((button) => button.classList.toggle("is-active", button.dataset.authMode === authMode));
  if (els.authScreen) els.authScreen.dataset.mode = authMode;
  renderAuthFormMode();
  if (els.authRemember && authMode === "register") els.authRemember.checked = true;
  setAuthMessage("");
}

function renderAuthFormMode() {
  const online = isSupabaseAuthEnabled();
  const hasSupabaseConfig = Boolean(window.YosoSupabase?.hasConfig?.());
  const recovering = online && authRecoveryMode;
  if (els.authForm) els.authForm.hidden = recovering;
  if (els.authRecoveryForm) els.authRecoveryForm.hidden = !recovering;
  if (els.authModeSwitch) els.authModeSwitch.hidden = recovering;
  if (els.authHelp) els.authHelp.hidden = recovering;
  if (els.authIdentityLabel) els.authIdentityLabel.textContent = online ? "メールアドレス" : "ユーザーID";
  if (els.authUsername) {
    els.authUsername.type = online ? "email" : "text";
    els.authUsername.autocomplete = online ? "email" : "username";
    els.authUsername.placeholder = online ? "you@example.com" : "";
  }
  if (els.authDisplayName) els.authDisplayName.required = online && authMode === "register";
  if (els.authPassword) els.authPassword.autocomplete = authMode === "register" ? "new-password" : "current-password";
  if (els.authPasswordConfirm) {
    els.authPasswordConfirm.required = online && authMode === "register";
    els.authPasswordConfirm.autocomplete = "new-password";
  }
  if (els.authRecoveryPassword) els.authRecoveryPassword.required = recovering;
  if (els.authRecoveryPasswordConfirm) els.authRecoveryPasswordConfirm.required = recovering;
  if (els.authSubmitButton) els.authSubmitButton.textContent = authMode === "register" ? (online ? "確認メールを送信" : "登録して入る") : "ログイン";
  if (els.authResetButton) els.authResetButton.textContent = online ? "パスワード再設定メールを送る" : "パスワードを忘れた";
  if (els.authNote) {
    els.authNote.textContent = online
      ? "実在するメールアドレスで登録します。確認メールのリンクを開いた後にログインできます。"
      : hasSupabaseConfig
        ? "Supabase設定はありますが認証が無効です。設定画面でオンライン設定を確認してください。"
        : "オンライン未設定のため、この端末だけの簡易ログインです。複数端末で使うには設定画面でSupabaseオンラインを有効にしてください。";
    if (recovering) els.authNote.textContent = "メール内のリンク確認が完了しました。新しいパスワードを設定してください。";
  }
}

function renderAccountSettings(user = currentAuthUser()) {
  if (!user) return;
  if (els.accountUsername) els.accountUsername.value = user.username || "";
  if (els.accountRole) els.accountRole.value = clubRoleLabel(user.clubRole || (user.role === "admin" ? "co_owner" : "member"));
  if (els.accountDisplayNameInput) els.accountDisplayNameInput.value = user.displayName || "";
  if (els.accountEmailInput) els.accountEmailInput.value = user.email || "";
  if (els.accountIdleTimeout) els.accountIdleTimeout.value = String(user.idleTimeoutMinutes ?? AUTH_DEFAULT_IDLE_TIMEOUT_MINUTES);
  if (els.accountRememberDefault) els.accountRememberDefault.checked = user.rememberDefault !== false;
  if (els.authRemember) els.authRemember.checked = user.rememberDefault !== false;
}

function renderConnectionSettings() {
  state.connection = normalizeConnectionSettings(state.connection);
  const connection = state.connection;
  const isDeveloperMode = new URLSearchParams(window.location.search).get("dev") === "1";
  const isSheetsReady = connection.mode === "sheets" && connection.scriptUrl && connection.spreadsheetId && connection.leagueId;
  const isSupabaseReady = connection.mode === "supabase" && window.YosoSupabase?.hasConfig?.();
  if (els.dataConnectionMode) els.dataConnectionMode.value = connection.mode;
  if (els.dataConnectionScriptUrlLabel) els.dataConnectionScriptUrlLabel.textContent = connection.mode === "supabase" ? "SupabaseプロジェクトのURL" : "Apps ScriptのURL";
  if (els.dataConnectionSpreadsheetIdLabel) els.dataConnectionSpreadsheetIdLabel.textContent = connection.mode === "supabase" ? "匿名公開キー" : "スプレッドシートID";
  [els.dataConnectionMode, els.dataConnectionScriptUrl, els.dataConnectionSpreadsheetId, els.dataConnectionLeagueId].forEach((input) => {
    const field = input?.closest?.(".field");
    if (field) field.hidden = !isDeveloperMode;
  });
  [els.dataConnectionSaveButton, els.dataConnectionTestButton, els.dataConnectionSyncToButton, els.dataConnectionSyncFromButton, els.dataConnectionCopyStateButton].forEach((button) => {
    if (button) button.hidden = !isDeveloperMode;
  });
  if (els.dataConnectionScriptUrl) {
    els.dataConnectionScriptUrl.value = connection.mode === "supabase" ? connection.supabaseUrl : connection.scriptUrl;
    els.dataConnectionScriptUrl.placeholder = connection.mode === "supabase" ? "https://YOUR_PROJECT_REF.supabase.co" : "https://script.google.com/...";
  }
  if (els.dataConnectionSpreadsheetId) {
    els.dataConnectionSpreadsheetId.value = connection.mode === "supabase" ? connection.supabaseAnonKey : connection.spreadsheetId;
    els.dataConnectionSpreadsheetId.placeholder = connection.mode === "supabase" ? "Supabaseの匿名公開キー" : "スプレッドシートID";
  }
  if (els.dataConnectionLeagueId) els.dataConnectionLeagueId.value = connection.leagueId;
  if (els.dataConnectionLastSync) els.dataConnectionLastSync.value = connection.lastSyncAt ? formatDateTime(connection.lastSyncAt) : "未同期";
  if (els.dataConnectionStatus) {
    els.dataConnectionStatus.textContent = connection.mode === "supabase" ? "データ接続：Supabaseオンライン" : connection.mode === "sheets" ? "データ接続：Google Sheets同期" : "データ接続：この端末のみ";
  }
  if (els.dataConnectionSummary) {
    els.dataConnectionSummary.textContent = isSupabaseReady
      ? `リーグID: ${connection.leagueId || "未設定"} / URLを開いてログインすればオンライン保存できます。`
      : connection.mode === "supabase"
        ? "Supabaseに接続できません。通信環境またはログイン状態を確認してください。"
        : isSheetsReady
      ? `リーグID: ${connection.leagueId || "未設定"} / Google Sheetsへ保存・読込できます。`
      : connection.mode === "sheets"
        ? "Apps ScriptのURL、スプレッドシートID、リーグIDを入れると同期できます。"
        : "友達と共有する前に、次のステップでGoogle Sheets同期を追加します。";
  }
  if (els.dataConnectionBadge) {
    const ready = isSupabaseReady || isSheetsReady;
    els.dataConnectionBadge.textContent = isSupabaseReady
      ? UI_TEXT.connection.onlineReady
      : connection.mode === "supabase"
        ? UI_TEXT.connection.error
        : isSheetsReady
          ? UI_TEXT.connection.syncReady
          : connection.mode === "sheets"
            ? UI_TEXT.connection.setup
            : UI_TEXT.connection.local;
    els.dataConnectionBadge.className = `status-label ${ready ? "open" : "pending"}`;
  }
  if (els.dataConnectionNote) {
    els.dataConnectionNote.hidden = !isDeveloperMode;
    els.dataConnectionNote.textContent = connection.mode === "supabase"
      ? "通常はSupabaseのURLや匿名公開キーの入力は不要です。接続できない場合は通信環境またはログイン状態を確認してください。"
      : "Google Apps ScriptをWebアプリとして公開し、そのURLとスプレッドシートIDを入れると同期できます。Google側の作成と公開操作だけは、あなたのGoogleアカウントで行う必要があります。";
  }
  if (els.dataConnectionTestButton) els.dataConnectionTestButton.textContent = connection.mode === "supabase" ? "Supabase接続テスト" : "接続テスト";
  if (els.dataConnectionSyncToButton) {
    els.dataConnectionSyncToButton.textContent = connection.mode === "supabase" ? "Supabaseへ保存" : "Google Sheetsへ保存";
  }
  if (els.dataConnectionSyncFromButton) {
    els.dataConnectionSyncFromButton.textContent = connection.mode === "supabase" ? "Supabaseから読込" : "Google Sheetsから読込";
  }
  if (els.dataConnectionCopyStateButton) {
    els.dataConnectionCopyStateButton.textContent = connection.mode === "supabase" ? "設定URLをコピー" : "現在のデータをコピー";
  }
}

function setConnectionMessage(message) {
  if (els.dataConnectionMessage) els.dataConnectionMessage.textContent = message;
}

function handleConnectionModeChange() {
  state.connection = normalizeConnectionSettings({
    ...state.connection,
    mode: els.dataConnectionMode?.value,
  });
  renderConnectionSettings();
}

function handleConnectionSave() {
  const mode = els.dataConnectionMode?.value;
  const primaryValue = els.dataConnectionScriptUrl?.value.trim();
  const secondaryValue = els.dataConnectionSpreadsheetId?.value.trim();
  const leagueId = els.dataConnectionLeagueId?.value.trim() || "g-unit-koshien-2026";
  if (mode === "supabase") {
    const problem = getSupabaseConfigProblem(primaryValue, secondaryValue);
    if (problem) {
      setConnectionMessage(problem);
      return;
    }
    const savedConfig = window.YosoSupabase?.saveConfig?.({
      url: primaryValue,
      anonKey: secondaryValue,
      inviteCode: leagueId,
      leagueName: state.leagueName || "G-UNIT YOSO League",
      emailRedirectTo: window.location.href.split("#")[0].split("?")[0],
      passwordResetRedirectTo: window.location.href.split("#")[0].split("?")[0],
      auth: { enabled: true },
      sync: { autoSaveKoshien: true },
    });
    state.connection = normalizeConnectionSettings({
      ...state.connection,
      mode: "supabase",
      supabaseUrl: savedConfig?.url || primaryValue,
      supabaseAnonKey: savedConfig?.anonKey || secondaryValue,
      leagueId,
      lastSyncAt: state.connection?.lastSyncAt || "",
    });
    persist();
    renderConnectionSettings();
    renderAuthState();
    setConnectionMessage("Supabase接続設定を保存しました。オンラインログインに切り替わります。ログイン後に甲子園データを保存・読込できます。");
    return;
  }
  state.connection = normalizeConnectionSettings({
    mode,
    scriptUrl: normalizeSheetsScriptUrl(primaryValue),
    spreadsheetId: secondaryValue,
    leagueId,
    clientId: state.connection?.clientId,
    lastSyncAt: state.connection?.lastSyncAt || "",
  });
  persist();
  renderConnectionSettings();
  setConnectionMessage("接続設定を保存しました。Google側のWebアプリ公開が済んでいれば同期できます。");
  renderDashboard();
}

async function handleConnectionTest() {
  if (state.connection?.mode === "supabase" || els.dataConnectionMode?.value === "supabase") {
    await testSupabaseConnection();
    return;
  }
  await testSheetsConnection();
}

async function testSupabaseConnection() {
  if (!window.YosoSupabase?.hasConfig?.()) {
    setConnectionMessage("Supabase接続設定が未保存です。プロジェクトURLと匿名公開キーを入力して保存してください。");
    return;
  }
  setConnectionMessage("Supabase接続を確認しています...");
  try {
    const client = await window.YosoSupabase.client();
    if (!client) {
      setConnectionMessage("Supabaseクライアントを作成できませんでした。プロジェクトURLと匿名公開キーを確認してください。");
      return;
    }
    const user = await window.YosoDataService?.auth?.currentUser?.();
    setConnectionMessage(user
      ? `Supabase接続OKです。ログイン中: ${user.displayName || user.email || "ユーザー"}`
      : "Supabase接続OKです。オンライン同期にはメールアドレスでログインしてください。");
  } catch (error) {
    setConnectionMessage("Supabase接続に失敗しました。プロジェクトURLと匿名公開キーを確認してください。");
  }
}

async function testSheetsConnection() {
  const connection = ensureSheetsConnectionReady();
  if (!connection) return;
  const problem = getSheetsScriptUrlProblem(connection.scriptUrl);
  if (problem) {
    setConnectionMessage(problem);
    return;
  }
  setConnectionMessage("Google Sheets接続を確認しています...");
  try {
    const response = await requestSheetsJsonp(connection, "ping");
    if (!response?.ok) {
      if (isSheetsUnknownAction(response)) {
        setConnectionMessage("Apps Scriptには届いていますが、デプロイ中のコードが古いです。最新版を貼り直し、「デプロイを管理」から新しいバージョンで再デプロイしてください。");
        return;
      }
      setConnectionMessage(response?.error || "Apps Scriptには届きましたが、スプレッドシートを開けませんでした。");
      return;
    }
    const savedState = response.hasState ? "保存済みデータあり" : "保存済みデータなし";
    setConnectionMessage(`接続OKです。${response.spreadsheetName || "スプレッドシート"} / ${savedState}`);
  } catch (error) {
    setConnectionMessage(formatSheetsRequestError(error, "接続テスト"));
  }
}

async function handleConnectionSyncTo() {
  if (state.connection?.mode === "supabase" || els.dataConnectionMode?.value === "supabase") {
    await syncKoshienToSupabaseNow();
    return;
  }
  await syncStateToSheets();
}

async function syncKoshienToSupabaseNow() {
  if (!window.YosoDataService?.shouldAutoSaveKoshien?.() || !window.YosoDataService?.koshien?.saveSnapshot) {
    setConnectionMessage("Supabase接続が有効ではありません。接続設定を保存してからログインしてください。");
    return;
  }
  if (!currentAuthUser()) {
    setConnectionMessage("Supabaseへ保存するには、メールアドレスでログインしてください。");
    return;
  }
  if (baseTemplateId(state.event?.templateId) !== "koshien") {
    setConnectionMessage("現在選択中の大会は甲子園プリセットではありません。甲子園大会を選んでから保存してください。");
    return;
  }
  setConnectionMessage("Supabaseへ甲子園データを保存しています...");
  try {
    const result = await saveKoshienOnlineNow();
    if (result?.skipped) {
      setConnectionMessage(koshienSaveSkipMessage(result.reason));
      return;
    }
    state.connection = normalizeConnectionSettings({ ...state.connection, mode: "supabase", lastSyncAt: new Date().toISOString() });
    if (window.YosoDataService?.local?.saveState) window.YosoDataService.local.saveState(STORAGE_KEY, state);
    renderConnectionSettings();
    setConnectionMessage(koshienSaveOutcomeMessage(result, `Supabaseへ保存しました。更新: ${formatDateTime(state.connection.lastSyncAt)}`));
  } catch (error) {
    setConnectionMessage("Supabaseへの保存に失敗しました。通信環境とログイン状態を確認してください。");
  }
}

function koshienSaveSkipMessage(reason) {
  if (reason === "autoSaveKoshien is disabled") return "Supabase甲子園同期が無効です。接続設定を保存してください。";
  if (reason === "event is not koshien") return "甲子園大会を選択してから保存してください。";
  if (reason === "Supabase session is not ready") return "Supabaseログインが確認できません。メールアドレスでログインしてください。";
  if (reason === "league is not ready") return "参加リーグを確認できませんでした。リーグIDを確認してください。";
  if (reason === "admin must create the Koshien event before members can save predictions") return "まだ管理者が甲子園大会をオンライン作成していません。先に管理者で保存してください。";
  return "Supabaseへ保存できませんでした。設定とログイン状態を確認してください。";
}

function koshienSaveOutcomeMessage(result, successMessage) {
  if (result?.skipped) return koshienSaveSkipMessage(result.reason);
  if (result?.partial) return "元データは保存しましたが、構造化テーブルは未保存です。スキーマとマイグレーションの適用後に再保存してください。";
  return successMessage;
}

async function syncStateToSheets() {
  const connection = ensureSheetsConnectionReady();
  if (!connection) return;
  const problem = getSheetsScriptUrlProblem(connection.scriptUrl);
  if (problem) {
    setConnectionMessage(problem);
    return;
  }
  setConnectionMessage("Google Sheetsへ保存しています...");
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
    await delay(900);
    const verification = await requestSheetsJsonp(connection, "getState");
    if (!verification?.ok || !verification.state) {
      setConnectionMessage(verification?.error || "保存リクエスト後にGoogle Sheetsのデータを確認できませんでした。Apps Scriptの公開範囲を確認してください。");
      return;
    }
    state.connection.lastSyncAt = verification.updatedAt || now;
    persist();
    renderConnectionSettings();
    renderDashboard();
    setConnectionMessage(`Google Sheetsへ保存し、読み戻し確認まで完了しました。更新: ${formatDateTime(state.connection.lastSyncAt)}`);
  } catch (error) {
    setConnectionMessage(formatSheetsRequestError(error, "Google Sheetsへの保存"));
  }
}

async function handleConnectionSyncFrom() {
  if (state.connection?.mode === "supabase" || els.dataConnectionMode?.value === "supabase") {
    await loadKoshienOnlineState({ force: true });
    return;
  }
  await syncStateFromSheets();
}

async function syncStateFromSheets() {
  const connection = ensureSheetsConnectionReady();
  if (!connection) return;
  const problem = getSheetsScriptUrlProblem(connection.scriptUrl);
  if (problem) {
    setConnectionMessage(problem);
    return;
  }
  setConnectionMessage("Google Sheetsから読み込んでいます...");
  try {
    const response = await requestSheetsJsonp(connection, "getState");
    if (!response?.ok || !response.state) {
      setConnectionMessage(response?.error || "Google Sheetsに保存済みデータが見つかりませんでした。");
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
    setConnectionMessage(`Google Sheetsから読み込みました。更新: ${formatDateTime(response.updatedAt || state.connection.lastSyncAt)}`);
  } catch (error) {
    setConnectionMessage(formatSheetsRequestError(error, "Google Sheetsからの読込"));
  }
}

function ensureSheetsConnectionReady() {
  state.connection = normalizeConnectionSettings({
    ...state.connection,
    mode: els.dataConnectionMode?.value || state.connection?.mode,
    scriptUrl: normalizeSheetsScriptUrl(els.dataConnectionScriptUrl?.value || state.connection?.scriptUrl),
    spreadsheetId: els.dataConnectionSpreadsheetId?.value.trim() || state.connection?.spreadsheetId,
    leagueId: els.dataConnectionLeagueId?.value.trim() || state.connection?.leagueId,
  });
  if (state.connection.mode !== "sheets") {
    setConnectionMessage("保存モードを「Google Sheets準備」に切り替えてください。");
    return null;
  }
  if (!state.connection.scriptUrl || !state.connection.spreadsheetId || !state.connection.leagueId) {
    setConnectionMessage("Apps ScriptのURL、スプレッドシートID、リーグIDを入力してください。");
    return null;
  }
  persist();
  renderConnectionSettings();
  return state.connection;
}

function normalizeSheetsScriptUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^AKfycb[\w-]+$/i.test(raw)) return `https://script.google.com/macros/s/${raw}/exec`;
  const withProtocol = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const url = new URL(withProtocol);
    const deployment = url.pathname.match(/\/macros\/s\/([^/]+)(?:\/exec)?/);
    if (url.hostname === "script.google.com" && deployment) {
      return `https://script.google.com/macros/s/${deployment[1]}/exec`;
    }
  } catch {
    return withProtocol;
  }
  return withProtocol;
}

function getSheetsScriptUrlProblem(scriptUrl = "") {
  const raw = String(scriptUrl || "").trim();
  if (!raw) return "Apps ScriptのURLを入力してください。";
  let url;
  try {
    url = new URL(raw);
  } catch {
    return "Apps ScriptのURLは https://script.google.com/macros/s/.../exec の形式で入力してください。";
  }
  if (url.hostname !== "script.google.com") {
    return "Apps ScriptのURLは script.google.com のWebアプリURLを入力してください。";
  }
  if (url.pathname.includes("/home/projects/") || url.pathname.endsWith("/edit")) {
    return "Apps Scriptの編集URLではなく、デプロイ後に表示されるWebアプリURL（/macros/s/.../exec）を貼ってください。";
  }
  if (!/\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) {
    return "Apps ScriptのURLは /macros/s/.../exec で終わるWebアプリURLを貼ってください。";
  }
  return "";
}

function getSupabaseConfigProblem(projectUrl = "", anonKey = "") {
  const url = String(projectUrl || "").trim();
  const key = String(anonKey || "").trim();
  if (!url) return "SupabaseのプロジェクトURLを入力してください。";
  if (!key) return "Supabaseの匿名公開キーを入力してください。";
  try {
    const parsed = new URL(url);
    if (!/\.supabase\.co$/i.test(parsed.hostname)) {
      return "SupabaseのプロジェクトURLは https://xxxx.supabase.co の形式で入力してください。";
    }
  } catch {
    return "SupabaseのプロジェクトURLは https://xxxx.supabase.co の形式で入力してください。";
  }
  if (/service_role|secret/i.test(key) || /^sb_secret_/i.test(key) || /^sbp_/i.test(key)) {
    return "シークレットキーやservice_roleキーは入れないでください。ブラウザには匿名公開キーだけを使います。";
  }
  if (!/^eyJ/i.test(key)) {
    return "匿名公開キーの形式を確認してください。Supabaseのプロジェクト設定 > APIにある匿名公開キーを使います。";
  }
  return "";
}

function formatSheetsRequestError(error, actionLabel) {
  return `${actionLabel}に失敗しました。Apps Scriptのデプロイで「実行ユーザー: 自分」「アクセスできるユーザー: 全員」になっているか確認してください。`;
}

function isSheetsUnknownAction(response) {
  return /unknown action/i.test(String(response?.error || ""));
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
      reject(new Error("Google Sheetsへのリクエストがタイムアウトしました"));
    }, SHEETS_SYNC_TIMEOUT_MS);
    window[callbackName] = (payload) => {
      cleanup();
      resolve(payload);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("Apps Scriptにアクセスできません。URL、公開範囲、またはGoogle側の403拒否を確認してください"));
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
  const normalizedScriptUrl = normalizeSheetsScriptUrl(connection.scriptUrl);
  const problem = getSheetsScriptUrlProblem(normalizedScriptUrl);
  if (problem) throw new Error(problem);
  const url = new URL(normalizedScriptUrl);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return url.toString();
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function copyCurrentStateForSheets() {
  if (state.connection?.mode === "supabase") {
    await copySupabaseSetupUrl();
    return;
  }
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), state }, null, 2);
  try {
    await navigator.clipboard.writeText(payload);
    setConnectionMessage("現在の大会データをクリップボードにコピーしました。");
  } catch {
    setConnectionMessage("コピーできませんでした。ブラウザの権限設定を確認してください。");
  }
}

async function copySupabaseSetupUrl() {
  const current = window.YosoSupabase?.config?.() || {};
  const url = current.url || state.connection?.supabaseUrl || "";
  const anonKey = current.anonKey || state.connection?.supabaseAnonKey || "";
  if (!url || !anonKey) {
    setConnectionMessage("Supabase設定URLを作るには、プロジェクトURLと匿名公開キーを保存してください。");
    return;
  }
  const setupUrl = new URL(window.location.href.split("#")[0].split("?")[0]);
  setupUrl.searchParams.set("supabaseUrl", url);
  setupUrl.searchParams.set("supabaseAnonKey", anonKey);
  setupUrl.searchParams.set("inviteCode", state.connection?.leagueId || current.inviteCode || "g-unit-koshien-2026");
  try {
    await navigator.clipboard.writeText(setupUrl.toString());
    setConnectionMessage("Supabase設定URLをコピーしました。スマホでこのURLを一度開くとオンライン設定が入ります。");
  } catch {
    setConnectionMessage(`コピーできませんでした。次のURLをスマホで開いてください: ${setupUrl.toString()}`);
  }
}

function setAuthMessage(message) {
  if (els.authMessage) els.authMessage.textContent = message;
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  if (!isSupabaseAuthEnabled() && !crypto?.subtle) {
    setAuthMessage("このブラウザではWeb Crypto APIが使えないため登録できません。");
    return;
  }
  const username = normalizeUsername(els.authUsername?.value || "");
  const displayName = (els.authDisplayName?.value || "").trim();
  const password = els.authPassword?.value || "";
  const passwordConfirm = els.authPasswordConfirm?.value || "";
  const remember = Boolean(els.authRemember?.checked);
  if (authMode === "register") await registerAuthUser(username, displayName, password, remember, passwordConfirm);
  else await loginAuthUser(username, password, remember);
}

async function registerAuthUser(username, displayName, password, remember = true, passwordConfirm = "") {
  if (isSupabaseAuthEnabled()) {
    await registerSupabaseAuthUser(username, displayName, password, passwordConfirm);
    return;
  }
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
  if (isSupabaseAuthEnabled()) {
    await loginSupabaseAuthUser(username, password);
    return;
  }
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

async function registerSupabaseAuthUser(email, displayName, password, passwordConfirm) {
  if (!isValidEmail(email)) {
    setAuthMessage("実在するメールアドレスを入力してください。");
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
  if (password !== passwordConfirm) {
    setAuthMessage("パスワード確認が一致しません。");
    return;
  }
  try {
    setAuthMessage("確認メールを送信しています...");
    const result = await window.YosoDataService.auth.signUp({ email, password, displayName });
    applyOnlineAuthUser(null);
    if (els.authPassword) els.authPassword.value = "";
    if (els.authPasswordConfirm) els.authPasswordConfirm.value = "";
    setAuthMode("login");
    if (els.authUsername) els.authUsername.value = email;
    renderAuthState();
    setAuthMessage(result?.message || "確認メールを送信しました。メール内のリンクを開いた後、この画面からログインしてください。");
  } catch (error) {
    setAuthMessage(formatSupabaseAuthError(error, "新規登録に失敗しました。"));
  }
}

async function loginSupabaseAuthUser(email, password) {
  if (!isValidEmail(email)) {
    setAuthMessage("メールアドレスを入力してください。");
    return;
  }
  try {
    setAuthMessage("ログインしています...");
    const user = await window.YosoDataService.auth.signIn({ email, password });
    applyOnlineAuthUser(user);
    if (els.authPassword) els.authPassword.value = "";
    await loadKoshienOnlineState();
    renderAuthState();
    render();
    setAuthMessage("");
  } catch (error) {
    setAuthMessage(formatSupabaseAuthError(error, "ログインに失敗しました。"));
  }
}

async function sendSupabasePasswordReset() {
  const email = normalizeUsername(els.authUsername?.value || "");
  if (!isValidEmail(email)) {
    setAuthMessage("パスワード再設定メールを送るメールアドレスを入力してください。");
    return;
  }
  try {
    setAuthMessage("パスワード再設定メールを送信しています...");
    await window.YosoDataService.auth.sendPasswordResetEmail(email);
    setAuthMessage("パスワード再設定メールを送信しました。メール内のリンクから再設定してください。");
  } catch (error) {
    setAuthMessage(formatSupabaseAuthError(error, "パスワード再設定メールを送信できませんでした。"));
  }
}

async function handlePasswordRecoverySubmit(event) {
  event.preventDefault();
  if (!isSupabaseAuthEnabled()) {
    setAuthMessage("Supabase接続が有効ではありません。設定を確認してください。");
    return;
  }
  const newPassword = els.authRecoveryPassword?.value || "";
  const passwordConfirm = els.authRecoveryPasswordConfirm?.value || "";
  if (!newPassword || !passwordConfirm) {
    setAuthMessage("新しいパスワードと確認欄を入力してください。");
    return;
  }
  if (newPassword.length < AUTH_MIN_PASSWORD_LENGTH) {
    setAuthMessage(`新しいパスワードは${AUTH_MIN_PASSWORD_LENGTH}文字以上で入力してください。`);
    return;
  }
  if (newPassword !== passwordConfirm) {
    setAuthMessage("新しいパスワードと確認欄が一致しません。");
    return;
  }
  try {
    setAuthMessage("パスワードを更新しています...");
    await window.YosoDataService.auth.updatePassword(newPassword);
    if (els.authRecoveryPassword) els.authRecoveryPassword.value = "";
    if (els.authRecoveryPasswordConfirm) els.authRecoveryPasswordConfirm.value = "";
    await finishPasswordRecovery("パスワードを更新しました。新しいパスワードでログインしてください。");
  } catch (error) {
    setAuthMessage(formatSupabaseAuthError(error, "パスワードを更新できませんでした。再設定メールのリンクを開き直してください。"));
  }
}

async function cancelPasswordRecovery() {
  await finishPasswordRecovery("ログイン画面へ戻りました。必要ならもう一度パスワード再設定メールを送信してください。");
}

async function finishPasswordRecovery(message) {
  try {
    await window.YosoDataService.auth.signOut();
  } catch (error) {
    console.warn("Supabase recovery signout failed", error);
  }
  authRecoveryMode = false;
  applyOnlineAuthUser(null);
  setAuthMode("login");
  renderAuthState();
  setAuthMessage(message);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function formatSupabaseAuthError(error, fallback) {
  const message = String(error?.message || "");
  if (/email not confirmed|not confirmed|confirm/i.test(message)) {
    return "メール確認がまだ完了していません。確認メールのリンクを開いてからログインしてください。";
  }
  if (/invalid login credentials|invalid credentials/i.test(message)) {
    return "メールアドレスまたはパスワードが違います。";
  }
  if (/already registered|already been registered|user already/i.test(message)) {
    return "このメールアドレスは登録済みです。ログインするか、パスワード再設定を使ってください。";
  }
  if (/rate limit|too many/i.test(message)) {
    return "短時間に試行回数が多すぎます。少し待ってから再度お試しください。";
  }
  if (/session|token|expired|invalid/i.test(message)) {
    return "再設定リンクの有効期限が切れているか、セッションを確認できません。もう一度パスワード再設定メールを送信してください。";
  }
  if (/password/i.test(message)) {
    return "パスワードを更新できませんでした。文字数や入力内容を確認してください。";
  }
  return message || fallback;
}

async function handleAuthReset() {
  if (isSupabaseAuthEnabled()) {
    await sendSupabasePasswordReset();
    return;
  }
  resetLocalAuth();
}

async function logoutAuthUser() {
  if (isSupabaseAuthEnabled()) {
    try {
      await window.YosoDataService.auth.signOut();
    } catch (error) {
      console.warn("Supabase signout failed", error);
    }
    applyOnlineAuthUser(null);
  }
  saveAuthSession(null);
  lastKoshienOnlineLoadUserId = "";
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
  co…47447 tokens truncated…tate.event.predictions[name]);
      if (!validation.ok) {
        setKoshienPhase1Message(name, validation.message);
        return;
      }
      const shouldSaveOnline = name === currentKoshienParticipantName() && window.YosoDataService?.shouldAutoSaveKoshien?.();
      if (shouldSaveOnline && !currentAuthUser()) {
        setKoshienPhase1Message(name, "オンライン保存にはログインが必要です。ログインまたは新規登録してください。");
        return;
      }
      persist();
      renderScores();
      if (shouldSaveOnline) {
        renderDashboard();
        setKoshienPhase1Message(name, "Supabaseへ保存しています...");
        try {
          const result = await saveKoshienOnlineNow({ participantName: name });
          setKoshienPhase1Message(name, koshienSaveOutcomeMessage(result, "フェーズ1予想を保存しました。"));
        } catch (error) {
          setKoshienPhase1Message(name, "Supabaseに接続できません。通信環境またはログイン状態を確認してください。");
        }
        return;
      }
      renderDashboard();
      setKoshienPhase1Message(name, state.connection?.mode === "supabase"
        ? "オンライン保存にはログインが必要です。ログインまたは新規登録してください。"
        : "フェーズ1予想を保存しました。");
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
    "[data-koshien-final-score-result]",
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
  els.eventForm.querySelectorAll(".koshien-participant input, .koshien-participant select, .koshien-participant button").forEach((input) => {
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
  renderActiveEventManager();
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
      <div class="rank ${rankClass(row.rank ?? index + 1)}">${rankLabel(row.rank ?? index + 1)}</div>
      <div class="score-meta">
        <strong>${escapeHtml(row.name)}</strong>
        <span>${escapeHtml(row.detail)}</span>
        ${scoreBreakdownMarkup(row)}
      </div>
      <div class="score-value">${formatScore(row.score)}</div>
    </div>
  `).join("");
  els.insightBand.textContent = scoreboardInsight(rows);
}

function scoreBreakdownMarkup(row) {
  const breakdown = row?.breakdown;
  if (!breakdown) return "";
  const schoolLines = Array.isArray(breakdown.schoolLines) ? breakdown.schoolLines : [];
  return `
    <div class="score-breakdown">
      <div class="score-breakdown-grid">
        <span>総合 ${formatScore(row.score)}pt</span>
        <span>フェーズ1 ${formatScore(breakdown.phase1 || 0)}pt</span>
        <span>リベンジ ${formatScore(breakdown.revenge || 0)}pt</span>
        <span>フェーズ2 ${formatScore(breakdown.phase2 || 0)}pt</span>
        <span>ゾンビ影響 ${formatScore(breakdown.zombie || 0)}pt</span>
        <span>フェーズ3 ${formatScore(breakdown.phase3 || 0)}pt</span>
      </div>
      ${schoolLines.length ? `
        <details class="school-score-details">
          <summary>学校別得点内訳</summary>
          <ul>
            ${schoolLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}
          </ul>
        </details>
      ` : ""}
    </div>
  `;
}

function rankLabel(rank) {
  return String(rank || "-");
}

function rankClass(rank) {
  return ({ 1: "rank-gold", 2: "rank-silver", 3: "rank-bronze" })[rank] || "";
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
  const koshienScorable = templateId === "koshien" && koshienHasScorableResults(state.event);
  const koshienRows = koshienScorable ? koshienScoreRows() : [];
  if (koshienScorable) return window.YosoKoshienResults.rankScoreRows(koshienRows);
  const rows = state.participants.map((name) => {
    ensurePrediction(name);
    if (baseTemplateId(state.event.templateId) !== "worldCup" && !isResultFinalized(state.event) && !koshienScorable) {
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
  });
  return rows.sort((a, b) => (b.score - a.score) || ((a.tiebreakDelta ?? Infinity) - (b.tiebreakDelta ?? Infinity)));
}

function koshienHasScorableResults(event = state.event) {
  const finishes = event?.results?.finishes || {};
  const hasFinish = Object.values(finishes).some(Boolean);
  const hasCompletedMatch = (event?.results?.matches || []).some((match) => match.status === "completed");
  return hasFinish || hasCompletedMatch || isResultFinalized(event);
}

function koshienScoreRows() {
  const officialRows = koshienLaterPhaseView.eventId === String(state.event?.id || "")
    && koshienLaterPhaseView.loadedFromDb
    ? koshienLaterPhaseView.official_scores || []
    : [];
  if (officialRows.length && koshienHasScorableResults(state.event)) {
    return window.YosoKoshienResults.rankScoreRows(officialRows.map((row) => ({
      name: row.display_name || "参加者",
      playerId: row.player_id || "",
      profileId: row.profile_id || "",
      score: Number(row.total_score) || 0,
      breakdown: {
        phase1: Number(row.phase1_score) || 0,
        revenge: Number(row.revenge_score) || 0,
        phase2: Number(row.phase2_score) || 0,
        zombie: Number(row.zombie_score) || 0,
        phase3: Number(row.phase3_score) || 0,
        ...(row.breakdown || {}),
      },
      detail: `フェーズ1 ${formatScore(row.phase1_score)} / リベンジ ${formatScore(row.revenge_score)} / フェーズ2 ${formatScore(row.phase2_score)} / ゾンビ ${formatScore(row.zombie_score)} / フェーズ3 ${formatScore(row.phase3_score)}`,
    })));
  }
  const phase2Projection = koshienFormalPhase2Projection();
  const participants = phase2Projection
    ? window.YosoKoshienPhase2Draft.resolveFormalPhase2Participants({
      players: koshienPhase2DraftView.players,
      predictions: state.event.predictions,
    })
    : state.participants.map((name) => ({
      playerId: "",
      profileId: state.event.predictions[name]?.profileId || "",
      displayName: state.event.predictions[name]?.displayName || name,
      prediction: state.event.predictions[name] || createPrediction("koshien"),
    }));
  return participants.map((participant) => {
    const name = participant.displayName;
    const prediction = participant.prediction || createPrediction("koshien");
    const phase1Breakdown = koshienPhase1Breakdown(prediction);
    const phase1 = phase1Breakdown.total;
    const revenge = koshienRevengeScore(prediction);
    const phase2Base = phase2Projection
      ? Number(phase2Projection.byPlayerId[participant.playerId]) || 0
      : 0;
    const phase2Adjusted = phase2Base;
    const zombie = phase2Adjusted - phase2Base;
    const phase3 = koshienPhase3Score(name, prediction);
    const score = phase1 + revenge + phase2Base + zombie + phase3;
    return {
      name,
      playerId: participant.playerId || "",
      profileId: participant.profileId || "",
      score,
      tiebreakDelta: Infinity,
      breakdown: { phase1, revenge, phase2: phase2Base, zombie, phase3, schoolLines: phase1Breakdown.lines },
      detail: `フェーズ1 ${formatScore(phase1)} / リベンジ ${formatScore(revenge)} / フェーズ2 ${formatScore(phase2Base)} / ゾンビ ${formatScore(zombie)} / フェーズ3 ${formatScore(phase3)}`,
    };
  });
}

function koshienFormalPhase2Projection() {
  const currentEventId = String(state.event?.id || "");
  if (!koshienPhase2DraftView.available
    || !koshienPhase2DraftView.loadedFromDb
    || koshienPhase2DraftView.eventId !== currentEventId
    || koshienPhase2DraftView.formalDraftExists !== true) return null;
  const finishesByTeamId = Object.fromEntries(koshienPhase2DraftView.eligibleTeams.map((team) => [
    team.teamId,
    team.finish,
  ]));
  return window.YosoKoshienPhase2Draft.calculateFormalPhase2Scores({
    players: koshienPhase2DraftView.players,
    picks: koshienPhase2DraftView.picks,
    finishesByTeamId,
  });
}

function koshienPhase1Score(prediction) {
  return koshienPhase1Breakdown(prediction).total;
}

function koshienPhase1Breakdown(prediction) {
  const uniquePicks = [...new Set(normalizeFixedArray(prediction.teams, state.event.config.pickCount || 8).filter(Boolean))];
  const captainMultiplier = Number(state.event.config.captainMultiplier) || templates.koshien.captainMultiplier || 1.2;
  const breakdown = window.YosoKoshienResults.calculatePhase1Breakdown({
    picks: uniquePicks,
    captain: prediction.captain,
    finishes: state.event.results.finishes,
    teamMeta: state.event.config.teamMeta,
    stagePoints: state.event.config.stagePoints || templates.koshien.stagePoints,
    captainMultiplier,
    sqrtOddsCap: Number(state.event.config.sqrtOddsCap) || templates.koshien.sqrtOddsCap || 50,
  });
  return {
    total: breakdown.total,
    lines: breakdown.rows.map((row) => `${row.team}: ${koshienStageLabel(row.finish)} ${formatScore(row.stagePoint)} x sqrt_odds ${formatScore(row.sqrtOdds)} x captain ${formatScore(row.multiplier)} = ${formatScore(row.score)}pt`),
  };
}

function koshienRevengeScore(prediction) {
  if (!koshienRevengeEligible(prediction)) return 0;
  const team = prediction.revengePick;
  if (!team) return 0;
  const finish = koshienNormalizeFinish(state.event.results.finishes[team]);
  return window.YosoKoshienLaterPhases?.calculateRevengeScore({
    finishKey: finish,
    sqrtOdds: koshienSqrtOdds(team),
    sqrtOddsCap: Number(state.event.config.sqrtOddsCap) || 50,
  }) || 0;
}

function koshienPhase3Score(name, prediction) {
  const pick = prediction.finalScorePrediction || {};
  const actual = state.event.results.finalScore || {};
  if (!koshienFinalScoreReady(actual) || !koshienFinalScoreReady(pick)) return 0;
  if (koshienFinalScoreExact(pick, actual)) return 50;
  const exactExists = state.participants.some((participant) => {
    ensurePrediction(participant);
    return koshienFinalScoreExact(state.event.predictions[participant].finalScorePrediction || {}, actual);
  });
  if (exactExists) return 0;
  const closest = koshienClosestFinalScoreNames(actual);
  return closest.includes(name) ? 30 : 0;
}

function koshienSqrtOdds(team) {
  const meta = state.event.config.teamMeta?.[team];
  const odds = Number(meta?.odds) > 0 ? Number(meta.odds) : 1;
  const raw = Number(meta?.sqrtOdds) > 0 ? Number(meta.sqrtOdds) : Math.sqrt(odds);
  const cap = Number(state.event.config.sqrtOddsCap) || templates.koshien.sqrtOddsCap || 50;
  return Math.min(raw, cap);
}

function koshienTeamScore(finish) {
  const normalized = koshienNormalizeFinish(finish);
  return Number(state.event.config.stagePoints?.[normalized] ?? templates.koshien.stagePoints?.[normalized] ?? 0);
}

function koshienNormalizeFinish(finish) {
  return window.YosoKoshienResults.normalizeFinish(finish) || "initial_loss";
}

function koshienFinishRank(finish) {
  const order = ["initial_loss", "first_win_then_loss", "best16", "best8", "best4", "runner_up", "champion"];
  return order.indexOf(koshienNormalizeFinish(finish));
}

function koshienStartRound(team) {
  return Number(state.event.config.teamMeta?.[team]?.startRound) === 2 ? 2 : 1;
}

function koshienPhase1Validation(prediction) {
  const pickCount = state.event.config.pickCount || 8;
  const allPicks = normalizeFixedArray(prediction.teams, pickCount);
  const picks = allPicks.filter(Boolean);
  if (picks.length !== pickCount) return { ok: false, message: "8校すべて選択してください。" };
  const uniqueCount = new Set(picks).size;
  if (picks.length !== uniqueCount) return { ok: false, message: "同じ高校を複数回選ぶことはできません。" };
  const round2Count = picks.filter((team) => koshienStartRound(team) === 2).length;
  if (round2Count > 3) return { ok: false, message: "2回戦スタート校は最大3校までです。" };
  if (!prediction.captain) return { ok: false, message: "キャプテンを1校選んでください。" };
  if (!picks.includes(prediction.captain)) return { ok: false, message: "キャプテンは選択済み8校の中から選んでください。" };
  return { ok: true, message: "" };
}

function koshienReachedAtLeast(team, finish) {
  const actualFinish = state.event.results.finishes[team];
  return Boolean(actualFinish) && koshienFinishRank(actualFinish) >= koshienFinishRank(finish);
}

function koshienRevengeOptions(prediction, fallbackTeams = []) {
  if (!koshienRevengeEligible(prediction)) return [];
  const best16 = fallbackTeams.filter((team) => koshienReachedAtLeast(team, "best16"));
  const direct = normalizeFixedArray(prediction.teams, state.event.config.pickCount || 8)
    .map((team) => state.event.results.directEliminators?.[team])
    .filter((team) => team && best16.includes(team));
  const options = [...new Set(direct)];
  return options.length ? options : best16;
}

function koshienZombieOptions(name) {
  if (!state.event.config.zombieEnabled) return [];
  ensurePrediction(name);
  const prediction = state.event.predictions[name];
  if (!koshienZombieEligible(prediction)) return [];
  const ownedByOthers = state.participants.flatMap((participant) => {
    if (participant === name) return [];
    ensurePrediction(participant);
    return normalizeFixedArray(state.event.predictions[participant].phase2DraftPicks, state.event.config.phase2DraftCount || 4);
  });
  return [...new Set(ownedByOthers.filter((team) => team && koshienReachedAtLeast(team, "best4")))];
}

function koshienPhase2TakenByOther(team, ownerName) {
  return state.participants.some((name) => {
    if (name === ownerName) return false;
    ensurePrediction(name);
    return normalizeFixedArray(state.event.predictions[name].phase2DraftPicks, state.event.config.phase2DraftCount || 4).includes(team);
  });
}

function koshienRevengeEligible(prediction) {
  const picks = normalizeFixedArray(prediction.teams, state.event.config.pickCount || 8).filter(Boolean);
  return picks.length === (state.event.config.pickCount || 8)
    && picks.every((team) => state.event.results.finishes[team] && !koshienReachedAtLeast(team, "best16"));
}

function koshienZombieEligible(prediction) {
  const picks = normalizeFixedArray(prediction.phase2DraftPicks, state.event.config.phase2DraftCount || 4).filter(Boolean);
  return picks.length === (state.event.config.phase2DraftCount || 4)
    && picks.every((team) => state.event.results.finishes[team] && !koshienReachedAtLeast(team, "best4"));
}

function koshienFinalScoreReady(score) {
  return Boolean(score?.champion
    && score?.runnerUp
    && score.champion !== score.runnerUp
    && score.championScore !== ""
    && score.runnerUpScore !== ""
    && Number(score.championScore) !== Number(score.runnerUpScore));
}

function koshienFinalScoreExact(pick, actual) {
  return koshienFinalScoreReady(pick)
    && pick.champion === actual.champion
    && pick.runnerUp === actual.runnerUp
    && Number(pick.championScore) === Number(actual.championScore)
    && Number(pick.runnerUpScore) === Number(actual.runnerUpScore);
}

function koshienFinalScoreMetric(pick, actual) {
  const pickWinnerScore = Number(pick.championScore);
  const pickRunnerScore = Number(pick.runnerUpScore);
  const actualWinnerScore = Number(actual.championScore);
  const actualRunnerScore = Number(actual.runnerUpScore);
  return {
    totalError: Math.abs(pickWinnerScore - actualWinnerScore) + Math.abs(pickRunnerScore - actualRunnerScore),
    winnerHit: pick.champion === actual.champion ? 0 : 1,
    marginError: Math.abs((pickWinnerScore - pickRunnerScore) - (actualWinnerScore - actualRunnerScore)),
    totalPointsError: Math.abs((pickWinnerScore + pickRunnerScore) - (actualWinnerScore + actualRunnerScore)),
  };
}

function koshienClosestFinalScoreNames(actual) {
  const rows = state.participants.map((name) => {
    ensurePrediction(name);
    const pick = state.event.predictions[name].finalScorePrediction || {};
    if (!koshienFinalScoreReady(pick)) return null;
    return { name, metric: koshienFinalScoreMetric(pick, actual) };
  }).filter(Boolean);
  if (!rows.length) return [];
  rows.sort((a, b) => (
    a.metric.totalError - b.metric.totalError
    || a.metric.winnerHit - b.metric.winnerHit
    || a.metric.marginError - b.metric.marginError
    || a.metric.totalPointsError - b.metric.totalPointsError
  ));
  const best = rows[0].metric;
  return rows
    .filter((row) => row.metric.totalError === best.totalError
      && row.metric.winnerHit === best.winnerHit
      && row.metric.marginError === best.marginError
      && row.metric.totalPointsError === best.totalPointsError)
    .map((row) => row.name);
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
  if (isSupabaseAuthEnabled() && currentAuthUser()) return;
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
  if (isSupabaseAuthEnabled() && currentAuthUser() && !isClubAdmin()) return;
  const event = createTournamentFromSettings({ fallbackName: templates[state.activeTemplate]?.eventName });
  addAndSelectEvent(event);
  render();
});

els.settingsNewEventButton?.addEventListener("click", () => {
  if (isSupabaseAuthEnabled() && currentAuthUser() && !isClubAdmin()) return;
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

async function confirmSave() {
  persist();
  if (window.YosoDataService?.shouldAutoSaveKoshien?.() && baseTemplateId(state.event?.templateId) === "koshien") {
    els.saveButton.textContent = UI_TEXT.save.syncing;
    try {
      const result = await saveKoshienOnlineNow();
      els.saveButton.textContent = result?.skipped ? UI_TEXT.save.local : result?.partial ? UI_TEXT.save.partial : UI_TEXT.save.saved;
    } catch (error) {
      console.warn("Koshien Supabase save failed", error);
      els.saveButton.textContent = UI_TEXT.save.local;
    }
    setTimeout(() => {
      els.saveButton.textContent = UI_TEXT.save.confirm;
    }, 900);
    return;
  }
  els.saveButton.textContent = UI_TEXT.save.confirmed;
  setTimeout(() => {
    els.saveButton.textContent = UI_TEXT.save.confirm;
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

document.addEventListener("click", async (event) => {
  const clubButton = event.target.closest("[data-club-action]");
  if (clubButton) {
    handleClubPathwayAction(clubButton);
    return;
  }
  const deleteButton = event.target.closest("[data-event-delete]");
  if (deleteButton) {
    if (isSupabaseAuthEnabled() && currentAuthUser() && !isClubAdmin()) return;
    const eventId = deleteButton.dataset.eventId;
    const target = (state.events || []).find((candidate) => candidate.id === eventId);
    if (!target) return;
    if ((state.events || []).length <= 1) {
      alert("最後の大会は削除できません。");
      return;
    }
    if (!confirm(`「${target.name}」を削除しますか？`)) return;
    if (isSupabaseAuthEnabled() && currentAuthUser() && baseTemplateId(target.templateId) === "koshien") {
      try {
        await window.YosoDataService?.koshien?.deleteEvent?.({
          eventId,
          confirmationName: target.name,
        });
      } catch (error) {
        alert(error?.message || "オンラインの大会を削除できませんでした。");
        return;
      }
    }
    state.events = state.events.filter((candidate) => candidate.id !== eventId);
    if (state.activeEventId === eventId) setActiveEvent(state.events[0]?.id);
    render();
    return;
  }
  const statusButton = event.target.closest("[data-event-status]");
  if (statusButton) {
    if (isSupabaseAuthEnabled() && currentAuthUser() && !isClubAdmin()) return;
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
els.authRecoveryForm?.addEventListener("submit", handlePasswordRecoverySubmit);
els.authRecoveryCancelButton?.addEventListener("click", cancelPasswordRecovery);
els.authResetButton?.addEventListener("click", handleAuthReset);
els.logoutButton?.addEventListener("click", logoutAuthUser);
els.settingsLogoutButton?.addEventListener("click", logoutAuthUser);
els.accountSaveButton?.addEventListener("click", handleAccountSave);
els.accountPasswordButton?.addEventListener("click", handlePasswordChange);
els.accountDeleteButton?.addEventListener("click", handleAccountDelete);
els.dataConnectionSaveButton?.addEventListener("click", handleConnectionSave);
els.dataConnectionMode?.addEventListener("change", handleConnectionModeChange);
els.dataConnectionTestButton?.addEventListener("click", handleConnectionTest);
els.dataConnectionSyncToButton?.addEventListener("click", handleConnectionSyncTo);
els.dataConnectionSyncFromButton?.addEventListener("click", handleConnectionSyncFrom);
els.dataConnectionCopyStateButton?.addEventListener("click", copyCurrentStateForSheets);

["click", "input", "keydown", "touchstart"].forEach((eventName) => {
  document.addEventListener(eventName, () => touchAuthSession(), { passive: true });
});
setInterval(enforceAuthTimeout, 60000);

applyTheme(localStorage.getItem(THEME_KEY) || "dark");
bootstrapSupabaseAuth();
renderAuthState();
render();
