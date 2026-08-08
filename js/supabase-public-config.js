window.YOSO_PUBLIC_CONFIG = Object.freeze({
  DEFAULT_SAVE_MODE: "supabase",
  DEFAULT_LEAGUE_ID: "g-unit-koshien-2026",
  SUPABASE_PROJECT_URL: "https://gubsrwaxpifhvwommpos.supabase.co",
  SUPABASE_ANON_PUBLIC_KEY: "sb_publishable_8MPN6PoZA2FBaEoc_FmYsg_MGEKFeZV",
});

window.YOSO_SUPABASE_CONFIG = {
  url: window.YOSO_PUBLIC_CONFIG.SUPABASE_PROJECT_URL,
  anonKey: window.YOSO_PUBLIC_CONFIG.SUPABASE_ANON_PUBLIC_KEY,
  inviteCode: window.YOSO_PUBLIC_CONFIG.DEFAULT_LEAGUE_ID,
  leagueName: "G-UNIT YOSO League",
  sdkUrl: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  redirectTo: window.location.href.split("#")[0].split("?")[0],
  emailRedirectTo: window.location.href.split("#")[0].split("?")[0],
  passwordResetRedirectTo: window.location.href.split("#")[0].split("?")[0],
  auth: {
    enabled: true,
  },
  sync: {
    autoSaveKoshien: true,
  },
};

(() => {
  const script = document.createElement("script");
  script.src = "./js/koshien-start-time-bridge.js?v=20260809-2";
  script.async = false;
  document.head.appendChild(script);
})();
