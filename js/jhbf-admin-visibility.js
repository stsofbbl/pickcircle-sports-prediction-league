(function (root) {
  "use strict";

  function install() {
    if (typeof bindActiveEventManagerInputs !== "function") return false;
    const originalBind = bindActiveEventManagerInputs;
    bindActiveEventManagerInputs = function bindActiveEventManagerInputsWithJhbfVisibility() {
      originalBind();
      const isAdmin = typeof canCurrentUserManageLeague === "function" && canCurrentUserManageLeague();
      if (!isAdmin) {
        document.querySelectorAll(".koshien-jhbf-import").forEach((panel) => panel.remove());
      }
    };
    if (typeof renderActiveEventManager === "function") renderActiveEventManager();
    return true;
  }

  if (!root || typeof root.addEventListener !== "function") return;
  if (root.document?.readyState === "complete") root.setTimeout(install, 0);
  else root.addEventListener("load", install, { once: true });
})(typeof globalThis !== "undefined" ? globalThis : this);
