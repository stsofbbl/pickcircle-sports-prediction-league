(function (root) {
  "use strict";

  const INSTALLED_FLAG = "__yosoKoshienScheduleSyncInstalled";
  const AUTO_KEY_PREFIX = "yoso:koshien-schedule-sync:";

  function isKoshienEvent(event) {
    const template = typeof baseTemplateId === "function" ? baseTemplateId(event?.templateId) : String(event?.templateId || "");
    return template === "koshien" || event?.preset_type === "koshien";
  }

  function currentEvent() {
    return typeof state === "object" ? state?.event || null : null;
  }

  function eventYear(event) {
    const configured = Number(event?.config?.externalResults?.year);
    if (Number.isInteger(configured)) return configured;
    const named = Number((String(event?.name || "").match(/20\d{2}/) || [])[0]);
    return Number.isInteger(named) ? named : 2026;
  }

  function canManage() {
    return typeof canCurrentUserManageLeague === "function"
      ? canCurrentUserManageLeague()
      : typeof isCurrentUserAdmin === "function" && isCurrentUserAdmin();
  }

  function normalizeRows(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => ({
      round_key: String(row?.roundKey || ""),
      match_no: Number(row?.matchNo),
      starts_at: String(row?.startsAt || ""),
      tournament_day_no: Number(row?.tournamentDayNo),
      daily_match_no: Number(row?.dailyMatchNo),
    }));
  }

  function validateRows(rows) {
    const normalized = normalizeRows(rows);
    if (normalized.length !== 33) throw new Error(`公式日程は33試合必要です（取得: ${normalized.length}試合）。`);
    const keys = new Set();
    let r1 = 0;
    let r2 = 0;
    normalized.forEach((row) => {
      if (!(["R1", "R2"].includes(row.round_key)) || !row.match_no || !row.starts_at
        || !row.tournament_day_no || !row.daily_match_no || Number.isNaN(Date.parse(row.starts_at))) {
        throw new Error("公式日程に未確定または不正な試合枠があります。DBは変更しません。");
      }
      if (row.round_key === "R1") r1 += 1;
      if (row.round_key === "R2") r2 += 1;
      keys.add(`${row.round_key}:${row.match_no}`);
    });
    if (r1 !== 17 || r2 !== 16 || keys.size !== 33) {
      throw new Error("公式日程のR1/R2構造が想定と一致しません。DBは変更しません。");
    }
    return normalized;
  }

  async function syncOfficialSchedule({ event = currentEvent(), silent = false } = {}) {
    if (!event?.id || !isKoshienEvent(event)) throw new Error("甲子園大会を確認できませんでした。");
    if (!canManage()) throw new Error("公式日程の反映には管理者権限が必要です。");
    const supabase = await root.YosoSupabase?.client?.();
    if (!supabase) throw new Error("Supabaseへ接続できません。");

    const { data: fetched, error: fetchError } = await supabase.functions.invoke("jhbf-schedule", {
      body: { eventId: String(event.id), year: eventYear(event) },
    });
    if (fetchError) {
      let message = fetchError.message || "日本高野連公式の日程を取得できませんでした。";
      try {
        const detail = await fetchError.context?.clone?.().json?.();
        message = detail?.message || detail?.error || message;
      } catch {}
      throw new Error(message);
    }
    const rows = validateRows(fetched?.rows);
    const blockingWarnings = (Array.isArray(fetched?.warnings) ? fetched.warnings : [])
      .filter((warning) => /scheduled_match_count|schedule_slot_not_found|invalid_game_label|duplicate_schedule_slot/u.test(String(warning)));
    if (blockingWarnings.length) {
      throw new Error(`公式日程を安全に反映できません: ${blockingWarnings.join("、")}`);
    }

    const sourceUrl = String(fetched?.scheduleSourceUrl || fetched?.sourceUrls?.[1] || "");
    const { data: saved, error: saveError } = await supabase.rpc("sync_koshien_official_schedule", {
      p_event_id: String(event.id),
      p_rows: rows,
      p_source_url: sourceUrl,
      p_fetched_at: String(fetched?.fetchedAt || new Date().toISOString()),
    });
    if (saveError) throw new Error(saveError.message || "公式日程を保存できませんでした。");
    if (Number(saved?.count) !== 33) throw new Error("公式日程33試合の保存完了を確認できませんでした。");

    if (typeof loadKoshienOnlineState === "function") {
      const snapshot = await loadKoshienOnlineState({ force: true });
      if (!snapshot?.ok) throw new Error("日程保存後のオンラインデータを再読込できませんでした。");
    }
    if (typeof renderDashboard === "function") renderDashboard();
    if (typeof renderActiveEventManager === "function") renderActiveEventManager();
    if (typeof renderScoresOnly === "function") renderScoresOnly();
    if (!silent && typeof setKoshienMatchMessage === "function") {
      setKoshienMatchMessage(saved?.idempotent ? "公式日程は最新状態です。" : "日本高野連公式の日程を反映しました。", "success");
    }
    return saved;
  }

  function scheduleMessage(action, text, kind = "pending") {
    const host = action?.parentElement;
    if (!host) return;
    let message = host.parentElement?.querySelector("[data-jhbf-schedule-message]");
    if (!message) {
      message = document.createElement("p");
      message.dataset.jhbfScheduleMessage = "true";
      message.className = "helper-text";
      host.insertAdjacentElement("afterend", message);
    }
    message.textContent = text;
    message.className = `auth-message is-${kind}`;
  }

  function injectAdminButton() {
    document.querySelectorAll(".koshien-jhbf-import").forEach((panel) => {
      if (!canManage() || panel.querySelector("[data-jhbf-sync-schedule]")) return;
      const anchor = panel.querySelector("[data-jhbf-apply-official-second-round]")
        || panel.querySelector("[data-jhbf-apply-official-matches]");
      const actions = anchor?.parentElement;
      if (!actions) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "ghost-button";
      button.dataset.jhbfSyncSchedule = "true";
      button.textContent = "公式日程を反映";
      actions.appendChild(button);
    });
  }

  function matchStartValue(match) {
    return match?.starts_at || match?.startsAt || match?.metadata?.starts_at || match?.metadata?.scheduled_at || "";
  }

  function jstDateKey(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(date);
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  }

  function jstShortLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const day = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric" }).format(date);
    const time = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    return `${day} ${time}`;
  }

  function participantForEvent(event) {
    const authId = String(typeof currentAuthUser === "function" ? currentAuthUser()?.id || "" : "");
    const predictions = event?.predictions || {};
    if (authId) {
      const found = Object.entries(predictions).find(([, prediction]) => String(prediction?.profileId || "") === authId);
      if (found) return found[0];
    }
    return typeof currentParticipantName === "function" ? currentParticipantName() : "";
  }

  function eventById(eventId) {
    if (String(currentEvent()?.id || "") === String(eventId || "")) return currentEvent();
    return (Array.isArray(state?.events) ? state.events : []).find((event) => String(event?.id || "") === String(eventId || "")) || null;
  }

  function enhanceHomeScheduleLabels() {
    if (!root.YosoHomeDashboard || typeof state !== "object") return;
    const today = jstDateKey(Date.now());
    document.querySelectorAll("#home .home-event-dashboard.is-koshien[data-home-event-id]").forEach((card) => {
      const event = eventById(card.dataset.homeEventId);
      const participant = participantForEvent(event);
      const picks = Array.isArray(event?.predictions?.[participant]?.teams) ? event.predictions[participant].teams.filter(Boolean).slice(0, 8) : [];
      const matches = event?.results?.matches || [];
      const rows = [...card.querySelectorAll(".home-pick-row")];
      picks.forEach((team, index) => {
        const pending = root.YosoHomeDashboard.pendingMatchForTeam(matches, team);
        const startsAt = matchStartValue(pending);
        const status = rows[index]?.querySelector(".home-pick-status");
        if (!status || !startsAt) return;
        const short = jstShortLabel(startsAt);
        if (!short) return;
        status.textContent = jstDateKey(startsAt) === today ? `本日 ${short.split(" ")[1]}` : `次戦 ${short}`;
        status.classList.remove("is-alive", "is-unknown", "is-today");
        status.classList.add(jstDateKey(startsAt) === today ? "is-today" : "is-alive");
      });
    });
  }

  async function handleClick(event) {
    const button = event.target?.closest?.("[data-jhbf-sync-schedule]");
    if (!button) return;
    event.preventDefault();
    if (button.disabled) return;
    const previous = button.textContent;
    button.disabled = true;
    button.textContent = "日程反映中…";
    scheduleMessage(button, "日本高野連公式から大会日程を取得しています…", "pending");
    try {
      const saved = await syncOfficialSchedule();
      scheduleMessage(button, saved?.idempotent ? "公式日程は最新状態です。" : `公式日程33試合を反映しました（更新 ${Number(saved?.changed) || 0}試合）。`, "success");
    } catch (error) {
      console.warn("Koshien official schedule sync failed", error);
      scheduleMessage(button, error?.message || "公式日程を反映できませんでした。", "error");
    } finally {
      button.disabled = false;
      button.textContent = previous;
    }
  }

  function shouldAutoSync(event) {
    if (!canManage() || !event?.id || !isKoshienEvent(event)) return false;
    const relevant = (event?.results?.matches || []).filter((match) => ["R1", "R2"].includes(String(match?.round || match?.round_key || "")));
    if (relevant.length < 33 || !relevant.some((match) => !matchStartValue(match))) return false;
    const key = `${AUTO_KEY_PREFIX}${event.id}`;
    const last = Number(root.localStorage?.getItem(key) || 0);
    if (Date.now() - last < 30 * 60 * 1000) return false;
    root.localStorage?.setItem(key, String(Date.now()));
    return true;
  }

  async function attemptAutoSync(attempt = 0) {
    const event = currentEvent();
    if (shouldAutoSync(event)) {
      try {
        await syncOfficialSchedule({ event, silent: true });
      } catch (error) {
        console.warn("Automatic Koshien schedule sync skipped", error);
      }
      return;
    }
    if ((!event || !event?.results?.matches?.length) && attempt < 12) {
      root.setTimeout(() => attemptAutoSync(attempt + 1), 500);
    }
  }

  function installBrowser() {
    if (!root?.document || root[INSTALLED_FLAG]) return false;
    root[INSTALLED_FLAG] = true;
    root.document.addEventListener("click", handleClick);
    const observer = new MutationObserver(() => {
      injectAdminButton();
      enhanceHomeScheduleLabels();
    });
    observer.observe(root.document.body, { childList: true, subtree: true });
    injectAdminButton();
    enhanceHomeScheduleLabels();
    root.setTimeout(() => attemptAutoSync(), 1200);
    return true;
  }

  root.YosoKoshienScheduleSync = Object.freeze({ syncOfficialSchedule, enhanceHomeScheduleLabels, installBrowser });
  if (root.document?.readyState === "complete") root.setTimeout(installBrowser, 0);
  else root.addEventListener("load", installBrowser, { once: true });
})(typeof globalThis !== "undefined" ? globalThis : this);
