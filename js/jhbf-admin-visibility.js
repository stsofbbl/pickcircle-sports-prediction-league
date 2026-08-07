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

  function loadHomeDashboard() {
    if (root.YosoHomeDashboard || root.document?.querySelector('script[data-yoso-home-dashboard]')) return;
    const script = root.document?.createElement("script");
    if (!script) return;
    script.src = "./js/home-dashboard.js?v=20260807-1";
    script.dataset.yosoHomeDashboard = "true";
    script.defer = true;
    root.document.head?.appendChild(script);
  }

  function installBrowserExtensions() {
    install();
    loadHomeDashboard();
  }

  if (!root || typeof root.addEventListener !== "function") return;
  if (root.document?.readyState === "complete") root.setTimeout(installBrowserExtensions, 0);
  else root.addEventListener("load", installBrowserExtensions, { once: true });
})(typeof globalThis !== "undefined" ? globalThis : this);
