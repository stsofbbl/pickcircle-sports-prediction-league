(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoJhbfTestEvent = api;
  if (root && typeof root.addEventListener === "function") {
    if (root.document?.readyState === "complete") root.setTimeout(() => api.installBrowser(), 0);
    else root.addEventListener("load", () => api.installBrowser(), { once: true });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const TEST_EVENT_NAME = "【TEST】高野連結果取込確認";
  const TEST_KIND = "jhbf_minimal_import";
  const TEST_SOURCE = Object.freeze({
    competitionType: "summer",
    year: 2025,
    baseDate: "2025-08-12",
    roundKey: "R2",
    dailyMatchNo: 1,
    teamA: "聖光学院",
    teamB: "山梨学院",
    scoreA: 2,
    scoreB: 6,
  });

  const panelState = {
    busy: false,
    message: "",
    messageKind: "pending",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isJhbfImportTestEvent(event) {
    return event?.name === TEST_EVENT_NAME
      && event?.config?.testHarness?.kind === TEST_KIND;
  }

  function isAdminViewer() {
    if (typeof canCurrentUserManageLeague === "function") return canCurrentUserManageLeague();
    if (typeof isCurrentUserAdmin === "function") return isCurrentUserAdmin();
    return false;
  }

  function messageMarkup() {
    if (!panelState.message) return "";
    return `<p class="auth-message is-${escapeHtml(panelState.messageKind)}" role="status">${escapeHtml(panelState.message)}</p>`;
  }

  function testControlPanel() {
    if (!isAdminViewer()) return "";
    const activeTest = isJhbfImportTestEvent(state?.event);
    const disabled = panelState.busy ? "disabled" : "";
    if (!activeTest) {
      return `
        <div class="entry-block koshien-jhbf-test-event">
          <div class="block-head">
            <div>
              <h3>過去結果取込テスト</h3>
              <p class="helper-text">2026年大会には触れず、過去の2校・1試合だけを使って取得から再読込まで確認します。</p>
            </div>
            <span class="status-label pending">管理者専用</span>
          </div>
          <div class="result-flow-actions">
            <button class="ghost-button" type="button" data-jhbf-test-create ${disabled}>${panelState.busy ? "作成中…" : "テスト大会を作成"}</button>
          </div>
          ${messageMarkup()}
        </div>`;
    }

    return `
      <div class="entry-block koshien-jhbf-test-event">
        <div class="block-head">
          <div>
            <h3>過去結果取込テスト</h3>
            <p class="helper-text">対象：2025年8月12日 2回戦第1試合　聖光学院 2－6 山梨学院</p>
          </div>
          <span class="status-label open">隔離テスト</span>
        </div>
        <p class="helper-text">上の「過去結果を取得」から公式HTMLを取得し、内容確認後に既存の「選択した結果を反映」を使用してください。</p>
        <div class="result-flow-actions">
          <button class="ghost-button" type="button" data-jhbf-test-reset ${disabled}>${panelState.busy ? "処理中…" : "テスト大会を初期化"}</button>
          <button class="danger-action" type="button" data-jhbf-test-delete ${disabled}>テスト大会を削除</button>
        </div>
        ${messageMarkup()}
      </div>`;
  }

  async function supabaseRpc(name, args) {
    const supabase = await window.YosoSupabase?.client?.();
    if (!supabase) throw new Error("Supabaseへ接続できません。");
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw error;
    return data;
  }

  function setBusyMessage(message, kind = "pending") {
    panelState.message = message;
    panelState.messageKind = kind;
    if (typeof renderActiveEventManager === "function") renderActiveEventManager();
  }

  async function reloadLatestKoshienEvent() {
    if (typeof loadKoshienOnlineState !== "function") throw new Error("オンライン大会の再読込機能を確認できません。");
    const snapshot = await loadKoshienOnlineState({ force: true });
    if (!snapshot?.ok) throw new Error("Supabaseから大会を再読込できませんでした。");
    window.location.hash = "#active";
    return snapshot;
  }

  async function createTestEvent() {
    const referenceEventId = String(state?.event?.id || "");
    if (!referenceEventId) throw new Error("作成元の大会を確認できません。");
    panelState.busy = true;
    setBusyMessage("テスト大会を作成しています…");
    try {
      await supabaseRpc("create_jhbf_import_test_event", { p_reference_event_id: referenceEventId });
      await reloadLatestKoshienEvent();
      panelState.message = "テスト大会を作成しました。過去結果を取得してください。";
      panelState.messageKind = "success";
    } finally {
      panelState.busy = false;
      if (typeof renderActiveEventManager === "function") renderActiveEventManager();
    }
  }

  async function resetTestEvent() {
    if (!isJhbfImportTestEvent(state?.event)) throw new Error("初期化対象がテスト大会ではありません。");
    const confirmed = window.confirm("テスト大会の取得結果・反映結果を消して、未実施の1試合へ戻しますか？");
    if (!confirmed) return;
    panelState.busy = true;
    setBusyMessage("テスト大会を初期化しています…");
    try {
      await supabaseRpc("reset_jhbf_import_test_event", { p_event_id: String(state.event.id) });
      await reloadLatestKoshienEvent();
      panelState.message = "テスト大会を初期状態へ戻しました。";
      panelState.messageKind = "success";
    } finally {
      panelState.busy = false;
      if (typeof renderActiveEventManager === "function") renderActiveEventManager();
    }
  }

  async function deleteTestEvent() {
    if (!isJhbfImportTestEvent(state?.event)) throw new Error("削除対象がテスト大会ではありません。");
    const eventId = String(state.event.id);
    const confirmed = window.confirm("過去結果取込用のテスト大会だけを削除しますか？2026年大会は変更されません。");
    if (!confirmed) return;
    panelState.busy = true;
    setBusyMessage("テスト大会を削除しています…");
    try {
      await supabaseRpc("delete_jhbf_import_test_event", { p_event_id: eventId });
      if (Array.isArray(state.events)) state.events = state.events.filter((event) => String(event.id) !== eventId);
      if (typeof saveLocalStateOnly === "function") saveLocalStateOnly();
      await reloadLatestKoshienEvent();
      panelState.message = "テスト大会を削除し、通常大会へ戻りました。";
      panelState.messageKind = "success";
    } finally {
      panelState.busy = false;
      if (typeof renderActiveEventManager === "function") renderActiveEventManager();
    }
  }

  function configureExistingImporter(rootElement) {
    if (!isJhbfImportTestEvent(state?.event)) return;
    rootElement.querySelectorAll("[data-manage-event-name], [data-manage-event-deadline], [data-event-status]").forEach((control) => {
      control.disabled = true;
    });
    const competition = rootElement.querySelector("[data-jhbf-competition]");
    const year = rootElement.querySelector("[data-jhbf-year]");
    const baseDate = rootElement.querySelector("[data-jhbf-base-date]");
    const fetchButton = rootElement.querySelector("[data-jhbf-fetch]");
    if (competition) competition.value = TEST_SOURCE.competitionType;
    if (year) year.value = String(TEST_SOURCE.year);
    if (baseDate) baseDate.value = TEST_SOURCE.baseDate;
    if (fetchButton && !fetchButton.disabled) fetchButton.textContent = "過去結果を取得";
  }

  function reportOperationError(error) {
    console.warn("JHBF import test event operation failed", error);
    panelState.busy = false;
    panelState.message = error?.message || "テスト大会を操作できませんでした。";
    panelState.messageKind = "error";
    if (typeof renderActiveEventManager === "function") renderActiveEventManager();
  }

  function bindControls() {
    const rootElement = document.querySelector("#activeEventManager");
    if (!rootElement || !isAdminViewer()) return;
    configureExistingImporter(rootElement);
    rootElement.querySelector("[data-jhbf-test-create]")?.addEventListener("click", () => createTestEvent().catch(reportOperationError));
    rootElement.querySelector("[data-jhbf-test-reset]")?.addEventListener("click", () => resetTestEvent().catch(reportOperationError));
    rootElement.querySelector("[data-jhbf-test-delete]")?.addEventListener("click", () => deleteTestEvent().catch(reportOperationError));
  }

  function installBrowser() {
    if (typeof window !== "undefined") window.YosoJhbfResults?.installBrowser?.();
    if (typeof renderKoshienManagerPanel !== "function" || typeof bindActiveEventManagerInputs !== "function") return false;
    const originalPanel = renderKoshienManagerPanel;
    const originalBind = bindActiveEventManagerInputs;
    renderKoshienManagerPanel = function renderKoshienManagerPanelWithJhbfTest(options) {
      const originalMarkup = originalPanel(options);
      return isAdminViewer() ? `${originalMarkup}${testControlPanel()}` : originalMarkup;
    };
    bindActiveEventManagerInputs = function bindActiveEventManagerInputsWithJhbfTest() {
      originalBind();
      bindControls();
    };
    if (typeof renderActiveEventManager === "function") renderActiveEventManager();
    return true;
  }

  return Object.freeze({
    TEST_EVENT_NAME,
    TEST_KIND,
    TEST_SOURCE,
    isJhbfImportTestEvent,
    installBrowser,
  });
});
