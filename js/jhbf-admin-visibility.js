(function (root) {
  "use strict";

  function install() {
    if (typeof bindActiveEventManagerInputs !== "function") return false;
    const originalBind = bindActiveEventManagerInputs;
    bindActiveEventManagerInputs = function bindActiveEventManagerInputsWithJhbfVisibility() {
      originalBind();
      const isAdmin = typeof canCurrentUserManageLeague === "function"
        ? canCurrentUserManageLeague()
        : typeof isCurrentUserAdmin === "function" && isCurrentUserAdmin();
      if (!isAdmin) {
        document.querySelectorAll(".koshien-jhbf-import").forEach((panel) => panel.remove());
      }
    };
    if (typeof renderActiveEventManager === "function") renderActiveEventManager();
    return true;
  }

  function loadHomeDashboardPolish() {
    if (root.YosoHomeDashboardPolish || root.document?.querySelector('script[data-yoso-home-dashboard-polish]')) return;
    const script = root.document?.createElement("script");
    if (!script) return;
    script.src = "./js/home-dashboard-polish.js?v=20260808-2";
    script.dataset.yosoHomeDashboardPolish = "true";
    root.document.head?.appendChild(script);
  }

  function loadHomeDashboard() {
    if (root.YosoHomeDashboard) {
      loadHomeDashboardPolish();
      return;
    }
    if (root.document?.querySelector('script[data-yoso-home-dashboard]')) return;
    const script = root.document?.createElement("script");
    if (!script) return;
    script.src = "./js/home-dashboard.js?v=20260807-1";
    script.dataset.yosoHomeDashboard = "true";
    script.onload = loadHomeDashboardPolish;
    root.document.head?.appendChild(script);
  }

  function loadKoshienScheduleSync() {
    if (root.YosoKoshienScheduleSync || root.document?.querySelector('script[data-yoso-koshien-schedule-sync]')) return;
    const script = root.document?.createElement("script");
    if (!script) return;
    script.src = "./js/koshien-schedule-sync.js?v=20260808-1";
    script.dataset.yosoKoshienScheduleSync = "true";
    script.defer = true;
    root.document.head?.appendChild(script);
  }

  function installBrowserExtensions() {
    install();
    loadHomeDashboard();
    loadKoshienScheduleSync();
  }

  if (!root || typeof root.addEventListener !== "function") return;
  if (root.document?.readyState === "complete") root.setTimeout(installBrowserExtensions, 0);
  else root.addEventListener("load", installBrowserExtensions, { once: true });
})(typeof globalThis !== "undefined" ? globalThis : this);