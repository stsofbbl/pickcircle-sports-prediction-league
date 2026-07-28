(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoJhbfResults = api;
  if (root && typeof root.addEventListener === "function") {
    const maxInstallAttempts = 200;
    const installRetryDelayMs = 50;
    const installWithRetry = (attempt = 0) => {
      if (api.installBrowser()) return;
      if (attempt < maxInstallAttempts) {
        root.setTimeout(() => installWithRetry(attempt + 1), installRetryDelayMs);
      }
    };
    if (!api.installBrowser()) {
      root.setTimeout(() => installWithRetry(), 0);
      if (root.document?.readyState !== "complete") {
        root.addEventListener("load", () => installWithRetry(), { once: true });
      }
    }
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const view = {
    eventId: "",
    baseDate: "",
    loading: false,
    applying: false,
    message: "",
    messageKind: "",
    sourceRows: [],
    rows: [],
    context: null,
    warnings: [],
    representativeRows: [],
    representativeWarnings: [],
    representativeMessage: "",
    representativeMessageKind: "",
  };
  let browserInstalled = false;
  let managerObserver = null;
  let ensurePanelQueued = false;

  const EXPECTED_SUMMER_DISTRICTS = Object.freeze([
    "北北海道", "南北海道", "青森", "岩手", "宮城", "秋田", "山形",
    "福島", "茨城", "栃木", "群馬", "埼玉", "千葉", "東東京",
    "西東京", "神奈川", "山梨", "新潟", "長野", "富山", "石川",
    "福井", "静岡", "愛知", "岐阜", "三重", "滋賀", "京都",
    "大阪", "兵庫", "奈良", "和歌山", "鳥取", "島根", "岡山",
    "広島", "山口", "香川", "徳島", "愛媛", "高知", "福岡",
    "佐賀", "長崎", "熊本", "大分", "宮崎", "鹿児島", "沖縄",
  ]);

  function normalizeSchoolName(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/[\t\r\n]/g, " ")
      .replace(/\s+/g, "")
      .trim();
  }

  function stableValue(value) {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
    }
    return value;
  }

  function stableStringify(value) {
    return JSON.stringify(stableValue(value));
  }

  function unorderedPairMatches(leftA, leftB, rightA, rightB) {
    return (leftA === rightA && leftB === rightB) || (leftA === rightB && leftB === rightA);
  }

  function buildCanonicalPayload(row, match, teamAId, teamBId) {
    const teamAIsTeam1 = teamAId === match.team1Id;
    const team1Score = teamAIsTeam1 ? Number(row.teamAScore) : Number(row.teamBScore);
    const team2Score = teamAIsTeam1 ? Number(row.teamBScore) : Number(row.teamAScore);
    const winnerTeamId = Number(team1Score) > Number(team2Score) ? match.team1Id : match.team2Id;
    const loserTeamId = winnerTeamId === match.team1Id ? match.team2Id : match.team1Id;
    return {
      source: "jhbf",
      externalKey: row.externalKey,
      matchDate: row.matchDate,
      dailyMatchNo: Number(row.dailyMatchNo),
      roundKey: row.roundKey,
      team1Id: match.team1Id,
      team2Id: match.team2Id,
      team1Score,
      team2Score,
      winnerTeamId,
      loserTeamId,
    };
  }

  function sameCompletedMatch(match, canonical) {
    if (match.status !== "completed") return false;
    return Number(match.team1Score) === Number(canonical.team1Score)
      && Number(match.team2Score) === Number(canonical.team2Score)
      && String(match.winnerTeamId || "") === String(canonical.winnerTeamId || "");
  }

  function buildImportPreview(sourceRows = [], context = {}) {
    const teams = Array.isArray(context.teams) ? context.teams : [];
    const aliases = Array.isArray(context.aliases) ? context.aliases : [];
    const imports = Array.isArray(context.imports) ? context.imports : [];
    const matches = Array.isArray(context.matches) ? context.matches : [];
    const exactByName = new Map(teams.map((team) => [normalizeSchoolName(team.name), team.teamId]));
    const aliasByName = new Map(aliases.map((alias) => [normalizeSchoolName(alias.normalizedExternalName || alias.externalName), alias.teamId]));
    const importByKey = new Map(imports.map((item) => [item.externalKey, item]));

    return sourceRows.map((row) => {
      const normalizedA = normalizeSchoolName(row.teamANameRaw);
      const normalizedB = normalizeSchoolName(row.teamBNameRaw);
      const teamAId = exactByName.get(normalizedA) || aliasByName.get(normalizedA) || "";
      const teamBId = exactByName.get(normalizedB) || aliasByName.get(normalizedB) || "";
      const unresolvedNames = [];
      if (!teamAId) unresolvedNames.push(row.teamANameRaw);
      if (!teamBId) unresolvedNames.push(row.teamBNameRaw);
      if (unresolvedNames.length) {
        return { ...row, teamAId, teamBId, unresolvedNames, status: "unresolved_team", statusMessage: "高校名の対応付けが必要です。" };
      }
      if (teamAId === teamBId) {
        return { ...row, teamAId, teamBId, unresolvedNames: [], status: "conflict", statusMessage: "両校が同じ高校へ対応付けられています。" };
      }

      const candidates = matches.filter((match) => match.roundKey === row.roundKey
        && unorderedPairMatches(teamAId, teamBId, match.team1Id, match.team2Id));
      if (!candidates.length) {
        return { ...row, teamAId, teamBId, unresolvedNames: [], status: "unmatched_match", statusMessage: "YOSO内の対戦カードが見つかりません。" };
      }
      if (candidates.length > 1) {
        return { ...row, teamAId, teamBId, unresolvedNames: [], status: "ambiguous_match", statusMessage: "YOSO内の対戦カード候補が複数あります。" };
      }

      const match = candidates[0];
      const canonicalPayload = buildCanonicalPayload(row, match, teamAId, teamBId);
      const existingImport = importByKey.get(row.externalKey);
      if (existingImport && existingImport.status !== "canceled") {
        const same = stableStringify(existingImport.normalizedPayload) === stableStringify(canonicalPayload);
        return {
          ...row, teamAId, teamBId, unresolvedNames: [], match, canonicalPayload, existingImport,
          status: same ? "imported" : "conflict",
          statusMessage: same ? "反映済みです。" : "以前の取得内容と公式結果が異なります。自動上書きしません。",
        };
      }
      if (match.status === "completed") {
        const same = sameCompletedMatch(match, canonicalPayload);
        return {
          ...row, teamAId, teamBId, unresolvedNames: [], match, canonicalPayload,
          status: same ? "already_saved" : "conflict",
          statusMessage: same ? "同じ結果が既に保存されています。" : "保存中の試合結果と公式結果が異なります。手動で確認してください。",
        };
      }
      return {
        ...row, teamAId, teamBId, unresolvedNames: [], match, canonicalPayload,
        status: "ready", statusMessage: "反映できます。",
      };
    });
  }

  function districtFromCandidateName(name) {
    const normalized = String(name || "").normalize("NFKC").replace(/\s+/g, "").trim();
    const district = normalized.endsWith("代表") ? normalized.slice(0, -2) : "";
    return EXPECTED_SUMMER_DISTRICTS.includes(district) ? district : "";
  }

  function currentRepresentativeMap(teams = [], teamMeta = {}) {
    const byDistrict = new Map();
    teams.forEach((team, index) => {
      const metaDistrict = teamMeta?.[team]?.district;
      const district = EXPECTED_SUMMER_DISTRICTS.includes(metaDistrict)
        ? metaDistrict
        : districtFromCandidateName(team) || EXPECTED_SUMMER_DISTRICTS[index] || "";
      if (district && !byDistrict.has(district)) byDistrict.set(district, team);
    });
    return byDistrict;
  }

  function buildRepresentativePreview(sourceRows = [], currentTeams = [], teamMeta = {}, warnings = []) {
    const districtCounts = new Map();
    const schoolCounts = new Map();
    const byDistrict = new Map();
    const stableKeys = new Set();
    const duplicateStableRows = [];
    sourceRows.forEach((row) => {
      const districtName = String(row.districtName || "").trim();
      const schoolName = String(row.schoolName || "").trim();
      if (!districtName) return;
      const stableKey = `${normalizeSchoolName(districtName)}:${normalizeSchoolName(schoolName)}`;
      if (stableKeys.has(stableKey)) {
        duplicateStableRows.push(`${districtName}:${schoolName}`);
        return;
      }
      stableKeys.add(stableKey);
      districtCounts.set(districtName, (districtCounts.get(districtName) || 0) + 1);
      if (schoolName) schoolCounts.set(normalizeSchoolName(schoolName), (schoolCounts.get(normalizeSchoolName(schoolName)) || 0) + 1);
      if (!byDistrict.has(districtName)) byDistrict.set(districtName, { ...row, districtName, schoolName });
    });

    const currentByDistrict = currentRepresentativeMap(currentTeams, teamMeta);
    const rows = EXPECTED_SUMMER_DISTRICTS.map((districtName) => {
      const source = byDistrict.get(districtName) || { districtName, schoolName: "" };
      const currentName = currentByDistrict.get(districtName) || "";
      return {
        ...source,
        currentName,
        changed: normalizeSchoolName(currentName) !== normalizeSchoolName(source.schoolName),
      };
    });

    const missingDistricts = EXPECTED_SUMMER_DISTRICTS.filter((district) => !byDistrict.has(district));
    const emptyDistricts = rows.filter((row) => !row.schoolName).map((row) => row.districtName);
    const duplicateDistricts = [...districtCounts].filter(([, count]) => count > 1).map(([district]) => district);
    const duplicateSchools = [...schoolCounts].filter(([, count]) => count > 1).map(([school]) => school);
    const completeCount = rows.filter((row) => row.schoolName).length;
    (Array.isArray(warnings) ? warnings : [])
      .filter((warning) => String(warning).startsWith("duplicate_representative_row:"))
      .forEach((warning) => duplicateStableRows.push(String(warning).slice("duplicate_representative_row:".length)));
    const valid = rows.length === 49
      && completeCount === 49
      && !missingDistricts.length
      && !emptyDistricts.length
      && !duplicateDistricts.length
      && !duplicateSchools.length
      && !duplicateStableRows.length;

    return {
      rows,
      valid,
      completeCount,
      missingDistricts,
      emptyDistricts,
      duplicateDistricts,
      duplicateSchools,
      duplicateStableRows: [...new Set(duplicateStableRows)],
    };
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function jstDateValue(date = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function sourceConfig() {
    const config = state.event?.config?.externalResults || {};
    const eventYear = Number((String(state.event?.name || "").match(/20\d{2}/) || [])[0]);
    return {
      competitionType: config.competitionType === "senbatsu" ? "senbatsu" : "summer",
      year: Number.isInteger(Number(config.year)) ? Number(config.year) : Number.isInteger(eventYear) ? eventYear : 2026,
    };
  }

  async function client() {
    const supabase = await window.YosoSupabase?.client?.();
    if (!supabase) throw new Error("Supabaseへ接続できません。");
    return supabase;
  }

  async function fetchResults(payload) {
    const supabase = await client();
    const { data, error } = await supabase.functions.invoke("jhbf-results", { body: payload });
    if (error) {
      let message = error.message || "公式結果を取得できませんでした。";
      try {
        const detail = await error.context?.clone?.().json?.();
        message = detail?.message || detail?.error || message;
      } catch {}
      const wrapped = new Error(message);
      wrapped.cause = error;
      throw wrapped;
    }
    return data || { rows: [], warnings: [] };
  }

  async function fetchRepresentatives(payload) {
    return fetchResults({ ...payload, kind: "representatives" });
  }

  async function loadContext(eventId) {
    const supabase = await client();
    const { data, error } = await supabase.rpc("get_koshien_external_import_context", { p_event_id: eventId });
    if (error) throw error;
    return data || {};
  }

  async function saveAlias({ eventId, externalName, teamId }) {
    const supabase = await client();
    const { data, error } = await supabase.rpc("save_koshien_external_team_alias", {
      p_event_id: eventId,
      p_source: "jhbf",
      p_external_name: externalName,
      p_normalized_external_name: normalizeSchoolName(externalName),
      p_team_id: teamId,
    });
    if (error) throw error;
    return data;
  }

  async function recordImports(eventId, rows) {
    const supabase = await client();
    const { data, error } = await supabase.rpc("record_koshien_external_imports", {
      p_event_id: eventId,
      p_rows: rows,
    });
    if (error) throw error;
    return data;
  }

  function statusClass(status) {
    return status === "ready" ? "open" : status === "conflict" ? "error" : "pending";
  }

  function statusLabel(status) {
    return {
      ready: "反映可能", imported: "反映済み", already_saved: "保存済み", conflict: "差分あり",
      unresolved_team: "高校未照合", unmatched_match: "カード未照合", ambiguous_match: "複数候補",
    }[status] || status;
  }

  function aliasControl(externalName, context) {
    const teams = Array.isArray(context?.teams) ? context.teams : [];
    return `
      <div class="inline-form" data-jhbf-alias-control>
        <span>${escapeHtml(externalName)}</span>
        <select data-jhbf-alias-team>
          <option value="">対応する高校を選択</option>
          ${teams.map((team) => `<option value="${escapeHtml(team.teamId)}">${escapeHtml(team.name)}</option>`).join("")}
        </select>
        <button class="ghost-button small-button" type="button" data-jhbf-save-alias="${escapeHtml(externalName)}">別名を保存</button>
      </div>`;
  }

  function importRowsMarkup() {
    if (!view.sourceRows.length && !view.loading && !view.message) {
      return `<p class="helper-text">試合終了後に取得すると、公式結果がここへ表示されます。</p>`;
    }
    if (!view.rows.length) return `<p class="helper-text">未反映の終了済み試合は見つかりませんでした。</p>`;
    return `<div class="history-list">${view.rows.map((row) => `
      <article class="history-row">
        <span>${escapeHtml(row.matchDate)} / ${escapeHtml(row.roundLabel)} 第${Number(row.dailyMatchNo)}試合</span>
        <strong>${escapeHtml(row.teamANameRaw)} ${Number(row.teamAScore)}－${Number(row.teamBScore)} ${escapeHtml(row.teamBNameRaw)}</strong>
        <small>${escapeHtml(row.statusMessage || "")} / 取得元: 日本高野連公式</small>
        <div class="result-flow-actions">
          ${row.status === "ready" ? `<label class="auth-check"><input type="checkbox" data-jhbf-select="${escapeHtml(row.externalKey)}"><span>反映対象にする</span></label>` : ""}
          <span class="status-label ${statusClass(row.status)}">${escapeHtml(statusLabel(row.status))}</span>
        </div>
        ${row.unresolvedNames?.map((name) => aliasControl(name, view.context)).join("") || ""}
      </article>`).join("")}</div>`;
  }

  function representativeRowsMarkup(preview) {
    if (!view.representativeRows.length && !view.representativeMessage) {
      return `<p class="helper-text">代表校を取得すると、地区ごとの公式表記と現在の候補との差分を表示します。</p>`;
    }
    const problems = [
      preview.missingDistricts.length ? `地区不足: ${preview.missingDistricts.join("、")}` : "",
      preview.emptyDistricts.length ? `未決定: ${preview.emptyDistricts.join("、")}` : "",
      preview.duplicateDistricts.length ? `地区重複: ${preview.duplicateDistricts.join("、")}` : "",
      preview.duplicateSchools.length ? `学校名重複: ${preview.duplicateSchools.join("、")}` : "",
      preview.duplicateStableRows.length ? `取得行重複: ${preview.duplicateStableRows.join("、")}` : "",
    ].filter(Boolean);
    return `
      <div class="history-list">
        <article class="history-row">
          <span>取得件数: ${preview.completeCount} / 49</span>
          <strong>${preview.valid ? "49代表校へ反映できます" : "49校が揃うまで反映できません"}</strong>
          <small>${problems.length ? escapeHtml(problems.join(" / ")) : "地区・代表校の対応を確認してください。既存候補がある場合は上書きされます。"}</small>
        </article>
        ${preview.rows.map((row) => `
          <article class="history-row">
            <span>${escapeHtml(row.districtName)}</span>
            <strong>${escapeHtml(row.schoolName || "未決定")}</strong>
            <small>現在: ${escapeHtml(row.currentName || "未登録")} / ${row.changed ? "差分あり" : "差分なし"}</small>
          </article>`).join("")}
      </div>`;
  }

  function importPanel(canEditResults) {
    if (!view.baseDate) view.baseDate = jstDateValue();
    const config = sourceConfig();
    const readyCount = view.rows.filter((row) => row.status === "ready").length;
    const disabled = !canEditResults || view.loading || view.applying ? "disabled" : "";
    const currentTeams = typeof getTeams === "function" ? getTeams() : state.event?.config?.teams || [];
    const representativePreview = buildRepresentativePreview(
      view.representativeRows,
      currentTeams,
      state.event?.config?.teamMeta || {},
      view.representativeWarnings,
    );
    const representativesDisabled = !canEditResults || view.loading || view.applying ? "disabled" : "";
    const applyRepresentativesDisabled = representativesDisabled || !representativePreview.valid ? "disabled" : "";
    return `
      <div class="entry-block koshien-jhbf-import">
        <div class="block-head">
          <div>
            <h3>日本高野連公式から結果取得</h3>
            <p class="helper-text">管理者が取得し、内容を確認して選択した試合だけ反映します。手動入力も引き続き利用できます。</p>
          </div>
          <span class="status-label pending">半自動</span>
        </div>
        <div class="form-grid">
          <label class="field"><span>大会</span><select data-jhbf-competition ${disabled}>
            <option value="summer" ${config.competitionType === "summer" ? "selected" : ""}>夏の選手権</option>
            <option value="senbatsu" ${config.competitionType === "senbatsu" ? "selected" : ""}>春の選抜</option>
          </select></label>
          <label class="field"><span>年度</span><input data-jhbf-year type="number" min="2020" max="2035" value="${config.year}" ${disabled}></label>
          <label class="field"><span>取得基準日</span><input data-jhbf-base-date type="date" value="${escapeHtml(view.baseDate)}" ${disabled}></label>
        </div>
        <div class="result-flow-actions">
          <button class="ghost-button" type="button" data-jhbf-fetch-representatives ${representativesDisabled}>代表校を取得</button>
          <button class="primary-button" type="button" data-jhbf-fetch ${disabled}>${view.loading ? "取得中…" : "最新結果を取得"}</button>
          ${readyCount ? `<button class="ghost-button" type="button" data-jhbf-apply ${disabled}>選択した結果を反映</button>` : ""}
        </div>
        <div class="entry-block">
          <div class="block-head">
            <div>
              <h3>夏の甲子園 代表校取得</h3>
              <p class="helper-text">高野連公式の代表校一覧を表示します。取得だけではDBへ保存しません。</p>
            </div>
            <span class="status-label ${representativePreview.valid ? "open" : "pending"}">${representativePreview.completeCount}/49</span>
          </div>
          ${view.representativeWarnings.length ? `<p class="helper-text">取得メモ: ${escapeHtml(view.representativeWarnings.join("、"))}</p>` : ""}
          ${view.representativeMessage ? `<p class="auth-message is-${escapeHtml(view.representativeMessageKind || "pending")}" role="status">${escapeHtml(view.representativeMessage)}</p>` : ""}
          <div class="result-flow-actions">
            <button class="primary-button" type="button" data-jhbf-apply-representatives ${applyRepresentativesDisabled}>49代表校へ反映</button>
          </div>
          ${representativeRowsMarkup(representativePreview)}
        </div>
        ${view.warnings.length ? `<p class="helper-text">取得メモ: ${escapeHtml(view.warnings.join("、"))}</p>` : ""}
        ${view.message ? `<p class="auth-message is-${escapeHtml(view.messageKind || "pending")}" role="status">${escapeHtml(view.message)}</p>` : ""}
        ${importRowsMarkup()}
      </div>`;
  }

  function resetForEvent() {
    const eventId = String(state.event?.id || "");
    if (view.eventId === eventId) return;
    view.eventId = eventId;
    view.baseDate = jstDateValue();
    view.loading = false;
    view.applying = false;
    view.message = "";
    view.messageKind = "";
    view.sourceRows = [];
    view.rows = [];
    view.context = null;
    view.warnings = [];
    view.representativeRows = [];
    view.representativeWarnings = [];
    view.representativeMessage = "";
    view.representativeMessageKind = "";
  }

  async function refreshPreview() {
    view.context = await loadContext(view.eventId);
    view.rows = buildImportPreview(view.sourceRows, view.context);
  }

  async function handleFetch(root) {
    const config = sourceConfig();
    const competitionType = root.querySelector("[data-jhbf-competition]")?.value === "senbatsu" ? "senbatsu" : "summer";
    const year = Number(root.querySelector("[data-jhbf-year]")?.value || config.year);
    const baseDate = root.querySelector("[data-jhbf-base-date]")?.value || jstDateValue();
    state.event.config.externalResults = { competitionType, year };
    saveLocalStateOnly();
    view.baseDate = baseDate;
    view.loading = true;
    view.message = "日本高野連公式から取得しています…";
    view.messageKind = "pending";
    renderActiveEventManager();
    try {
      const response = await fetchResults({ eventId: view.eventId, competitionType, year, baseDate });
      view.sourceRows = Array.isArray(response.rows) ? response.rows : [];
      view.warnings = Array.isArray(response.warnings) ? response.warnings : [];
      await refreshPreview();
      view.message = `${view.sourceRows.length}試合を取得しました。内容を確認してください。`;
      view.messageKind = "success";
    } catch (error) {
      console.warn("JHBF result fetch failed", error);
      view.sourceRows = [];
      view.rows = [];
      view.message = /cooldown|5分|five minutes/i.test(error?.message || "")
        ? "前回取得から5分以内です。時間をおいて再取得してください。"
        : (error?.message || "公式結果を取得できませんでした。既存データは変更していません。");
      view.messageKind = "error";
    } finally {
      view.loading = false;
      renderActiveEventManager();
    }
  }

  async function handleFetchRepresentatives(root) {
    const config = sourceConfig();
    const year = Number(root.querySelector("[data-jhbf-year]")?.value || config.year);
    state.event.config.externalResults = { competitionType: "summer", year };
    saveLocalStateOnly();
    view.loading = true;
    view.representativeMessage = "日本高野連公式から代表校一覧を取得しています…";
    view.representativeMessageKind = "pending";
    renderActiveEventManager();
    try {
      const response = await fetchRepresentatives({ eventId: view.eventId, competitionType: "summer", year });
      view.representativeRows = Array.isArray(response.rows) ? response.rows : [];
      view.representativeWarnings = Array.isArray(response.warnings) ? response.warnings : [];
      const preview = buildRepresentativePreview(
        view.representativeRows,
        getTeams(),
        state.event?.config?.teamMeta || {},
        view.representativeWarnings,
      );
      view.representativeMessage = `${preview.completeCount}校を取得しました。49校が揃った場合だけ反映できます。`;
      view.representativeMessageKind = preview.valid ? "success" : "pending";
    } catch (error) {
      console.warn("JHBF representative fetch failed", error);
      view.representativeRows = [];
      view.representativeWarnings = [];
      view.representativeMessage = error?.message || "代表校一覧を取得できませんでした。既存データは変更していません。";
      view.representativeMessageKind = "error";
    } finally {
      view.loading = false;
      renderActiveEventManager();
    }
  }

  function representativeTeamMeta(previewRows, currentTeams, currentMeta, year) {
    const currentByDistrict = currentRepresentativeMap(currentTeams, currentMeta);
    return Object.fromEntries(previewRows.map((row, index) => {
      const previousName = currentByDistrict.get(row.districtName) || "";
      const previous = currentMeta?.[row.schoolName] || currentMeta?.[previousName] || {};
      const odds = Number(previous.odds) > 0 ? Number(previous.odds) : 1;
      const startRound = Number(previous.startRound) === 2 || index < 15 ? 2 : 1;
      return [row.schoolName, {
        startRound,
        odds,
        sqrtOdds: Math.round(Math.sqrt(odds) * 1000) / 1000,
        district: row.districtName,
        source: "jhbf",
        sourceYear: year,
      }];
    }));
  }

  async function handleApplyRepresentatives() {
    const config = sourceConfig();
    const currentTeams = getTeams();
    const currentMeta = state.event?.config?.teamMeta || {};
    const preview = buildRepresentativePreview(
      view.representativeRows,
      currentTeams,
      currentMeta,
      view.representativeWarnings,
    );
    if (!preview.valid) {
      view.representativeMessage = "49代表校が揃っていないため反映できません。";
      view.representativeMessageKind = "error";
      renderActiveEventManager();
      return;
    }
    const confirmed = window.confirm("現在の49代表校候補を高野連公式表記で上書きします。よろしいですか？");
    if (!confirmed) return;
    const eventId = String(state.event?.id || "");
    if (!eventId || eventId !== view.eventId) {
      view.representativeMessage = "選択中の大会が変わりました。代表校を再取得してください。";
      view.representativeMessageKind = "error";
      renderActiveEventManager();
      return;
    }
    const beforeConfig = JSON.parse(JSON.stringify(state.event.config || {}));
    view.applying = true;
    view.representativeMessage = "49代表校を保存しています…";
    view.representativeMessageKind = "pending";
    renderActiveEventManager();
    try {
      const saved = await window.YosoDataService?.koshien?.replaceRepresentatives?.({
        eventId,
        year: config.year,
        rows: preview.rows,
      });
      if (Number(saved?.count) !== 49) throw new Error("Supabaseへ49代表校を保存できませんでした。");
      const nextTeams = preview.rows.map((row) => row.schoolName);
      state.event.config.teams = nextTeams;
      state.event.config.teamMeta = representativeTeamMeta(preview.rows, currentTeams, currentMeta, config.year);
      state.event.config.externalResults = { competitionType: "summer", year: config.year };
      normalizeKoshienEvent(state.event);
      saveLocalStateOnly();
      renderScoresOnly();
      view.representativeMessage = "49代表校を反映し、オンラインへ保存しました。";
      view.representativeMessageKind = "success";
    } catch (error) {
      state.event.config = beforeConfig;
      saveLocalStateOnly();
      renderScoresOnly();
      view.representativeMessage = error?.message || "49代表校を保存できませんでした。既存候補へ戻しました。";
      view.representativeMessageKind = "error";
    } finally {
      view.applying = false;
      renderActiveEventManager();
    }
  }

  async function handleAlias(button) {
    const control = button.closest("[data-jhbf-alias-control]");
    const teamId = control?.querySelector("[data-jhbf-alias-team]")?.value || "";
    const externalName = button.dataset.jhbfSaveAlias || "";
    if (!teamId || !externalName) {
      view.message = "対応する高校を選択してください。";
      view.messageKind = "error";
      renderActiveEventManager();
      return;
    }
    view.message = "別名を保存しています…";
    view.messageKind = "pending";
    renderActiveEventManager();
    try {
      await saveAlias({ eventId: view.eventId, externalName, teamId });
      await refreshPreview();
      view.message = `${externalName}の対応を保存しました。`;
      view.messageKind = "success";
    } catch (error) {
      view.message = error?.message || "別名を保存できませんでした。";
      view.messageKind = "error";
    }
    renderActiveEventManager();
  }

  function localMatchFor(row) {
    return state.event?.results?.matches?.find((match) => (
      match.round === row.match.roundKey && Number(match.match_no) === Number(row.match.matchNo)
    ));
  }

  function applyRowToLocalMatch(row, localMatch) {
    const teamById = new Map((view.context?.teams || []).map((team) => [team.teamId, team.name]));
    const team1Name = teamById.get(row.match.team1Id) || row.match.team1Name;
    const team2Name = teamById.get(row.match.team2Id) || row.match.team2Name;
    localMatch.team_a_id = team1Name;
    localMatch.team_b_id = team2Name;
    localMatch.score_a = Number(row.canonicalPayload.team1Score);
    localMatch.score_b = Number(row.canonicalPayload.team2Score);
    localMatch.winner_id = row.canonicalPayload.winnerTeamId === row.match.team1Id ? team1Name : team2Name;
    localMatch.loser_id = "";
    localMatch.status = "scheduled";
    const completed = window.YosoKoshienResults.completeMatch(localMatch);
    Object.assign(localMatch, completed.match);
  }

  async function handleApply(root) {
    const selectedKeys = new Set([...root.querySelectorAll("[data-jhbf-select]:checked")].map((input) => input.dataset.jhbfSelect));
    const selectedRows = view.rows.filter((row) => row.status === "ready" && selectedKeys.has(row.externalKey));
    if (!selectedRows.length) {
      view.message = "反映する試合を選択してください。";
      view.messageKind = "error";
      renderActiveEventManager();
      return;
    }
    const snapshots = selectedRows.map((row) => {
      const match = localMatchFor(row);
      if (!match) throw new Error(`${row.roundLabel}の対象試合をローカル画面で特定できません。`);
      return { match, before: JSON.parse(JSON.stringify(match)) };
    });
    view.applying = true;
    view.message = "選択した結果を保存しています…";
    view.messageKind = "pending";
    renderActiveEventManager();
    let onlineSaved = false;
    try {
      selectedRows.forEach((row) => applyRowToLocalMatch(row, localMatchFor(row)));
      applyKoshienMatchFinishes();
      saveLocalStateOnly();
      renderScoresOnly();
      const saveResult = await saveKoshienOnlineNow({ participantName: currentKoshienParticipantName(), updateConnection: false });
      if (saveResult?.skipped || saveResult?.partial) throw new Error("Supabaseへの結果保存が完了しませんでした。");
      onlineSaved = true;
      const savedContext = await loadContext(view.eventId);
      const savedMatches = Array.isArray(savedContext.matches) ? savedContext.matches : [];
      const auditRows = selectedRows.map((row) => {
        const savedMatch = savedMatches.find((match) => match.matchId
          && match.roundKey === row.canonicalPayload.roundKey
          && unorderedPairMatches(
            match.team1Id, match.team2Id,
            row.canonicalPayload.team1Id, row.canonicalPayload.team2Id,
          ));
        if (!savedMatch?.matchId) throw new Error("保存後の公式試合IDを確認できませんでした。");
        return {
          source: "jhbf",
          externalKey: row.externalKey,
          sourceUrl: row.sourceUrl,
          fetchedAt: row.fetchedAt,
          importedMatchId: savedMatch.matchId,
          normalizedPayload: row.canonicalPayload,
          rawPayload: row.rawPayload || {},
        };
      });
      await recordImports(view.eventId, auditRows);
      if (typeof refreshKoshienPhase2DraftState === "function") await refreshKoshienPhase2DraftState({ renderAfter: false });
      if (typeof refreshKoshienLaterPhaseState === "function") await refreshKoshienLaterPhaseState({ renderAfter: false });
      await refreshPreview();
      view.message = `${selectedRows.length}試合を反映し、ポイントとランキングを再計算しました。`;
      view.messageKind = "success";
      setKoshienMatchMessage(view.message, "success");
    } catch (error) {
      console.warn("JHBF result apply failed", error);
      if (!onlineSaved) {
        snapshots.forEach(({ match, before }) => Object.assign(match, before));
        applyKoshienMatchFinishes();
        saveLocalStateOnly();
        renderScoresOnly();
      } else {
        try { await refreshPreview(); } catch {}
      }
      view.message = onlineSaved
        ? "試合結果は保存されましたが、取得履歴の記録に失敗しました。再取得して状態を確認してください。"
        : (error?.message || "結果を反映できませんでした。既存結果へ戻しました。");
      view.messageKind = "error";
      setKoshienMatchMessage(view.message, "error");
    } finally {
      view.applying = false;
      renderActiveEventManager();
      renderScoresOnly();
    }
  }

  function bindControls() {
    const root = document.querySelector("#activeEventManager");
    if (!root) return;
    root.querySelector("[data-jhbf-fetch-representatives]")?.addEventListener("click", () => handleFetchRepresentatives(root));
    root.querySelector("[data-jhbf-apply-representatives]")?.addEventListener("click", () => handleApplyRepresentatives());
    root.querySelector("[data-jhbf-fetch]")?.addEventListener("click", () => handleFetch(root));
    root.querySelector("[data-jhbf-apply]")?.addEventListener("click", () => handleApply(root));
    root.querySelectorAll("[data-jhbf-save-alias]").forEach((button) => {
      button.addEventListener("click", () => handleAlias(button));
    });
  }

  function scrollToImportPanel() {
    setTimeout(() => {
      ensureDomPanel();
      const panel = document.querySelector(".koshien-jhbf-import");
      if (!panel) return;
      panel.open = true;
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }

  function bindOpenPanelShortcut() {
    if (document.body?.dataset.jhbfOpenPanelBound === "1") return;
    if (typeof document.addEventListener !== "function") return;
    if (document.body) document.body.dataset.jhbfOpenPanelBound = "1";
    document.addEventListener("click", (event) => {
      if (!event.target.closest("[data-jhbf-open-panel]")) return;
      scrollToImportPanel();
    });
  }

  function ensureDomPanel() {
    ensurePanelQueued = false;
    const manager = document.querySelector("#activeEventManager");
    if (!manager) return;
    const isAdmin = typeof canCurrentUserManageLeague === "function"
      ? canCurrentUserManageLeague()
      : typeof isCurrentUserAdmin === "function" && isCurrentUserAdmin();
    const isKoshien = typeof baseTemplateId === "function"
      && baseTemplateId(state.event?.templateId) === "koshien";
    const canEditResults = isAdmin
      && isKoshien
      && typeof isResultFinalized === "function"
      && !isResultFinalized(state.event);
    if (!canEditResults) {
      manager.querySelectorAll(".koshien-jhbf-import").forEach((panel) => panel.remove());
      return;
    }
    if (manager.querySelector(".koshien-jhbf-import")) return;
    manager.insertAdjacentHTML("beforeend", importPanel(canEditResults));
    bindControls();
  }

  function queueEnsureDomPanel() {
    if (ensurePanelQueued) return;
    ensurePanelQueued = true;
    setTimeout(ensureDomPanel, 0);
  }

  function observeManager() {
    if (managerObserver || typeof MutationObserver !== "function") return;
    const manager = document.querySelector("#activeEventManager");
    if (!manager) return;
    managerObserver = new MutationObserver(queueEnsureDomPanel);
    managerObserver.observe(manager, { childList: true });
    queueEnsureDomPanel();
  }

  function installBrowser() {
    if (browserInstalled) return true;
    if (typeof renderKoshienManagerPanel !== "function" || typeof bindActiveEventManagerInputs !== "function") return false;
    const originalPanel = renderKoshienManagerPanel;
    const originalBind = bindActiveEventManagerInputs;
    renderKoshienManagerPanel = function renderKoshienManagerPanelWithJhbf(options) {
      resetForEvent();
      return `${originalPanel(options)}${importPanel(options?.canEditResults === true)}`;
    };
    bindActiveEventManagerInputs = function bindActiveEventManagerInputsWithJhbf() {
      originalBind();
      bindControls();
    };
    browserInstalled = true;
    bindOpenPanelShortcut();
    renderActiveEventManager();
    observeManager();
    return true;
  }

  return Object.freeze({
    normalizeSchoolName,
    stableStringify,
    buildCanonicalPayload,
    buildImportPreview,
    buildRepresentativePreview,
    sameCompletedMatch,
    installBrowser,
  });
});
