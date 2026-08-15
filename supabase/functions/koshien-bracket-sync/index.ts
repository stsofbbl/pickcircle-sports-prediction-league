import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { parseJhbfScheduleHtml } from "../_shared/jhbf-schedule-parser.mjs";
import {
  buildLateScheduleRows,
  normalizeName,
  parseJhbfFinalSchedule,
  parseJhbfRedrawTeams,
  pendingRedrawRound,
} from "../_shared/koshien-bracket-sync-core.mjs";

const ALLOWED_HOSTS = new Set(["jhbf.or.jp", "www.jhbf.or.jp"]);
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 2;
type DbClient = any;
type DbRow = Record<string, any>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function eventYear(event: DbRow): number {
  const season = Number(event?.season);
  if (Number.isInteger(season) && season >= 2020 && season <= 2035) return season;
  const named = Number((String(event?.name || "").match(/20\d{2}/) || [])[0]);
  return Number.isInteger(named) ? named : 2026;
}

function assertAllowedUrl(url: URL, year: number, kind: "tournament" | "schedule"): void {
  const path = kind === "tournament"
    ? new RegExp(`^/sensyuken/${year}/tournament/$`)
    : new RegExp(`^/sensyuken/${year}/schedule/$`);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password || url.port
    || url.search || url.hash || !path.test(url.pathname)) {
    throw new Error("JHBF source URL was rejected by the allowlist");
  }
}

async function fetchAllowedHtml(initialUrl: URL, year: number, kind: "tournament" | "schedule") {
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
          "User-Agent": "YOSO-Koshien-BracketSync/1.0 (+private prediction league; low-frequency official fetch)",
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
    return { url: current.toString(), html };
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
  for (let index = 0; index < a.length; index += 1) diff |= a[index] ^ b[index];
  return diff === 0;
}

async function loadBracketData(supabase: DbClient, eventId: string) {
  const [{ data: matches, error: matchError }, { data: teams, error: teamError }, { data: aliases, error: aliasError }] = await Promise.all([
    supabase
      .from("matches")
      .select("id,event_id,round_key,match_no,team1_id,team2_id,winner_team_id,status,starts_at")
      .eq("event_id", eventId)
      .order("round_key")
      .order("match_no"),
    supabase.from("teams").select("id,name").eq("event_id", eventId),
    supabase
      .from("external_team_aliases")
      .select("external_name,normalized_external_name,team_id")
      .eq("event_id", eventId)
      .eq("source", "jhbf"),
  ]);
  if (matchError) throw matchError;
  if (teamError) throw teamError;
  if (aliasError) throw aliasError;
  return { matches: matches || [], teams: teams || [], aliases: aliases || [] };
}

function mapOfficialTeamNames(names: string[], teams: DbRow[], aliases: DbRow[]): string[] {
  const exact = new Map(teams.map((team) => [normalizeName(team.name), String(team.id || "")]));
  const alias = new Map(aliases.map((row) => [
    normalizeName(row.normalized_external_name || row.external_name),
    String(row.team_id || ""),
  ]));
  return names.map((name) => exact.get(normalizeName(name)) || alias.get(normalizeName(name)) || "");
}

function buildPartialRedrawRows(roundKey: string, cards: DbRow[], teams: DbRow[], aliases: DbRow[]) {
  const names = cards.flatMap((card) => [String(card.team1Name || ""), String(card.team2Name || "")]);
  const ids = mapOfficialTeamNames(names, teams, aliases);
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length) {
    throw new Error(`${roundKey} official draw contains an unmapped or duplicate team`);
  }
  return cards.map((card, index) => ({
    round_key: roundKey,
    match_no: Number(card.matchNo),
    team1_id: ids[index * 2],
    team2_id: ids[index * 2 + 1],
  }));
}

function hasLateScheduleGap(matches: DbRow[]): boolean {
  return matches.some((match) => ["R3", "QF", "SF", "F"].includes(String(match.round_key || "")) && !match.starts_at);
}

async function syncEvent(supabase: DbClient, event: DbRow) {
  const eventId = String(event.id || "");
  const year = eventYear(event);
  let data = await loadBracketData(supabase, eventId);
  const pendingRound = pendingRedrawRound(data.matches);
  const scheduleGap = hasLateScheduleGap(data.matches);
  if (!pendingRound && !scheduleGap) return { eventId, skipped: "late_bracket_is_current" };

  const tournamentUrl = new URL(`https://www.jhbf.or.jp/sensyuken/${year}/tournament/`);
  const scheduleUrl = new URL(`https://www.jhbf.or.jp/sensyuken/${year}/schedule/`);
  const [tournamentFetched, scheduleFetched] = await Promise.all([
    fetchAllowedHtml(tournamentUrl, year, "tournament"),
    fetchAllowedHtml(scheduleUrl, year, "schedule"),
  ]);
  const fetchedAt = new Date().toISOString();
  const summary: DbRow = { eventId, pendingRound: pendingRound || null, drawSaved: false, scheduleChanged: 0 };

  if (pendingRound) {
    const parsed = parseJhbfRedrawTeams(tournamentFetched.html);
    const cards = pendingRound === "QF" ? parsed.qfMatches : parsed.sfMatches;
    if (cards.length) {
      const rows = buildPartialRedrawRows(pendingRound, cards, data.teams, data.aliases);
      const { data: saved, error } = await supabase.rpc("register_koshien_official_redraw_slots", {
        p_event_id: eventId,
        p_round_key: pendingRound,
        p_matches: rows,
        p_source_url: tournamentFetched.url,
        p_fetched_at: fetchedAt,
      });
      if (error) throw error;
      summary.drawSaved = true;
      summary.draw = saved;
      summary.officialCardsFound = cards.length;
      data = await loadBracketData(supabase, eventId);
    } else {
      summary.drawWaiting = true;
    }
  }

  const parsedSchedule = parseJhbfScheduleHtml(scheduleFetched.html, { year });
  const finalSchedule = parseJhbfFinalSchedule(scheduleFetched.html, year);
  const officialScheduleRows = finalSchedule ? [...(parsedSchedule.rows || []), finalSchedule] : (parsedSchedule.rows || []);
  const scheduleRows = buildLateScheduleRows(officialScheduleRows, data.matches);
  if (scheduleRows.length) {
    const { data: saved, error } = await supabase.rpc("auto_sync_koshien_late_schedule", {
      p_event_id: eventId,
      p_rows: scheduleRows,
      p_source_url: scheduleFetched.url,
      p_fetched_at: fetchedAt,
    });
    if (error) throw error;
    summary.schedule = saved;
    summary.scheduleChanged = Number(saved?.changed || 0);
  }
  if (parsedSchedule.warnings?.length) summary.scheduleWarnings = parsedSchedule.warnings;
  return summary;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceRoleKey) return jsonResponse({ error: "function_configuration_error" }, 500);
  const supabase: DbClient = createClient(supabaseUrl, serviceRoleKey, {
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

  const summaries: DbRow[] = [];
  for (const event of Array.isArray(events) ? events : []) {
    try {
      summaries.push(await syncEvent(supabase, event));
    } catch (error) {
      summaries.push({ eventId: String(event?.id || ""), error: error instanceof Error ? error.message : String(error) });
    }
  }
  return jsonResponse({ ok: true, summaries });
});
