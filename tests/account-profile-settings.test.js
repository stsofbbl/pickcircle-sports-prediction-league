const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

function section(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, `${startMarker} section must exist`);
  return source.slice(start, end);
}

function accountSaveHarness({ online }) {
  const calls = [];
  const user = {
    id: "user-id",
    displayName: "Satoshi Wada",
    email: "satoshi@example.test",
    idleTimeoutMinutes: 0,
    rememberDefault: true,
  };
  const context = vm.createContext({
    AUTH_DEFAULT_IDLE_TIMEOUT_MINUTES: 30,
    authSession: { userId: "user-id", remember: true },
    els: {
      accountDisplayNameInput: { value: "新しい表示名" },
      accountEmailInput: { value: user.email },
      accountIdleTimeout: { value: "0" },
      accountRememberDefault: { checked: true },
      accountSaveButton: { disabled: false },
    },
    currentAuthUser: () => user,
    isSupabaseAuthEnabled: () => online,
    loadAuthUsers: () => online ? (() => { throw new Error("local users must not be read online"); })() : [user],
    saveUpdatedAuthUser: (nextUser) => calls.push(["save-local-user", nextUser]),
    renameParticipant: (...args) => calls.push(["rename-participant", ...args]),
    saveAuthSession: (...args) => calls.push(["save-local-session", ...args]),
    applyOnlineAuthUser: (nextUser) => calls.push(["apply-online-user", nextUser]),
    loadKoshienOnlineState: async (options) => calls.push(["reload-online-state", options]),
    refreshClubPathwayData: async (options) => calls.push(["reload-club-data", options]),
    renderAuthState: () => calls.push(["render-auth"]),
    render: () => calls.push(["render"]),
    setAccountMessage: (message) => calls.push(["message", message]),
    window: {
      YosoDataService: {
        auth: {
          updateProfile: async (payload) => calls.push(["update-profile", payload]),
          currentUser: async () => ({ ...user, displayName: "新しい表示名" }),
        },
      },
    },
  });
  vm.runInContext(section("async function handleAccountSave", "\nasync function handlePasswordChange"), context);
  return { calls, context };
}

test("online account save updates the formal profile and reloads identity-backed views", async () => {
  const { calls, context } = accountSaveHarness({ online: true });

  await context.handleAccountSave();

  assert.deepEqual(
    JSON.parse(JSON.stringify(calls.find((call) => call[0] === "update-profile"))),
    ["update-profile", { displayName: "新しい表示名" }],
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(calls.find((call) => call[0] === "reload-online-state"))),
    ["reload-online-state", { force: true }],
  );
  assert.ok(calls.some((call) => call[0] === "reload-club-data"));
  assert.equal(calls.some((call) => call[0] === "rename-participant"), false);
  assert.equal(calls.some((call) => call[0] === "save-local-user"), false);
  assert.ok(calls.some((call) => call[0] === "message" && /保存しました/.test(call[1])));
});

test("local account save keeps the existing participant rename path", async () => {
  const { calls, context } = accountSaveHarness({ online: false });

  await context.handleAccountSave();

  assert.ok(calls.some((call) => call[0] === "save-local-user"));
  assert.deepEqual(calls.find((call) => call[0] === "rename-participant"), ["rename-participant", "Satoshi Wada", "新しい表示名"]);
  assert.equal(calls.some((call) => call[0] === "update-profile"), false);
});

test("online auth never adds a display name to local participants", () => {
  let legacyParticipantAdds = 0;
  const context = vm.createContext({
    onlineAuthUser: { id: "user-id", displayName: "Satoshi Wada" },
    loadedKoshienOnlineEventId: "event-id",
    lastKoshienOnlineLoadUserId: "user-id",
    ensureParticipantForAuth: () => { legacyParticipantAdds += 1; },
  });
  vm.runInContext(section("function applyOnlineAuthUser", "\nasync function bootstrapSupabaseAuth"), context);

  context.applyOnlineAuthUser({ id: "user-id", displayName: "新しい表示名" });

  assert.equal(legacyParticipantAdds, 0);
});

test("legacy club name field is hidden only while an online user is authenticated", () => {
  const legacyField = { hidden: false };
  const leagueName = {
    value: "",
    disabled: false,
    closest: () => legacyField,
  };
  const noops = new Proxy({}, { get: () => () => {} });
  const context = vm.createContext({
    els: { leagueName },
    state: { leagueName: "G-UNIT 予想リーグ" },
    isSupabaseAuthEnabled: () => true,
    currentAuthUser: () => ({ id: "user-id" }),
    ...noops,
  });
  [
    "updateEventStatuses", "renderConnectionSettings", "renderClubPathways", "renderParticipants",
    "renderLeagueAdminManager", "renderTemplates", "renderPresetDescription", "updatePresetSummary",
    "renderTournamentCreateOptions", "renderEvent", "renderScores", "renderDashboard",
    "renderActiveTournaments", "renderActiveEventManager", "renderArchive", "renderTournamentManageList",
    "renderRankingEventOptions", "renderShellMeta", "renderPage", "persist",
  ].forEach((name) => { context[name] = () => {}; });
  vm.runInContext(section("function render()", "\nfunction clubRoleLabel"), context);

  context.render();
  assert.equal(legacyField.hidden, true);

  context.currentAuthUser = () => null;
  context.render();
  assert.equal(legacyField.hidden, false);
});
