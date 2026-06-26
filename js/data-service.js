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

  function authEmail(username) {
    const value = String(username || "").trim().toLowerCase();
    if (value.includes("@")) return value;
    return `${value}@users.yoso.local`;
  }

  function displayNameFromUser(user) {
    return user?.user_metadata?.display_name || user?.email?.split("@")[0] || "YOSO member";
  }

  function toAppUser(user, membership) {
    if (!user) return null;
    return {
      id: user.id,
      username: user.email || user.id,
      displayName: displayNameFromUser(user),
      email: user.email || "",
      role: membership?.role === "admin" ? "admin" : "member",
      provider: "supabase",
      rememberDefault: true,
      idleTimeoutMinutes: 0,
      createdAt: user.created_at || new Date().toISOString(),
    };
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

  async function currentUser() {
    if (!isAuthEnabled()) return null;
    const user = await window.YosoSupabase.sessionUser();
    return toAppUser(user, await getCurrentMembership(user?.id));
  }

  async function signUp({ username, password, displayName }) {
    const supabase = await supabaseClient();
    if (!supabase) throw new Error("Supabase is not configured");
    const email = authEmail(username);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: displayName || username,
        },
      },
    });
    if (error) throw error;
    await ensureLeagueMembership({ createIfMissing: true });
    return toAppUser(data.user || (await window.YosoSupabase.sessionUser()), await getCurrentMembership(data.user?.id));
  }

  async function signIn({ username, password }) {
    const supabase = await supabaseClient();
    if (!supabase) throw new Error("Supabase is not configured");
    const { data, error } = await supabase.auth.signInWithPassword({
      email: authEmail(username),
      password,
    });
    if (error) throw error;
    await ensureLeagueMembership();
    return toAppUser(data.user, await getCurrentMembership(data.user?.id));
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
      signOut,
    },
    league: {
      ensureMembership: ensureLeagueMembership,
    },
    koshien: {
      saveSnapshot: saveKoshienSnapshot,
    },
    local: {
      loadState: loadLocalState,
      saveState: saveLocalState,
    },
  };
})();
