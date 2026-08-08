(function () {
  "use strict";

  const INSTALLED_FLAG = "__yosoKoshienStartTimeBridgeInstalled";
  const RETRY_LIMIT = 200;
  const RETRY_DELAY_MS = 25;

  function matchKey(match) {
    const round = String(match?.round || match?.round_key || "");
    const matchNo = Number(match?.match_no ?? match?.matchNo);
    return round && Number.isInteger(matchNo) && matchNo > 0 ? `${round}:${matchNo}` : "";
  }

  function matchStartTime(match, fallback = "") {
    return match?.starts_at
      || match?.startsAt
      || match?.metadata?.starts_at
      || match?.metadata?.scheduled_at
      || fallback
      || "";
  }

  function preserveStartTime(match, fallback = "") {
    const startsAt = matchStartTime(match, fallback);
    if (!startsAt) return match;
    return {
      ...match,
      starts_at: startsAt,
      metadata: {
        ...(match?.metadata && typeof match.metadata === "object" ? match.metadata : {}),
        starts_at: startsAt,
      },
    };
  }

  async function enrichSnapshotStartsAt(snapshot) {
    const matches = snapshot?.results?.payload?.matches;
    const eventId = String(snapshot?.event?.id || "").trim();
    if (!snapshot?.ok || !eventId || !Array.isArray(matches) || !matches.length) return snapshot;

    try {
      const supabase = await window.YosoSupabase?.client?.();
      if (!supabase) return snapshot;
      const { data, error } = await supabase
        .from("matches")
        .select("round_key, match_no, starts_at")
        .eq("event_id", eventId);
      if (error) throw error;

      const startsAtByMatch = new Map(
        (Array.isArray(data) ? data : [])
          .filter((row) => row?.starts_at)
          .map((row) => [`${String(row.round_key || "")}:${Number(row.match_no)}`, row.starts_at]),
      );

      snapshot.results = {
        ...snapshot.results,
        payload: {
          ...snapshot.results.payload,
          matches: matches.map((match) => preserveStartTime(match, startsAtByMatch.get(matchKey(match)))),
        },
      };
    } catch (error) {
      console.warn("Koshien starts_at enrichment failed", error);
    }
    return snapshot;
  }

  function installBridge() {
    if (window[INSTALLED_FLAG]) return true;
    const koshien = window.YosoDataService?.koshien;
    if (!koshien || typeof koshien.loadSnapshot !== "function" || !window.YosoSupabase?.client) return false;

    const originalLoadSnapshot = koshien.loadSnapshot.bind(koshien);
    koshien.loadSnapshot = async function loadSnapshotWithStartsAt(options = {}) {
      const snapshot = await originalLoadSnapshot(options);
      return enrichSnapshotStartsAt(snapshot);
    };
    window[INSTALLED_FLAG] = true;

    if (typeof window.loadKoshienOnlineState === "function") {
      Promise.resolve(window.loadKoshienOnlineState({ force: true }))
        .catch((error) => console.warn("Koshien starts_at refresh failed", error));
    }
    return true;
  }

  let attempts = 0;
  const retry = () => {
    if (installBridge()) return;
    attempts += 1;
    if (attempts < RETRY_LIMIT) window.setTimeout(retry, RETRY_DELAY_MS);
  };
  retry();
})();
