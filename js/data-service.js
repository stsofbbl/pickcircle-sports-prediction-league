(function () {
  "use strict";

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

  function toAppUser(user, membership, profile) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.email || user.id,
      displayName: displayNameFromUser(user, profile),
      email: user.email || "",
      role: membership?.role === "admin" ? "admin" : "member",
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
    if (!supabase || !userId || !current.inviteCode) return null;
    const { data: leagues, error: leagueError } = await supabase
      .from("leagues")
      .select("id")
      .eq("invite_code", current.inviteCode)
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
    await ensureLeagueMembership({ createIfMissing: true });
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

      const joined = await supabase.rpc("join_league_by_invite", { p_invite_code: current.inviteCode });
      if (joined.error) throw joined.error;
      return joined.data || existingLeague;
    }

    const rpcName = createIfMissing ? "create_league_with_admin" : "join_league_by_invite";
    const args = createIfMissing
      ? { p_name: current.leagueName || "YOSO League", p_invite_code: current.inviteCode }
      : { p_invite_code: current.inviteCode };
    const { data, error } = await supabase.rpc(rpcName, args);
    if (error && createIfMissing && /already exists/i.test(error.message || "")) {
      const fallback = await supabase.rpc("join_league_by_invite", { p_invite_code: current.inviteCode });
      if (fallback.error) throw fallback.error;
      return fallback.data;
    }
    if (error && !createIfMissing) return null;
    if (error) throw error;
    return data;
  }

  async function saveKoshienSnapshot({ state, event, participantName }) {
    if (!shouldAutoSaveKoshien()) return { skipped: true, reason: "autoSaveKoshien is disabled" };
    if (!event || event.templateId !== "koshien") return { skipped: true, reason: "event is not koshien" };

    const supabase = await supabaseClient();
    const user = await window.YosoSupabase.sessionUser();
    if (!supabase || !user) return { skipped: true, reason: "Supabase session is not ready" };

    const league = await ensureLeagueMembership({ createIfMissing: true });
    if (!league?.id) return { skipped: true, reason: "league is not ready" };
    const membership = await getCurrentMembership(user.id);
    const isAdmin = membership?.role === "admin";

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
          localEventId: event.id,
        },
        created_by: user.id,
      };
      const { error: eventError } = await supabase.from("events").upsert(eventPayload);
      if (eventError) throw eventError;

      const teams = Array.isArray(event.config?.teams) ? event.config.teams : [];
      if (teams.length) {
        const teamRows = teams.map((name, index) => ({
          event_id: eventId,
          name,
          seed: index + 1,
          metadata: { source: "localStorage" },
        }));
        const { error: teamsError } = await supabase.from("event_teams").upsert(teamRows, { onConflict: "event_id,name" });
        if (teamsError) throw teamsError;
      }

      if (event.results) {
        const { error: resultsError } = await supabase.from("results").upsert({
          event_id: eventId,
          payload: event.results,
          updated_by: user.id,
        }, { onConflict: "event_id" });
        if (resultsError) throw resultsError;
      }
    } else if (!existingEvent) {
      return { skipped: true, reason: "admin must create the Koshien event before members can save predictions" };
    }

    const myPrediction = event.predictions?.[participantName];
    if (myPrediction) {
      const { error: predictionError } = await supabase.from("predictions").upsert({
        event_id: eventId,
        user_id: user.id,
        payload: myPrediction,
        submitted_at: new Date().toISOString(),
      }, { onConflict: "event_id,user_id" });
      if (predictionError) throw predictionError;
    }

    return { ok: true };
  }

  function isPredictionPublic(event) {
    const status = event?.status || "open";
    if (status === "resultWait" || status === "finalized" || status === "archive") return true;
    if (!event?.prediction_deadline) return false;
    return Date.now() >= Date.parse(event.prediction_deadline);
  }

  async function loadKoshienSnapshot() {
    if (!shouldAutoSaveKoshien()) return { skipped: true, reason: "autoSaveKoshien is disabled" };

    const supabase = await supabaseClient();
    const user = await window.YosoSupabase.sessionUser();
    if (!supabase || !user) return { skipped: true, reason: "Supabase session is not ready" };

    const league = await ensureLeagueMembership();
    if (!league?.id) return { skipped: true, reason: "league is not ready" };
    const membership = await getCurrentMembership(user.id);
    const profile = await getProfile(user.id);

    const { data: events, error: eventError } = await supabase
      .from("events")
      .select("id, league_id, name, preset_type, status, prediction_deadline, rules, created_by, updated_at")
      .eq("league_id", league.id)
      .eq("preset_type", "koshien")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (eventError) throw eventError;
    const event = events?.[0];
    if (!event) return { skipped: true, reason: "koshien event is not found", league, membership };

    const [{ data: teams, error: teamsError }, { data: results, error: resultsError }] = await Promise.all([
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
    ]);
    if (teamsError) throw teamsError;
    if (resultsError) throw resultsError;

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
    },
    league: {
      ensureMembership: ensureLeagueMembership,
    },
    koshien: {
      saveSnapshot: saveKoshienSnapshot,
      loadSnapshot: loadKoshienSnapshot,
    },
    local: {
      loadState: loadLocalState,
      saveState: saveLocalState,
    },
  };
})();
