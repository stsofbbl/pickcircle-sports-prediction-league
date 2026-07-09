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

  function isMissingRelationError(error) {
    return ["42P01", "42703"].includes(error?.code) || /relation .* does not exist|column .* does not exist/i.test(error?.message || "");
  }

  function koshienTeamMeta(event, name, index) {
    const meta = event?.config?.teamMeta?.[name] || {};
    const odds = Number(meta.odds) > 0 ? Number(meta.odds) : 1;
    const startRound = Number(meta.startRound) === 2 || index < 15 ? 2 : 1;
    return {
      startRound,
      odds,
      sqrtOdds: Math.round(Math.sqrt(odds) * 10000) / 10000,
    };
  }

  function fixedArray(value, count) {
    const rows = Array.isArray(value) ? value.slice(0, count) : [];
    while (rows.length < count) rows.push("");
    return rows;
  }

  function koshienNumericScore(value) {
    return value === "" || value === null || value === undefined ? null : Number(value);
  }

  function koshienRoundMatchNo(match, index) {
    return Number(match.match_no) || Number(String(match.match_id || "").split("-")[1]) || index + 1;
  }

  async function saveKoshienMatches({ supabase, eventId, event, teamByName }) {
    const matches = Array.isArray(event.results?.matches) ? event.results.matches : [];
    if (!matches.length) return;
    const rows = matches.map((match, index) => {
      const teamA = teamByName.get(match.team_a_id);
      const teamB = teamByName.get(match.team_b_id);
      const winner = teamByName.get(match.winner_id);
      const loser = teamByName.get(match.loser_id);
      return {
        event_id: eventId,
        round_key: match.round || "R1",
        match_no: koshienRoundMatchNo(match, index),
        team1_id: teamA?.id || null,
        team2_id: teamB?.id || null,
        team1_score: koshienNumericScore(match.score_a),
        team2_score: koshienNumericScore(match.score_b),
        winner_team_id: winner?.id || null,
        loser_team_id: loser?.id || null,
        status: match.status === "completed" ? "completed" : "scheduled",
        metadata: {
          match_id: match.match_id || null,
          team_a_name: match.team_a_id || "",
          team_b_name: match.team_b_id || "",
          winner_name: match.winner_id || "",
          loser_team_id: loser?.id || null,
          loser_name: match.loser_id || "",
          app_status: match.status || "scheduled",
        },
      };
    });
    const { error } = await supabase.from("matches").upsert(rows, { onConflict: "event_id,round_key,match_no" });
    if (error) throw error;
  }

  async function saveKoshienScores({ supabase, eventId, leagueId, scoreRows }) {
    if (!Array.isArray(scoreRows) || !scoreRows.length) return;
    const { data: players, error: playersError } = await supabase
      .from("players")
      .select("id, display_name")
      .eq("league_id", leagueId);
    if (playersError) throw playersError;
    const playerByName = new Map((players || []).map((player) => [player.display_name, player]));
    const rows = scoreRows
      .map((row) => {
        const player = playerByName.get(row.name);
        if (!player?.id) return null;
        const breakdown = row.breakdown || {};
        return {
          event_id: eventId,
          player_id: player.id,
          phase1_score: Number(breakdown.phase1) || 0,
          phase2_score: Number(breakdown.phase2) || 0,
          phase3_score: Number(breakdown.phase3) || 0,
          revenge_score: Number(breakdown.revenge) || 0,
          zombie_score: Number(breakdown.zombie) || 0,
          breakdown: {
            ...breakdown,
            total: Number(row.score) || 0,
            detail: row.detail || "",
          },
        };
      })
      .filter(Boolean);
    if (!rows.length) return;
    const { error } = await supabase.from("scores").upsert(rows, { onConflict: "event_id,player_id" });
    if (error) throw error;
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

  async function saveKoshienStructuredTables({ supabase, user, league, membership, event, participantName, profile, scoreRows }) {
    const displayName = participantName || displayNameFromUser(user, profile);
    const playerPayload = {
      league_id: league.id,
      profile_id: user.id,
      display_name: displayName,
      is_admin: membership?.role === "admin",
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
    if (membership?.role === "admin" && teams.length) {
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
          metadata: { source: "yoso-koshien", sqrt_odds_snapshot: meta.sqrtOdds },
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
    if (membership?.role === "admin") {
      await saveKoshienMatches({ supabase, eventId, event, teamByName });
      await saveKoshienScores({ supabase, eventId, leagueId: league.id, scoreRows });
    }

    const prediction = event.predictions?.[participantName];
    if (!prediction || !player?.id) return;

    const phase1Picks = fixedArray(prediction.teams, Number(event.config?.pickCount) || 8)
      .map((name, index) => ({ name, index }))
      .filter((pick) => pick.name && teamByName.has(pick.name));
    const { error: phase1DeleteError } = await supabase
      .from("phase1_picks")
      .delete()
      .eq("event_id", eventId)
      .eq("player_id", player.id);
    if (phase1DeleteError) throw phase1DeleteError;
    if (phase1Picks.length) {
      const rows = phase1Picks.map((pick) => {
        const team = teamByName.get(pick.name);
        return {
          event_id: eventId,
          player_id: player.id,
          team_id: team.id,
          pick_order: pick.index + 1,
          captain: prediction.captain === pick.name,
          odds_snapshot: Number(team.odds) || null,
          sqrt_odds_snapshot: Number(team.sqrt_odds) || null,
        };
      });
      const { error } = await supabase.from("phase1_picks").insert(rows);
      if (error) throw error;
    }

    const phase2Picks = fixedArray(prediction.phase2DraftPicks, Number(event.config?.phase2DraftCount) || 4)
      .map((name, index) => ({ name, index }))
      .filter((pick) => pick.name && teamByName.has(pick.name));
    const { error: phase2DeleteError } = await supabase
      .from("phase2_draft_picks")
      .delete()
      .eq("event_id", eventId)
      .eq("player_id", player.id);
    if (phase2DeleteError) throw phase2DeleteError;
    if (phase2Picks.length) {
      const rows = phase2Picks.map((pick) => {
        const team = teamByName.get(pick.name);
        return {
          event_id: eventId,
          player_id: player.id,
          team_id: team.id,
          draft_round: pick.index + 1,
          odds_snapshot: Number(team.odds) || null,
          sqrt_odds_snapshot: Number(team.sqrt_odds) || null,
        };
      });
      const { error } = await supabase.from("phase2_draft_picks").insert(rows);
      if (error) throw error;
    }

    const { error: revengeDeleteError } = await supabase
      .from("revenge_picks")
      .delete()
      .eq("event_id", eventId)
      .eq("player_id", player.id);
    if (revengeDeleteError) throw revengeDeleteError;
    const revengeTeam = teamByName.get(prediction.revengePick);
    if (revengeTeam) {
      const { error } = await supabase.from("revenge_picks").insert({
        event_id: eventId,
        player_id: player.id,
        target_team_id: revengeTeam.id,
        payload: { source_type: "app_selected" },
      });
      if (error) throw error;
    }

    const { error: zombieDeleteError } = await supabase
      .from("zombie_predictions")
      .delete()
      .eq("event_id", eventId)
      .eq("player_id", player.id);
    if (zombieDeleteError) throw zombieDeleteError;
    const zombieTeam = teamByName.get(prediction.zombiePick);
    if (zombieTeam) {
      const { error } = await supabase.from("zombie_predictions").insert({
        event_id: eventId,
        player_id: player.id,
        team_id: zombieTeam.id,
        payload: { target_team_name: prediction.zombiePick },
      });
      if (error) throw error;
    }

    const finalScore = prediction.finalScorePrediction || {};
    const hasFinalScore = finalScore.champion || finalScore.runnerUp || finalScore.championScore !== "" || finalScore.runnerUpScore !== "";
    if (!hasFinalScore) {
      const { error: finalScoreDeleteError } = await supabase
        .from("final_score_predictions")
        .delete()
        .eq("event_id", eventId)
        .eq("player_id", player.id);
      if (finalScoreDeleteError) throw finalScoreDeleteError;
    }
    if (hasFinalScore) {
      const { error } = await supabase.from("final_score_predictions").upsert({
        event_id: eventId,
        player_id: player.id,
        champion_team_id: teamByName.get(finalScore.champion)?.id || null,
        runner_up_team_id: teamByName.get(finalScore.runnerUp)?.id || null,
        champion_score: finalScore.championScore === "" ? null : Number(finalScore.championScore),
        runner_up_score: finalScore.runnerUpScore === "" ? null : Number(finalScore.runnerUpScore),
      }, { onConflict: "event_id,player_id" });
      if (error) throw error;
    }
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

    try {
      await saveKoshienStructuredTables({ supabase, user, league, membership, event, participantName, profile, scoreRows });
    } catch (error) {
      if (isMissingRelationError(error)) {
        console.warn("Koshien structured tables are not installed yet. Run supabase/schema.sql and supabase/rls-policies.sql to enable them.", error);
      } else {
        throw error;
      }
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
