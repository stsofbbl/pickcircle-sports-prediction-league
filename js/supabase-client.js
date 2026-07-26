(function () {
  "use strict";

  const CONFIG_STORAGE_KEY = "yoso-supabase-config-v1";
  let clientPromise = null;

  function defaultLeagueId() {
    return window.YOSO_PUBLIC_CONFIG?.DEFAULT_LEAGUE_ID || "g-unit-koshien-2026";
  }

  function fromStorage() {
    try {
      const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  function publicConfig() {
    return window.YOSO_SUPABASE_CONFIG || {};
  }

  function saveConfig(nextConfig = {}) {
    const base = {
      ...publicConfig(),
      ...fromStorage(),
    };
    const normalized = {
      ...base,
      ...nextConfig,
      url: String(nextConfig.url ?? base.url ?? "").trim(),
      anonKey: String(nextConfig.anonKey ?? base.anonKey ?? "").trim(),
      inviteCode: String(nextConfig.inviteCode ?? nextConfig.leagueId ?? base.inviteCode ?? defaultLeagueId()).trim(),
      activeLeagueId: String(nextConfig.activeLeagueId ?? base.activeLeagueId ?? "").trim(),
      leagueName: String(nextConfig.leagueName ?? base.leagueName ?? "G-UNIT YOSO League").trim(),
      sdkUrl: nextConfig.sdkUrl || base.sdkUrl || "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
      auth: { enabled: true, ...(nextConfig.auth || {}) },
      sync: { autoSaveKoshien: true, ...(nextConfig.sync || {}) },
    };
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(normalized));
    clientPromise = null;
    return normalized;
  }

  function applyConfigFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const url = params.get("supabaseUrl");
    const anonKey = params.get("supabaseAnonKey") || params.get("anonKey");
    const leagueId = params.get("league") || params.get("inviteCode") || params.get("leagueId");
    if (!url && !anonKey && !leagueId) return;
    saveConfig({
      ...(url ? { url } : {}),
      ...(anonKey ? { anonKey } : {}),
      inviteCode: leagueId || defaultLeagueId(),
      leagueName: params.get("leagueName") || "G-UNIT YOSO League",
      emailRedirectTo: window.location.href.split("#")[0].split("?")[0],
      passwordResetRedirectTo: window.location.href.split("#")[0].split("?")[0],
      auth: { enabled: true },
      sync: { autoSaveKoshien: true },
    });
  }

  function config() {
    const base = publicConfig();
    const stored = fromStorage();
    return {
      ...base,
      ...stored,
      url: String(stored.url || base.url || "").trim(),
      anonKey: String(stored.anonKey || base.anonKey || "").trim(),
      inviteCode: String(stored.inviteCode || stored.leagueId || base.inviteCode || defaultLeagueId()).trim(),
      activeLeagueId: String(stored.activeLeagueId || base.activeLeagueId || "").trim(),
      sdkUrl: stored.sdkUrl || base.sdkUrl || "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
      auth: { enabled: true, ...(base.auth || {}), ...(stored.auth || {}) },
      sync: { autoSaveKoshien: true, ...(base.sync || {}), ...(stored.sync || {}) },
    };
  }

  function hasConfig() {
    const current = config();
    return Boolean(current.url && current.anonKey);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = [...document.scripts].find((script) => script.dataset.yosoSupabaseSdk === src);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        if (window.supabase?.createClient) resolve();
        return;
      }
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.dataset.yosoSupabaseSdk = src;
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", () => reject(new Error(`Failed to load Supabase SDK: ${src}`)), { once: true });
      document.head.append(script);
    });
  }

  async function client() {
    if (!hasConfig()) return null;
    if (!clientPromise) {
      clientPromise = (async () => {
        const current = config();
        if (!window.supabase?.createClient) {
          await loadScript(current.sdkUrl || "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
        }
        if (!window.supabase?.createClient) throw new Error("Supabase SDK is not available");
        return window.supabase.createClient(current.url, current.anonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });
      })();
    }
    return clientPromise;
  }

  async function sessionUser() {
    const supabase = await client();
    if (!supabase) return null;
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user || null;
  }

  window.YosoSupabase = {
    config,
    hasConfig,
    saveConfig,
    client,
    sessionUser,
    CONFIG_STORAGE_KEY,
  };
  applyConfigFromUrl();
  if (!fromStorage().inviteCode && hasConfig()) {
    const current = config();
    saveConfig({ inviteCode: current.inviteCode || defaultLeagueId() });
  }
})();
