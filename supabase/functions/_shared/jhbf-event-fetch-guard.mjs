const forbidden = () => ({ ok: /** @type {const} */ (false), status: 403, error: "fetch_not_allowed", message: "公式データ取得には対象大会の管理者権限が必要です。" });
const mismatch = () => ({ ok: /** @type {const} */ (false), status: 400, error: "event_season_mismatch", message: "公式データ取得の大会種別・年度が保存済み大会と一致しません。" });

export async function authorizeJhbfEventFetch(supabase, request) {
  try {
    const { data: event, error: eventError } = await supabase.from("events")
      .select("id,league_id,season")
      .eq("id", request.eventId)
      .eq("preset_type", "koshien")
      .maybeSingle();
    if (eventError || event?.id !== request.eventId || !event?.league_id) return forbidden();
    const { data: admin, error: adminError } = await supabase.rpc("is_league_admin", { p_league_id: event.league_id });
    if (adminError || admin !== true) return forbidden();

    // Preserve the legacy selector only for events with no persisted season.
    const season = String(event.season ?? "").trim();
    if (season && (!/^(202[0-9]|203[0-5])$/.test(season)
      || request.year !== Number(season) || request.competitionType !== "summer")) return mismatch();
    return { ok: /** @type {const} */ (true) };
  } catch {
    return { ok: /** @type {const} */ (false), status: 503, error: "fetch_authorization_failed", message: "大会の管理者権限を確認できませんでした。再試行してください。" };
  }
}
