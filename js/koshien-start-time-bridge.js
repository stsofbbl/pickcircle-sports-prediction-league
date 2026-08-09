(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.YosoKoshienStartTimeBridge = api;

  if (!root || typeof root.addEventListener !== "function") return;

  let installAttempts = 0;

  function tryInstall() {
    if (api.installBrowser(root)) return;
    if (installAttempts >= 30) return;
    installAttempts += 1;
    root.setTimeout(tryInstall, 100);
  }

  if (root.document?.readyState === "complete") root.setTimeout(tryInstall, 0);
  else root.addEventListener("load", tryInstall, { once: true });
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const INSTALLED_FLAG = "__yosoKoshienStartTimeBridgeInstalled";

  function startTimeByMatchKey(rows = []) {
    return new Map((Array.isArray(rows) ? rows : [])
      .filter((row) => row?.starts_at)
      .map((row) => [`${String(row.round_key || "")}:${Number(row.match_no)}`, String(row.starts_at)]));
  }

  function mergeStartTimesIntoSnapshot(snapshot, rows = []) {
    const matches = snapshot?.results?.payload?.matches;
    if (!Array.isArray(matches) || !matches.length) return snapshot;

    const startTimes = startTimeByMatchKey(rows);
    if (!startTimes.size) return snapshot;

    matches.forEach((match) => {
      const key = `${String(match?.round || match?.round_key || "")}:${Number(match?.match_no)}`;
      const startsAt = startTimes.get(key);
      if (!startsAt) return;
      match.metadata = {
        ...(match.metadata && typeof match.metadata === "object" ? match.metadata : {}),
        starts_at: startsAt,
      };
    });
    return snapshot;
  }

  function snapshotHasStartTimes(snapshot) {
    const matches = snapshot?.results?.payload?.matches;
    if (!Array.isArray(matches) || !matches.length) return false;
    return matches.some((match) => (
      match?.starts_at
      || match?.startsAt
      || match?.metadata?.starts_at
      || match?.metadata?.scheduled_at
    ));
  }

  async function enrichSnapshot(root, snapshot, args = {}) {
    if (!snapshot || snapshot.skipped || snapshotHasStartTimes(snapshot)) return snapshot;
    const eventId = String(args?.eventId || snapshot?.event?.id || snapshot?.eventId || "").trim();
    if (!eventId) return snapshot;

    try {
      const supabase = await root.YosoSupabase?.client?.();
      if (!supabase) return snapshot;
      const { data, error } = await supabase
        .from("matches")
        .select("round_key, match_no, starts_at")
        .eq("event_id", eventId);
      if (error || !Array.isArray(data)) return snapshot;
      return mergeStartTimesIntoSnapshot(snapshot, data);
    } catch (error) {
      console.warn("Koshien start time enrichment failed", error);
      return snapshot;
    }
  }

  function installBrowser(root) {
    if (!root || root[INSTALLED_FLAG]) return true;
    const service = root.YosoDataService?.koshien;
    if (!service || typeof service.loadSnapshot !== "function") return false;

    const originalLoadSnapshot = service.loadSnapshot.bind(service);
    service.loadSnapshot = async function loadSnapshotWithStartTimes(args = {}) {
      const snapshot = await originalLoadSnapshot(args);
      return enrichSnapshot(root, snapshot, args);
    };
    root[INSTALLED_FLAG] = true;

    root.setTimeout(() => {
      if (typeof root.loadKoshienOnlineState !== "function") return;
      const templateId = String(root.state?.event?.templateId || "");
      if (!templateId.includes("koshien")) return;
      Promise.resolve(root.loadKoshienOnlineState({ force: true })).catch((error) => {
        console.warn("Koshien start time refresh failed", error);
      });
    }, 0);
    return true;
  }

  return Object.freeze({
    installBrowser,
    mergeStartTimesIntoSnapshot,
    snapshotHasStartTimes,
    startTimeByMatchKey,
  });
});
