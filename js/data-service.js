(function () {
  "use strict";

  const phase2DraftInFlight = new Map();

  function config() {
    return window.YosoSupabase?.config?.() || {};
  }

  function isConfigured() {
    return Boolean(window.YosoSupabase?.hasConfig?.());
  }

  function isAuthEnabled() {
    const current = config();
    return isConfigured() && current.auth?.enabled !== false;
  }

  function shouldAutoSaveKoshien() {
    const current = config();
    return isConfigured() && current.sync?.autoSaveKoshien === true;
  }

  function displayNameFromUser(user, profile) {
    return profile?.display_name || user?.user_metadata?.display_name || user?.email?.split("@")[0] || "YOSO member";
  }

  function clubRoleFromMembership(membership) {
    const role = String(membership?.role || "member");
    return role === "admin" ? "co_owner" : role;
  }

  function isClubAdminRole(role) {
    return ["owner", "co_owner", "admin"].includes(String(role || ""));
  }

  function isMissingRelationError(error) {
    return ["42P01", "PGRST205"].includes(error?.code)
      || /relation .* does not exist|could not find the table .* in the schema cache/i.test(error?.message || "");
  }

  function koshienSaveError(stage, error, fallbackMessage) {
    const rawMessage = String(error?.message || "");
    const message = /exactly four submitted players are required/i.test(rawMessage)
      ? "予想を提出済みの参加者が4人必要です"
      : rawMessage || fallbackMessage || "Supabaseへの保存に失敗しました。";
    const wrapped = new Error(message, error instanceof Error ? { cause: error } : undefined);
    wrapped.name = "KoshienSaveError";
    wrapped.stage = stage;
    wrapped.code = error?.code || "";
    return wrapped;
  }

  async function phase2DraftContext() {
    const supabase = await supabaseClient();
    const user = await window.YosoSupabase?.sessionUser?.();
    if (!supabase || !user) throw new Error("フェーズ2ドラフトにはオンラインログインが必要です。");
    return { supabase, user };
  }

  async function laterPhaseContext() {
    const supabase = await supabaseClient();
    const user = await window.YosoSupabase?.sessionUser?.();
    if (!supabase || !user) throw new Error("後半フェーズにはオンラインログインが必要です。");
    return { supabase, user };
  }

  async function laterPhaseRpc(name, args, stage) {
    const { supabase } = await laterPhaseContext();
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw koshienSaveError(stage, error, "後半フェーズの保存に失敗しました。");
    return data;
  }

  function normalizedLaterPayload(payload = {}) {
    return {
      eventId: String(payload.eventId || "").trim(),
      teamId: String(payload.teamId || "").trim(),
      version: Number(payload.version),
      requestId: String(payload.requestId || "").trim(),
    };
  }

  async function loadLaterPhaseState(eventId) {
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId) throw new Error("後半フェーズのevent_idが必要です。");
    await laterPhaseRpc("refresh_koshien_phase_schedule", { p_event_id: normalizedEventId }, "later_phase_schedule");
    return laterPhaseRpc("get_koshien_later_phase_state", { p_event_id: normalizedEventId }, "later_phase_load");
  }

  async function saveRevengePick(payload = {}) {
    const value = normalizedLaterPayload(payload);
    if (!value.eventId || !value.teamId || !Number.isInteger(value.version) || !value.requestId) throw new Error("リベンジ保存payloadを確認してください。");
    return laterPhaseRpc("save_koshien_revenge_pick", {
      p_event_id: value.eventId,
      p_target_team_id: value.teamId,
      p_expected_version: value.version,
      p_request_id: value.requestId,
    }, "revenge_pick");
  }

  async function saveZombiePrediction(payload = {}) {
    const value = normalizedLaterPayload(payload);
    if (!value.eventId || !value.teamId || !Number.isInteger(value.version) || !value.requestId) throw new Error("ゾンビ保存payloadを確認してください。");
    return laterPhaseRpc("save_koshien_zombie_prediction", {
      p_event_id: value.eventId,
      p_target_team_id: value.teamId,
      p_expected_version: value.version,
      p_request_id: value.requestId,
    }, "zombie_prediction");
  }

  async function savePhase3Prediction(payload = {}) {
    const eventId = String(payload.eventId || "").trim();
    const requestId = String(payload.requestId || "").trim();
    const scoreA = Number(payload.scoreA);
    const scoreB = Number(payload.scoreB);
    const version = Number(payload.version);
    if (!eventId || !requestId || !Number.isInteger(version) || !Number.isInteger(scoreA) || scoreA < 0
      || !Number.isInteger(scoreB) || scoreB < 0 || scoreA === scoreB) throw new Error("フェーズ3保存payloadを確認してください。");
    return laterPhaseRpc("save_koshien_phase3_prediction", {
      p_event_id: eventId,
      p_score_a: scoreA,
      p_score_b: scoreB,
      p_expected_version: version,
      p_request_id: requestId,
    }, "phase3_prediction");
  }

  async function prepareLaterPhase({ eventId, phase, opensAt, deadlineAt } = {}) {
    const rpcNames = {
      best16: "prepare_koshien_best16_phases",
      zombie: "prepare_koshien_zombie_phase",
      phase3: "prepare_koshien_phase3",
    };
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId || !rpcNames[phase] || !opensAt || !deadlineAt) throw new Error("後半フェーズ準備payloadを確認してください。");
    return laterPhaseRpc(rpcNames[phase], {
      p_event_id: normalizedEventId,
      p_opens_at: opensAt,
      p_deadline_at: deadlineAt,
    }, `${phase}_prepare`);
  }

  async function setLaterPhaseStatus({ eventId, phase, action } = {}) {
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId || !["best16", "zombie", "phase3"].includes(phase)
      || !["open", "lock"].includes(action)) throw new Error("後半フェーズ操作payloadを確認してください。");
    return laterPhaseRpc("set_koshien_later_phase_status", {
      p_event_id: normalizedEventId,
      p_phase_key: phase,
      p_action: action,
    }, `${phase}_${action}`);
  }

  async function manageLeagueAdmin({ leagueId, userId, makeAdmin } = {}) {
    const normalizedLeagueId = String(leagueId || "").trim();
    const normalizedUserId = String(userId || "").trim();
    if (!normalizedLeagueId || !normalizedUserId || typeof makeAdmin !== "boolean") {
      throw new Error("管理者変更payloadを確認してください。");
    }
    const { supabase } = await laterPhaseContext();
    const { data, error } = await supabase.rpc("manage_league_admin", {
      p_league_id: normalizedLeagueId,
      p_user_id: normalizedUserId,
      p_make_admin: makeAdmin,
    });
    if (error) throw koshienSaveError("league_admin", error, "管理者権限を変更できませんでした。");
    return data;
  }

  async function loadPhase2DraftState(eventId) {
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId) throw new Error("フェーズ2ドラフトのevent_idが必要です。");
    const { supabase } = await phase2DraftContext();
    const { data, error } = await supabase.rpc("get_koshien_phase2_draft_state", {
      p_event_id: normalizedEventId,
    });
    if (error) throw koshienSaveError("phase2_load", error, "フェーズ2ドラフト状態を取得できませんでした。");
    return data;
  }

  function phase2ConflictError(error) {
    return ["23505", "40001", "55000"].includes(error?.code)
      || /already|conflict|deadline|turn changed|not active/i.test(error?.message || "");
  }

  function savePhase2DraftPick({ eventId, draftId, teamId, pickNo, requestId } = {}) {
    const payload = {
      eventId: String(eventId || "").trim(),
      draftId: String(draftId || "").trim(),
      teamId: String(teamId || "").trim(),
      pickNo: Number(pickNo),
      requestId: String(requestId || "").trim(),
    };
    if (!payload.eventId || !payload.draftId || !payload.teamId || !payload.requestId
      || !Number.isInteger(payload.pickNo) || payload.pickNo < 1 || payload.pickNo > 16) {
      return Promise.reject(new Error("フェーズ2指名payloadを確認してください。"));
    }

    const inFlightKey = `${payload.draftId}:${payload.pickNo}`;
    const signature = `${payload.teamId}:${payload.requestId}`;
    const existing = phase2DraftInFlight.get(inFlightKey);
    if (existing) {
      if (existing.signature === signature) return existing.promise;
      const error = new Error("同じ手番の指名を保存中です。");
      error.code = "phase2_save_in_progress";
      return Promise.reject(error);
    }

    const promise = (async () => {
      const { supabase } = await phase2DraftContext();
      const { data, error } = await supabase.rpc("save_koshien_phase2_draft_pick", {
        p_draft_id: payload.draftId,
        p_team_id: payload.teamId,
        p_expected_pick_no: payload.pickNo,
        p_request_id: payload.requestId,
      });
      if (!error) return data;

      const wrapped = koshienSaveError("phase2_pick", error, "フェーズ2指名を保存できませんでした。");
      if (phase2ConflictError(error)) {
        wrapped.retryable = true;
        try {
          wrapped.latestState = await loadPhase2DraftState(payload.eventId);
        } catch (reloadError) {
          wrapped.reloadError = reloadError;
        }
      }
      throw wrapped;
    })();
    phase2DraftInFlight.set(inFlightKey, { signature, promise });
    promise.finally(() => {
      if (phase2DraftInFlight.get(inFlightKey)?.promise === promise) phase2DraftInFlight.delete(inFlightKey);
    }).catch(() => {});
    return promise;
  }

  function koshienTeamMeta(event, name, index) {
    const meta = event?.config?.teamMeta?.[name] || {};
    const odds = Number(meta.odds) > 0 ? Number(meta.odds) : 1;
    const startRound = Number(meta.startRound) === 2 || index < 15 ? 2 : 1;
    return {
      startRound,
      odds,
      sqrtOdds: Math.round(Math.sqrt(odds) * 10000) / 10000,
      district: meta.district || "",
      source: meta.source || "",
      sourceYear: Number.isInteger(Number(meta.sourceYear)) ? Number(meta.sourceYear) : null,
    };
  }

  function koshienRepresentativeMetadata(name, meta, fallbackSource) {
    const district = String(meta?.district || "").trim();
    const stablePart = (value) => String(value || "")
      .trim()
      .toLocaleLowerCase("ja-JP")
      .replace(/[\s　]+/gu, "");
    const districtKey = stablePart(district);
    const schoolKey = stablePart(name);
    return {
      source: meta?.source || fallbackSource,
      district: district || null,
      source_year: meta?.sourceYear || null,
      ...(districtKey && schoolKey
        ? {
          district_key: districtKey,
          representative_key: `${districtKey}:${schoolKey}`,
        }
        : {}),
    };
  }

  function fixedArray(value, count) {
    const rows = Array.isArray(value) ? value.slice(0, count) : [];
    while (rows.length < count) rows.push("");
    return rows;
  }

  function buildKoshienMatchRows({ eventId, event, teamByName }) {
    const matches = Array.isArray(event.results?.matches) ? event.results.matches : [];
    if (!matches.length) return [];
    return window.YosoKoshienResults.buildMatchRows({
      eventId,
      matches,
      teams: [...teamByName.values()],
    });
  }

  async function buildKoshienScoreRows({ supabase, eventId, leagueId, scoreRows }) {
    if (!Array.isArray(scoreRows) || !scoreRows.length) return [];
    const { data: players, error: playersError } = await supabase
      .from("players")
      .select("id, profile_id, display_name")
      .eq("league_id", leagueId);
    if (playersError) throw playersError;
    return window.YosoKoshienResults.buildScoreRows({ eventId, players: players || [], scoreRows });
  }

  async function cancelKoshienMatchResult({
    eventId,
    roundKey,
    matchNo,
    resultsPayload,
    scoreRows = [],
  } = {}) {
    const normalizedEventId = String(eventId || "").trim();
    const normalizedRoundKey = String(roundKey || "").trim();
    const normalizedMatchNo = Number(matchNo);
    if (!normalizedEventId || !normalizedRoundKey || !Number.isInteger(normalizedMatchNo) || normalizedMatchNo < 1
      || !resultsPayload || typeof resultsPayload !== "object" || !Array.isArray(scoreRows)) {
      throw new Error("試合結果取消payloadを確認してください。");
    }
    const { supabase } = await laterPhaseContext();
    const league = await ensureLeagueMembership();
    if (!league?.id) throw new Error("参加リーグを確認できませんでした。");
    const persistedScoreRows = await buildKoshienScoreRows({
      supabase,
      eventId: normalizedEventId,
      leagueId: league.id,
      scoreRows,
    });
    const { data, error } = await supabase.rpc("cancel_koshien_match_result", {
      p_event_id: normalizedEventId,
      p_round_key: normalizedRoundKey,
      p_match_no: normalizedMatchNo,
      p_results_payload: resultsPayload,
      p_score_rows: persistedScoreRows,
    });
    if (error) throw koshienSaveError("result_cancel", error, "試合結果を取り消せませんでした。");
    return data;
  }

  async function reopenKoshienResults(eventId) {
    const normalizedEventId = String(eventId || "").trim();
    if (!normalizedEventId) throw new Error("結果確定取消のevent_idが必要です。");
    return laterPhaseRpc("reopen_koshien_results", {
      p_event_id: normalizedEventId,
    }, "result_reopen");
  }

  async function saveKoshienResultTransaction({ supabase, league, event, teamRows, scoreRows }) {
    const eventId = String(event.id);
    const teamByName = new Map(teamRows.map((team) => [team.name, team]));
    let matchRows;
    let persistedScoreRows;
    try {
      matchRows = buildKoshienMatchRows({ eventId, event, teamByName });
    } catch (error) {
      throw koshienSaveError("matches", error, "matches保存用データの作成に失敗しました。");
    }
    try {
      persistedScoreRows = await buildKoshienScoreRows({ supabase, eventId, leagueId: league.id, scoreRows });
    } catch (error) {
      throw koshienSaveError("scores", error, "scores保存用データの作成に失敗しました。");
    }
    if (!matchRows.length) {
      throw koshienSaveError("matches", null, "確定済み試合のmatches保存用データが空です。");
    }
    if (!persistedScoreRows.length) {
      throw koshienSaveError("scores", null, "scores保存用データが空です。");
    }
    const { error } = await supabase.rpc("save_koshien_result_snapshot", {
      p_event_id: eventId,
      p_match_rows: matchRows,
      p_score_rows: persistedScoreRows,
      p_results_payload: event.results,
    });
    if (error) {
      throw koshienSaveError("result_transaction", error, "matches・scores・resultsの一括保存に失敗しました。");
    }
  }

  function toAppUser(user, membership, profile) {
    if (!user) return null;
    const clubRole = clubRoleFromMembership(membership);
    return {
      id: user.id,
      username: user.email || user.id,
      displayName: displayNameFromUser(user, profile),
      email: user.email || "",
      role: isClubAdminRole(clubRole) ? "admin" : "member",
      clubRole,
      provider: "supabase",
      rememberDefault: true,
      idleTimeoutMinutes: 0,
      createdAt: user.created_at || new Date().toISOString(),
    };
  }

  function appUrl() {
    return window.location.href.split("#")[0].split("?")[0];
  }

  function emailRedirectTo() {
    return config().emailRedirectTo || config().redirectTo || appUrl();
  }

  function passwordResetRedirectTo() {
    return config().passwordResetRedirectTo || config().redirectTo || appUrl();
  }

  async function supabaseClient() {
    return window.YosoSupabase?.client ? window.YosoSupabase.client() : null;
  }

  async function getCurrentMembership(userId) {
    const supabase = await supabaseClient();
    const current = config();
    if (!supabase || !userId) return null;
    const { data: leagues, error: leagueError } = await supabase
      .from("leagues")
      .select("id")
      .eq(current.activeLeagueId ? "id" : "invite_code", current.activeLeagueId || current.inviteCode)
      .limit(1);
    if (leagueError || !leagues?.length) return null;
    const { data, error } = await supabase
      .from("league_members")
      .select("role, league_id")
      .eq("league_id", leagues[0].id)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return null;
    return data;
  }

  async function getProfile(userId) {
    const supabase = await supabaseClient();
    if (!supabase || !userId) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (error) return null;
    return data;
  }

  async function currentUser() {
    if (!isAuthEnabled()) return null;
    const user = await window.YosoSupabase.sessionUser();
    const [membership, profile] = await Promise.all([
      getCurrentMembership(user?.id),
      getProfile(user?.id),
    ]);
    return toAppUser(user, membership, profile);
  }

  async function signUp({ email, password, displayName }) {
    const supabase = await supabaseClient();
    if (!supabase) throw new Error("Supabase is not configured");
    const { data, error } = await supabase.auth.signUp({
      email: String(email || "").trim().toLowerCase(),
      password,
      options: {
        emailRedirectTo: emailRedirectTo(),
        data: {
          display_name: displayName || String(email || "").split("@")[0],
        },
      },
    });
    if (error) throw error;
    return {
      ok: true,
      user: data.user || null,
      message: "確認メールを送信しました。メール内のリンクを開いた後、この画面からログインしてください。",
    };
  }

  async function signIn({ email, password }) {
    const supabase = await supabaseClient();
    if (!supabase) throw new Error("Supabase is not configured");
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email || "").trim().toLowerCase(),
      password,
    });
    if (error) throw error;
    const [membership, profile] = await Promise.all([
      getCurrentMembership(data.user?.id),
      getProfile(data.user?.id),
    ]);
    return toAppUser(data.user, membership, profile);
  }

  async function sendPasswordResetEmail(email) {
    const supabase = await supabaseClient();
    if (!supabase) throw new Error("Supabase is not configured");
    const { error } = await supabase.auth.resetPasswordForEmail(String(email || "").trim().toLowerCase(), {
      redirectTo: passwordResetRedirectTo(),
    });
    if (error) throw error;
    return { ok: true };
  }

  async function updatePassword(password) {
    const supabase = await supabaseClient();
    if (!supabase) throw new Error("Supabase is not configured");
    const { data, error } = await supabase.auth.updateUser({ password });
    if (error) throw error;
    return { ok: true, user: data.user || null };
  }

  async function onAuthStateChange(callback) {
    const supabase = await supabaseClient();
    if (!supabase) return null;
    const { data } = supabase.auth.onAuthStateChange(callback);
    return data?.subscription || null;
  }

  async function signOut() {
    const supabase = await supabaseClient();
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  async function deleteAccount({ password } = {}) {
    const confirmedPassword = String(password || "");
    if (confirmedPassword.length < 6) throw new Error("現在のパスワードを入力してください。");
    const supabase = await supabaseClient();
    if (!supabase) throw new Error("Supabase is not configured");
    const { data, error } = await supabase.functions.invoke("delete-account", {
      body: { password: confirmedPassword },
    });
    if (error) {
      let details = {};
      try {
        details = await error.context?.json?.() || {};
      } catch {
        details = {};
      }
      const message = details.message
        || (details.error === "password_confirmation_failed" ? "現在のパスワードが違います。" : "")
        || error.message
        || "アカウントを削除できませんでした。";
      const failure = new Error(message);
      failure.code = details.error || error.code || "";
      throw failure;
    }
    if (!data?.deleted) {
      const failure = new Error(data?.message || "アカウントを削除できませんでした。");
      failure.code = data?.error || "";
      throw failure;
    }
    return data;
  }

  async function ensureLeagueMembership({ createIfMissing = false } = {}) {
    const supabase = await supabaseClient();
    const current = config();
    const user = await window.YosoSupabase.sessionUser();
    if (!supabase || !user || !current.inviteCode) return null;

    const { data: existingLeagues } = await supabase
      .from("leagues")
      .select("id, name, invite_code")
      .eq("invite_code", current.inviteCode)
      .limit(1);
    if (existingLeagues?.length) {
      const existingLeague = existingLeagues[0];
      const membership = await getCurrentMembership(user.id);
      if (membership) return existingLeague;
    }
    return null;
  }

  async function clubRpc(name, args = {}) {
    const supabase = await supabaseClient();
    if (!supabase) throw new Error("Supabase is not configured");
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw error;
    return data;
  }

  async function createClub({ name } = {}) {
    const rows = await clubRpc("create_club", { p_name: String(name || "").trim() });
    return Array.isArray(rows) ? rows[0] || null : rows;
  }

  async function searchClubs({ query } = {}) {
    return (await clubRpc("search_clubs", { p_query: String(query || "").trim() })) || [];
  }

  async function lookupClubInvite({ inviteCode } = {}) {
    const rows = await clubRpc("lookup_club_invite", { p_invite_code: String(inviteCode || "").trim() });
    return Array.isArray(rows) ? rows[0] || null : rows;
  }

  async function requestClubJoin({ leagueId } = {}) {
    const rows = await clubRpc("request_club_join", { p_league_id: String(leagueId || "").trim() });
    return Array.isArray(rows) ? rows[0] || null : rows;
  }

  async function listMyClubJoinRequests() {
    return (await clubRpc("list_my_club_join_requests")) || [];
  }

  async function listMyClubs() {
    return (await clubRpc("list_my_clubs")) || [];
  }

  async function listPendingClubJoinRequests({ leagueId } = {}) {
    return (await clubRpc("list_pending_club_join_requests", { p_league_id: String(leagueId || "").trim() })) || [];
  }

  async function reviewClubJoinRequest({ requestId, approve } = {}) {
    const rows = await clubRpc("review_club_join_request", {
      p_request_id: String(requestId || "").trim(),
      p_approve: Boolean(approve),
    });
    return Array.isArray(rows) ? rows[0] || null : rows;
  }

  async function renameClub({ leagueId, name } = {}) {
    const rows = await clubRpc("rename_club", {
      p_league_id: String(leagueId || "").trim(),
      p_name: String(name || "").trim(),
    });
    return Array.isArray(rows) ? rows[0] || null : rows;
  }

  async function deleteClub({ leagueId, confirmationName } = {}) {
    return clubRpc("delete_club", {
      p_league_id: String(leagueId || "").trim(),
      p_confirm_name: String(confirmationName || "").trim(),
    });
  }

  async function removeClubMember({ leagueId, userId } = {}) {
    return clubRpc("remove_club_member", {
      p_league_id: String(leagueId || "").trim(),
      p_user_id: String(userId || "").trim(),
    });
  }

  async function replaceKoshienRepresentatives({ eventId, rows, year } = {}) {
    const normalizedEventId = String(eventId || "").trim();
    const normalizedRows = (Array.isArray(rows) ? rows : []).map((row) => ({
      district_name: String(row?.districtName || "").trim(),
      school_name: String(row?.schoolName || "").trim(),
    }));
    if (!normalizedEventId) throw new Error("代表校を反映するevent_idが必要です。");
    const supabase = await supabaseClient();
    if (!supabase) throw new Error("Supabase is not configured");
    const { data, error } = await supabase.rpc("replace_koshien_representatives", {
      p_event_id: normalizedEventId,
      p_rows: normalizedRows,
      p_source_year: Number.isInteger(Number(year)) ? Number(year) : null,
    });
    if (error) throw koshienSaveError("teams", error, "49代表校を保存できませんでした。");
    return data;
  }

  async function deleteKoshienEvent({ eventId, confirmationName } = {}) {
    const normalizedEventId = String(eventId || "").trim();
    const normalizedName = String(confirmationName || "").trim();
    if (!normalizedEventId || !normalizedName) throw new Error("削除対象の大会を確認できませんでした。");
    const supabase = await supabaseClient();
    if (!supabase) throw new Error("Supabase is not configured");
    const { data, error } = await supabase
      .from("events")
      .delete()
      .eq("id", normalizedEventId)
      .eq("name", normalizedName)
      .select("id");
    if (error) throw error;
    if (!Array.isArray(data) || data.length !== 1 || String(data[0].id) !== normalizedEventId) {
      throw new Error("対象大会だけを削除できませんでした。");
    }
    return { ok: true, eventId: normalizedEventId };
  }

  async function saveKoshienStructuredTables({ supabase, user, league, membership, event, participantName, profile, scoreRows, savePrediction }) {
    const displayName = participantName || displayNameFromUser(user, profile);
    const playerPayload = {
      league_id: league.id,
      profile_id: user.id,
      display_name: displayName,
      is_admin: isClubAdminRole(clubRoleFromMembership(membership)),
    };
    const { data: player, error: playerError } = await supabase
      .from("players")
      .upsert(playerPayload, { onConflict: "league_id,profile_id" })
      .select("id")
      .single();
    if (playerError) throw playerError;

    const eventId = String(event.id);
    let teamRows = [];
    const teams = Array.isArray(event.config?.teams) ? event.config.teams : [];
    if (isClubAdminRole(clubRoleFromMembership(membership)) && teams.length) {
      const rows = teams.map((name, index) => {
        const meta = koshienTeamMeta(event, name, index);
        return {
          event_id: eventId,
          name,
          team_id: `koshien-2026-${index + 1}`,
          school_name: name,
          seed: index + 1,
          start_round: meta.startRound,
          odds: meta.odds,
          metadata: {
            ...koshienRepresentativeMetadata(name, meta, "yoso-koshien"),
            sqrt_odds_snapshot: meta.sqrtOdds,
          },
        };
      });
      const { data, error } = await supabase
        .from("teams")
        .upsert(rows, { onConflict: "event_id,name" })
        .select("id, name, odds, sqrt_odds");
      if (error) throw error;
      teamRows = data || [];
    } else {
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, odds, sqrt_odds")
        .eq("event_id", eventId);
      if (error) throw error;
      teamRows = data || [];
    }

    const teamByName = new Map(teamRows.map((team) => [team.name, team]));
    if (!savePrediction) return { player, teamRows, predictionSaved: false };

    const prediction = event.predictions?.[participantName];
    if (!prediction || !player?.id) return { player, teamRows, predictionSaved: false };

    const phase1Picks = fixedArray(prediction.teams, Number(event.config?.pickCount) || 8)
      .map((name, index) => ({ name, index }))
      .filter((pick) => pick.name && teamByName.has(pick.name));
    const pickCount = Number(event.config?.pickCount) || 8;
    if (phase1Picks.length !== pickCount) return { player, teamRows, predictionSaved: false };
    const captain = teamByName.get(prediction.captain);
    if (!captain) throw new Error("キャプテンは選択した8校から選んでください。");
    const { error: phase1Error } = await supabase.rpc("save_koshien_phase1_prediction", {
      p_event_id: eventId,
      p_team_ids: phase1Picks.map((pick) => teamByName.get(pick.name).id),
      p_captain_team_id: captain.id,
      p_payload: prediction,
    });
    if (phase1Error) throw phase1Error;

    return { player, teamRows, predictionSaved: true };
  }

  async function saveKoshienSnapshot({ state, event, participantName, scoreRows = [] }) {
    if (!shouldAutoSaveKoshien()) return { skipped: true, reason: "autoSaveKoshien is disabled" };
    if (!event || event.templateId !== "koshien") return { skipped: true, reason: "event is not koshien" };

    const supabase = await supabaseClient();
    const user = await window.YosoSupabase.sessionUser();
    if (!supabase || !user) return { skipped: true, reason: "Supabase session is not ready" };

    const league = await ensureLeagueMembership({ createIfMissing: true });
    if (!league?.id) return { skipped: true, reason: "league is not ready" };
    const membership = await getCurrentMembership(user.id);
    const profile = await getProfile(user.id);
    const isAdmin = isClubAdminRole(clubRoleFromMembership(membership));
    const savePrediction = event.status === "open"
      && (!event.deadline || Date.now() < Date.parse(event.deadline));
    const hasStructuredResultData = isAdmin && (
      (event.results?.matches || []).some((match) => match.status === "completed")
      || Object.values(event.results?.finishes || {}).some(Boolean)
    );
    if (hasStructuredResultData && (!Array.isArray(scoreRows) || !scoreRows.length)) {
      throw koshienSaveError("scores", null, "試合結果はありますが、scores保存用の行が空です。");
    }

    const deadline = event.deadline ? new Date(event.deadline).toISOString() : null;
    const eventId = String(event.id);
    const { data: existingEvent, error: existingEventError } = await supabase
      .from("events")
      .select("id")
      .eq("id", eventId)
      .maybeSingle();
    if (existingEventError) throw existingEventError;

    if (isAdmin) {
      const eventPayload = {
        id: eventId,
        league_id: league.id,
        name: event.name,
        preset_type: "koshien",
        status: event.status || "open",
        prediction_deadline: deadline,
        rules: {
          approvalPolicy: event.approvalPolicy || state.approvalPolicy,
          config: event.config || {},
          resultFlow: event.resultFlow || {},
          localEventId: event.id,
        },
        created_by: user.id,
      };
      const { error: eventError } = await supabase.from("events").upsert(eventPayload);
      if (eventError) throw eventError;

      const teams = Array.isArray(event.config?.teams) ? event.config.teams : [];
      if (teams.length) {
        const teamRows = teams.map((name, index) => {
          const meta = koshienTeamMeta(event, name, index);
          return {
            event_id: eventId,
            name,
            seed: index + 1,
            metadata: koshienRepresentativeMetadata(name, meta, "localStorage"),
          };
        });
        const { error: teamsError } = await supabase.from("event_teams").upsert(teamRows, { onConflict: "event_id,name" });
        if (teamsError) throw teamsError;
      }

    } else if (!existingEvent) {
      return { skipped: true, reason: "admin must create the Koshien event before members can save predictions" };
    }

    let structuredSaved = false;
    let structuredContext = null;
    const warnings = [];
    try {
      structuredContext = await saveKoshienStructuredTables({ supabase, user, league, membership, event, participantName, profile, scoreRows, savePrediction });
      structuredSaved = true;
    } catch (error) {
      const stagedError = error?.stage ? error : koshienSaveError("structured", error, "structured tablesの保存に失敗しました。");
      if (isMissingRelationError(stagedError) && !hasStructuredResultData) {
        console.warn("Koshien structured tables are not installed yet. Run supabase/schema.sql and supabase/rls-policies.sql to enable them.", stagedError);
        warnings.push("structured_tables_missing");
      } else {
        throw stagedError;
      }
    }

    let rawResultsSaved = !isAdmin || !event.results;
    let scoresSaved = !hasStructuredResultData;
    if (hasStructuredResultData) {
      await saveKoshienResultTransaction({
        supabase,
        league,
        event,
        teamRows: structuredContext?.teamRows || [],
        scoreRows,
      });
      rawResultsSaved = true;
      scoresSaved = true;
    } else if (isAdmin && event.results) {
      const { error: resultsError } = await supabase.from("results").upsert({
        event_id: eventId,
        payload: event.results,
        updated_by: user.id,
      }, { onConflict: "event_id" });
      if (resultsError) throw koshienSaveError("results", resultsError, "resultsスナップショットの保存に失敗しました。");
      rawResultsSaved = true;
    }

    return {
      ok: true,
      ...(warnings.length ? { partial: true, warnings } : {}),
      stages: {
        structured: structuredSaved,
        scores: scoresSaved,
        results: rawResultsSaved,
      },
    };
  }

  function isPredictionPublic(event) {
    const status = event?.status || "open";
    if (status === "resultWait" || status === "finalized" || status === "archive") return true;
    if (!event?.prediction_deadline) return false;
    return Date.now() >= Date.parse(event.prediction_deadline);
  }

  async function loadKoshienSnapshot({ eventId } = {}) {
    if (!shouldAutoSaveKoshien()) return { skipped: true, reason: "autoSaveKoshien is disabled" };

    const supabase = await supabaseClient();
    const user = await window.YosoSupabase.sessionUser();
    if (!supabase || !user) return { skipped: true, reason: "Supabase session is not ready" };

    const league = await ensureLeagueMembership();
    if (!league?.id) return { skipped: true, reason: "league is not ready" };
    const membership = await getCurrentMembership(user.id);
    const profile = await getProfile(user.id);

    const selectedEventId = String(eventId || "").trim();
    const eventQuery = () => supabase
      .from("events")
      .select("id, league_id, name, preset_type, status, prediction_deadline, rules, created_by, updated_at")
      .eq("league_id", league.id)
      .eq("preset_type", "koshien");
    let eventResponse = selectedEventId
      ? await eventQuery().eq("id", selectedEventId).maybeSingle()
      : await eventQuery().order("updated_at", { ascending: false }).limit(1);
    if (selectedEventId && !eventResponse.error && !eventResponse.data) {
      eventResponse = await eventQuery().order("updated_at", { ascending: false }).limit(1);
    }
    const events = Array.isArray(eventResponse.data)
      ? eventResponse.data
      : (eventResponse.data ? [eventResponse.data] : []);
    const eventError = eventResponse.error;
    if (eventError) throw eventError;
    const event = events?.[0];
    if (!event) return { skipped: true, reason: "koshien event is not found", league, membership };

    const [
      { data: teams, error: teamsError },
      { data: results, error: resultsError },
      { data: members, error: membersError },
    ] = await Promise.all([
      supabase
        .from("event_teams")
        .select("name, seed, metadata")
        .eq("event_id", event.id)
        .order("seed", { ascending: true }),
      supabase
        .from("results")
        .select("payload, updated_at")
        .eq("event_id", event.id)
        .maybeSingle(),
      supabase
        .from("league_members")
        .select("user_id, role, membership_status, profiles(display_name)")
        .eq("league_id", league.id)
        .eq("membership_status", "active"),
    ]);
    if (teamsError) throw teamsError;
    if (resultsError) throw resultsError;
    if (membersError) throw membersError;

    const predictionSelect = isPredictionPublic(event)
      ? supabase
        .from("predictions")
        .select("user_id, payload, submitted_at, profiles(display_name)")
        .eq("event_id", event.id)
      : supabase
        .from("predictions")
        .select("user_id, payload, submitted_at, profiles(display_name)")
        .eq("event_id", event.id)
        .eq("user_id", user.id);
    const { data: predictions, error: predictionError } = await predictionSelect;
    if (predictionError) throw predictionError;

    return {
      ok: true,
      league,
      membership,
      currentUser: {
        id: user.id,
        displayName: profile?.display_name || user.user_metadata?.display_name || user.email?.split("@")[0] || "あなた",
      },
      event,
      teams: teams || [],
      members: members || [],
      predictions: predictions || [],
      results: results || null,
      predictionsPublic: isPredictionPublic(event),
    };
  }

  function loadLocalState(storageKey) {
    const stored = localStorage.getItem(storageKey);
    return stored ? JSON.parse(stored) : null;
  }

  function saveLocalState(storageKey, state) {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  window.YosoDataService = {
    isConfigured,
    isAuthEnabled,
    shouldAutoSaveKoshien,
    auth: {
      currentUser,
      signUp,
      signIn,
      sendPasswordResetEmail,
      updatePassword,
      onAuthStateChange,
      signOut,
      deleteAccount,
    },
    league: {
      ensureMembership: ensureLeagueMembership,
      manageAdmin: manageLeagueAdmin,
      createClub,
      searchClubs,
      lookupClubInvite,
      requestJoin: requestClubJoin,
      listMyJoinRequests: listMyClubJoinRequests,
      listMyClubs,
      listPendingJoinRequests: listPendingClubJoinRequests,
      reviewJoinRequest: reviewClubJoinRequest,
      renameClub,
      deleteClub,
      removeMember: removeClubMember,
    },
    koshien: {
      saveSnapshot: saveKoshienSnapshot,
      loadSnapshot: loadKoshienSnapshot,
      replaceRepresentatives: replaceKoshienRepresentatives,
      deleteEvent: deleteKoshienEvent,
      loadPhase2DraftState,
      savePhase2DraftPick,
      loadLaterPhaseState,
      saveRevengePick,
      saveZombiePrediction,
      savePhase3Prediction,
      prepareLaterPhase,
      setLaterPhaseStatus,
      cancelKoshienMatchResult,
      reopenKoshienResults,
    },
    local: {
      loadState: loadLocalState,
      saveState: saveLocalState,
    },
  };
})();
