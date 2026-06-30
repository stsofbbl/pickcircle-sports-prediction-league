(function () {
  "use strict";

  const CONFIG_STORAGE_KEY = "yoso-supabase-config-v1";
  let clientPromise = null;

  function fromStorage() {
    try {
      const stored = localStorage.getItem(CONFIG_STORAGE_KEY);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  }

  function saveConfig(nextConfig = {}) {
    const normalized = {
      ...fromStorage(),
      ...nextConfig,
      url: String(nextConfig.url || "").trim(),
      anonKey: String(nextConfig.anonKey || "").trim(),
      inviteCode: String(nextConfig.inviteCode || "g-unit-koshien-2026").trim(),
      leagueName: String(nextConfig.leagueName || "G-UNIT YOSO League").trim(),
      sdkUrl: nextConfig.sdkUrl || "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
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
    if (!url || !anonKey) return;
    saveConfig({
      url,
      anonKey,
      inviteCode: params.get("inviteCode") || "g-unit-koshien-2026",
      leagueName: params.get("leagueName") || "G-UNIT YOSO League",
      emailRedirectTo: window.location.href.split("#")[0].split("?")[0],
      passwordResetRedirectTo: window.location.href.split("#")[0].split("?")[0],
      auth: { enabled: true },
      sync: { autoSaveKoshien: true },
    });
  }

  function config() {
    return {
      ...(window.YOSO_SUPABASE_CONFIG || {}),
      ...fromStorage(),
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
})();
