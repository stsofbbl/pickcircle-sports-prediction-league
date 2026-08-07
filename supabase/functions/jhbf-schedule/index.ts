import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { attachStartsAt, parseJhbfScheduleHtml, parseJhbfTournamentScheduleSlots } from "../_shared/jhbf-schedule-parser.mjs";

const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});
const ALLOWED_HOSTS = new Set(["jhbf.or.jp", "www.jhbf.or.jp"]);
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 2;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function allowedPath(url: URL, year: number): boolean {
  return new RegExp(`^/sensyuken/${year}/(?:tournament/|schedule/)$`).test(url.pathname);
}

function assertAllowedUrl(url: URL, year: number): void {
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password || url.port || url.search || url.hash || !allowedPath(url, year)) {
    throw new Error("JHBF source URL was rejected by the allowlist");
  }
}

async function fetchAllowedHtml(initialUrl: URL, year: number): Promise<{ url: string; html: string }> {
  let current = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    assertAllowedUrl(current, year);
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
          "User-Agent": "YOSO-JHBF-Schedule/1.0 (+private prediction league; low-frequency admin fetch)",
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
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok) throw new Error(`JHBF returned HTTP ${response.status}`);
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return jsonResponse({ error: "authentication_required" }, 401);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "invalid_request", message: "JSON body is required" }, 400);
  }
  const eventId = String(body.eventId || "").trim();
  const year = Number(body.year);
  if (!eventId || !Number.isInteger(year) || year < 2020 || year > 2035) {
    return jsonResponse({ error: "invalid_request", message: "eventId and valid year are required" }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !anonKey) return jsonResponse({ error: "function_configuration_error" }, 500);
  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: adminError } = await supabase.rpc("get_koshien_external_import_context", { p_event_id: eventId });
  if (adminError) return jsonResponse({ error: "fetch_not_allowed", message: "公式日程の取得には管理者権限が必要です。" }, 403);

  const tournamentUrl = new URL(`https://www.jhbf.or.jp/sensyuken/${year}/tournament/`);
  const scheduleUrl = new URL(`https://www.jhbf.or.jp/sensyuken/${year}/schedule/`);
  try {
    const [tournamentFetched, scheduleFetched] = await Promise.all([
      fetchAllowedHtml(tournamentUrl, year),
      fetchAllowedHtml(scheduleUrl, year),
    ]);
    const fetchedAt = new Date().toISOString();
    const tournament = parseJhbfTournamentScheduleSlots(tournamentFetched.html);
    const schedule = parseJhbfScheduleHtml(scheduleFetched.html, { year });
    const attached = attachStartsAt(tournament.matches || [], schedule.rows || []);
    const rows = attached.rows.map((match) => ({
      roundKey: String(match.roundKey || ""),
      matchNo: Number(match.matchNo),
      gameLabel: String(match.gameLabel || ""),
      startsAt: String(match.startsAt || ""),
      scheduledTime: String(match.scheduledTime || ""),
      tournamentDayNo: Number(match.tournamentDayNo || 0),
      dailyMatchNo: Number(match.dailyMatchNo || 0),
    }));
    const warnings = [
      ...(tournament.warnings || []),
      ...(schedule.warnings || []),
      ...attached.warnings,
    ];
    if (rows.length !== 33 || rows.some((row) => !row.startsAt)) {
      warnings.push(`scheduled_match_count:${rows.filter((row) => row.startsAt).length}/33`);
    }
    return jsonResponse({
      source: "jhbf",
      rows,
      warnings: [...new Set(warnings)],
      sourceUrls: [tournamentFetched.url, scheduleFetched.url],
      scheduleSourceUrl: scheduleFetched.url,
      fetchedAt,
    });
  } catch (error) {
    console.error("JHBF schedule fetch failed", errorMessage(error));
    return jsonResponse({ error: "jhbf_schedule_fetch_failed", message: "日本高野連公式の日程を取得できませんでした。既存データは変更していません。" }, 502);
  }
});
