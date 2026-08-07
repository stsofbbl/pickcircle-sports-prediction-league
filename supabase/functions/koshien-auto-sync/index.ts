import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { parseJhbfResultsHtml, parseJhbfStartRoundsHtml } from "../_shared/jhbf-parser.mjs";
import { attachStartsAt, parseJhbfScheduleHtml } from "../_shared/jhbf-schedule-parser.mjs";
import {
  buildCanonicalResultRows,
  dueResultDates,
  jstDateKey,
  jstMinutesOfDay,
  pendingDueMatches,
  scheduleDecision,
} from "../_shared/koshien-auto-sync-core.mjs";

const ALLOWED_HOSTS = new Set(["jhbf.or.jp", "www.jhbf.or.jp"]);
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 2;
const RESULT_RETRY_MINUTES = 10;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function eventYear(event: Record<string, unknown>): number {
  const season = Number(event?.season);
  if (Number.isInteger(season) && season >= 2020 && season <= 2035) return season;
  const named = Number((String(event?.name || "").match(/20\d{2}/) || [])[0]);
  return Number.isInteger(named) ? named : 2026;
}

function assertAllowedUrl(url: URL, year: number, kind: "tournament" | "schedule" | "results"): void {
  const path = kind === "tournament"
    ? new RegExp(`^/sensyuken/${year}/tournament/$`)
    : kind === "schedule"
      ? new RegExp(`^/sensyuken/${year}/schedule/$`)
      : new RegExp(`^/sensyuken/${year}/schedule/schedule_[0-9]{8}\\.html$`);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password || url.port
    || url.search || url.hash || !path.test(url.pathname)) {
    throw new Error("JHBF source URL was rejected by the allowlist");
  }
}

async function fetchAllowedHtml(initialUrl: URL, year: number, kind: "tournament" | "schedule" | "results") {
  let current = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    assertAllowedUrl(current, year, kind);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "Accept": "text/html,application/xhtml+xml",
          "User-Agent": "YOSO-Koshien-AutoSync/1.0 (+private prediction league; conditional low-frequency fetch)",
        },
      });
    } finally {
      clearTimeout(timeout);
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === MAX_REDIRECTS) throw new Error("JHBF redirect could not be followed safely");
      current = new URL(location, current);
      continue;
    }
    if (response.status === 404 && kind === "results") return { status: 404, url: current.toString(), html: "" };
    if (!response.ok) throw new Error(`JHBF returned HTTP ${response.status}`);
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("text/html")) throw new Error("JHBF response was not HTML");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > 2_000_000) throw new Error("JHBF response exceeded the size limit");
    const charset = /charset\s*=\s*([^;\s]+)/i.exec(contentType)?.[1]?.replace(/["']/g, "").toLowerCase() || "utf-8";
    let html: string;
    try {
      html = new TextDecoder(charset).decode(bytes);
    } catch {
      html = new TextDecoder("utf-8").decode(bytes);
    }
    return { status: response.status, url: current.toString(), html };
  }
  throw new Error("JHBF redirect limit exceeded");
}

async function tokenMatches(presented: string, expected: string): Promise<boolean> {
  if (!presented || !expected) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function loadState(supabase: ReturnType<typeof createClient>, eventId: string) {
  const { data, error } = await supabase
    .from("koshien_automation_state")
    .select("*")
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw error;
  return data || { event_id: eventId };
}

async function saveState(supabase: ReturnType<typeof createClient>, eventId: string, patch: Record<string, unknown>) {
  const { error } = await supabase
    .from("koshien_automation_state")
    .upsert({ event_id: eventId, ...patch, updated_at: new Date().toISOString() }, { onConflict: "event_id" });
  if (error) throw error;
}

async function loadMatches(supabase: ReturnType<typeof createClient>, eventId: string) {
  const { data, error } = await supabase
    .from("matches")
    .select("id,event_id,round_key,match_no,team1_id,team2_id,team1_score,team2_score,winner_team_id,loser_team_id,status,starts_at,metadata")
    .eq("event_id", eventId)
    .order("round_key")
    .order("match_no");
  if (error) throw error;
  return data || [];
}

async function syncSchedule(supabase: ReturnType<typeof createClient>, event: Record<string, unknown>, reason: string) {
  const eventId = String(event.id || "");
  const year = eventYear(event);
  const tournamentUrl = new URL(`https://www.jhbf.or.jp/sensyuken/${year}/tournament/`);
  const scheduleUrl = new URL(`https://www.jhbf.or.jp/sensyuken/${year}/schedule/`);
  const [tournamentFetched, scheduleFetched] = await Promise.all([
    fetchAllowedHtml(tournamentUrl, year, "tournament"),
    fetchAllowedHtml(scheduleUrl, year, "schedule"),
  ]);
  const fetchedAt = new Date().toISOString();
  const tournament = parseJhbfStartRoundsHtml(tournamentFetched.html, {
    sourceUrl: tournamentFetched.url,
    fetchedAt,
    competitionType: "summer",
    year,
  });
  const schedule = parseJhbfScheduleHtml(scheduleFetched.html, { year });
  const attachedR1 = attachStartsAt(tournament.matches || [], schedule.rows || []);
  const attachedR2 = attachStartsAt(tournament.round2Matches || [], schedule.rows || []);
  const rows = [...attachedR1.rows, ...attachedR2.rows].map((match) => ({
    round_key: String(match.roundKey || ""),
    match_no: Number(match.matchNo),
    starts_at: String(match.startsAt || ""),
    tournament_day_no: Number(match.tournamentDayNo || 0),
    daily_match_no: Number(match.dailyMatchNo || 0),
  }));
  const warnings = [
    ...(tournament.warnings || []),
    ...(schedule.warnings || []),
    ...attachedR1.warnings,
    ...attachedR2.warnings,
  ];
  if (rows.length !== 33 || rows.some((row) => !row.starts_at || !row.tournament_day_no || !row.daily_match_no)) {
    throw new Error(`official schedule validation failed (${rows.filter((row) => row.starts_at).length}/33): ${warnings.join(",")}`);
  }
  const { data, error } = await supabase.rpc("auto_sync_koshien_official_schedule", {
    p_event_id: eventId,
    p_rows: rows,
    p_source_url: scheduleFetched.url,
    p_fetched_at: fetchedAt,
  });
  if (error) throw error;
  return { reason, saved: data, warnings };
}

function compactDate(dateKey: string): string {
  return dateKey.replaceAll("-", "");
}

async function fetchCompletedResultsForDate(year: number, dateKey: string) {
  const url = new URL(`https://www.jhbf.or.jp/sensyuken/${year}/schedule/schedule_${compactDate(dateKey)}.html`);
  const fetched = await fetchAllowedHtml(url, year, "results");
  if (fetched.status === 404) return { rows: [], warnings: [`page_not_found:${dateKey}`] };
  const fetchedAt = new Date().toISOString();
  const parsed = parseJhbfResultsHtml(fetched.html, {
    sourceUrl: fetched.url,
    fetchedAt,
    competitionType: "summer",
    year,
    matchDate: dateKey,
  });
  return { rows: parsed.rows || [], warnings: parsed.warnings || [] };
}

async function syncDueResults(supabase: ReturnType<typeof createClient>, event: Record<string, unknown>, matches: Record<string, unknown>[], now: Date) {
  const eventId = String(event.id || "");
  const year = eventYear(event);
  const due = pendingDueMatches(matches, now);
  if (!due.length) return { attempted: false, changed: 0, conflicts: [] };
  const dates = dueResultDates(matches, now);
  const officialRows: Record<string, unknown>[] = [];
  const warnings: string[] = [];
  for (const dateKey of dates) {
    const fetched = await fetchCompletedResultsForDate(year, dateKey);
    officialRows.push(...fetched.rows);
    warnings.push(...fetched.warnings.map((warning: string) => `${dateKey}:${warning}`));
  }

  const [{ data: teams, error: teamsError }, { data: aliases, error: aliasesError }, { data: imports, error: importsError }] = await Promise.all([
    supabase.from("teams").select("id,name").eq("event_id", eventId),
    supabase.from("external_team_aliases").select("external_name,normalized_external_name,team_id").eq("event_id", eventId).eq("source", "jhbf"),
    supabase.from("external_match_imports").select("external_key,status,normalized_payload,imported_match_id").eq("event_id", eventId).eq("source", "jhbf"),
  ]);
  if (teamsError) throw teamsError;
  if (aliasesError) throw aliasesError;
  if (importsError) throw importsError;

  const dueIds = new Set(due.map((match) => String(match.id || "")));
  const preview = buildCanonicalResultRows(officialRows, {
    teams: teams || [],
    aliases: aliases || [],
    matches,
    imports: imports || [],
  }, dueIds);
  if (!preview.ready.length) {
    return { attempted: true, changed: 0, conflicts: preview.conflicts, skipped: preview.skipped, warnings };
  }

  const { data, error } = await supabase.rpc("auto_apply_koshien_official_results", {
    p_event_id: eventId,
    p_rows: preview.ready,
  });
  if (error) throw error;
  return {
    attempted: true,
    changed: Number(data?.changed || 0),
    blocked: Number(data?.blocked || 0),
    conflicts: preview.conflicts,
    skipped: preview.skipped,
    warnings,
  };
}

function resultRetryReady(state: Record<string, unknown>, now: Date): boolean {
  const last = state?.last_result_attempt_at ? new Date(String(state.last_result_attempt_at)) : null;
  return !last || Number.isNaN(last.getTime()) || now.getTime() - last.getTime() >= RESULT_RETRY_MINUTES * 60 * 1000;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "function_configuration_error" }, 500);
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const presented = req.headers.get("x-yoso-automation-token") || "";
  const { data: secretRow, error: secretError } = await supabase
    .from("koshien_automation_secret")
    .select("token")
    .eq("id", 1)
    .maybeSingle();
  if (secretError || !await tokenMatches(presented, String(secretRow?.token || ""))) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("id,name,season,status,preset_type,archived_at")
    .eq("preset_type", "koshien")
    .is("archived_at", null);
  if (eventsError) return jsonResponse({ error: "event_load_failed", message: eventsError.message }, 500);

  const now = new Date();
  const summaries: Record<string, unknown>[] = [];
  for (const event of events || []) {
    const eventId = String(event.id || "");
    let state = await loadState(supabase, eventId);
    let matches = await loadMatches(supabase, eventId);
    if (!matches.length) {
      summaries.push({ eventId, skipped: "no_matches" });
      continue;
    }

    let scheduleSummary: Record<string, unknown> | null = null;
    let resultSummary: Record<string, unknown> | null = null;
    try {
      const decision = scheduleDecision(matches, state, now);
      if (decision.due) {
        await saveState(supabase, eventId, {
          last_schedule_attempt_at: now.toISOString(),
          last_schedule_reason: decision.reason,
          last_action: `schedule:${decision.reason}`,
        });
        scheduleSummary = await syncSchedule(supabase, event, decision.reason);
        matches = await loadMatches(supabase, eventId);
        const today = jstDateKey(now);
        const todayMatches = matches.filter((match) => match.starts_at && jstDateKey(match.starts_at) === today);
        const patch: Record<string, unknown> = {
          last_schedule_success_at: new Date().toISOString(),
          last_schedule_reason: decision.reason,
          last_error: null,
          last_action: `schedule_ok:${decision.reason}`,
        };
        if (decision.reason === "matchday_morning" || (decision.reason === "missing_schedule" && todayMatches.length && jstMinutesOfDay(now) >= 5 * 60)) {
          patch.schedule_morning_date = today;
        }
        if (decision.reason === "pregame_check") patch.schedule_pregame_date = today;
        await saveState(supabase, eventId, patch);
        state = await loadState(supabase, eventId);
      }

      if (pendingDueMatches(matches, now).length && resultRetryReady(state, now)) {
        await saveState(supabase, eventId, {
          last_result_attempt_at: now.toISOString(),
          last_action: "results:due",
        });
        resultSummary = await syncDueResults(supabase, event, matches, now);
        const resultPatch: Record<string, unknown> = {
          last_error: resultSummary.conflicts?.length
            ? `official result conflicts: ${resultSummary.conflicts.map((item: Record<string, unknown>) => item.reason).join(",")}`
            : null,
          last_action: Number(resultSummary.changed || 0) > 0 ? "results_applied" : "results_checked",
        };
        if (Number(resultSummary.changed || 0) > 0) resultPatch.last_result_success_at = new Date().toISOString();
        await saveState(supabase, eventId, resultPatch);
      }
      summaries.push({ eventId, schedule: scheduleSummary, results: resultSummary });
    } catch (error) {
      const message = errorMessage(error).slice(0, 1000);
      console.error("Koshien auto sync failed", eventId, message);
      await saveState(supabase, eventId, { last_error: message, last_action: "error" });
      summaries.push({ eventId, error: message });
    }
  }

  return jsonResponse({ ok: true, checkedAt: now.toISOString(), events: summaries });
});
