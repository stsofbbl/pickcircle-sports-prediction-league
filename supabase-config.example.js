// Copy this file to supabase-config.js when you are ready to test Supabase.
// Only use the Supabase anon public key in the browser. Never put service_role here.
window.YOSO_SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_PUBLIC_KEY",
  inviteCode: "g-unit-koshien-2026",
  leagueName: "G-UNIT YOSO League",
  sdkUrl: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  auth: {
    enabled: false
  },
  sync: {
    autoSaveKoshien: false
  }
};
