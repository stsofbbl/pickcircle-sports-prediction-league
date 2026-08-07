import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.95.0";
import { parseJhbfRepresentativeTeamsHtml, parseJhbfResultsHtml, parseJhbfStartRoundsHtml } from "../_shared/jhbf-parser.mjs";

const CORS_HEADERS = Object.freeze({
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
});

const SOURCE = "jhbf";
const ALLOWED_HOSTS = new Set(["jhbf.or.jp", "www.jhbf.or.jp"]);
const MAX_REDIRECTS = 2;
const FETCH_TIMEOUT_MS = 12_000;

interface FetchRequest {
  kind: "results" | "representatives" | "start_rounds";
  eventId: string;
  competitionType: "summer" | "senbatsu";
  year: number;
  baseDate?: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "unknown error");
}

function parseRequest(value: unknown): FetchRequest {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const eventId = String(body.eventId || "").trim();
  const kind = body.kind === "representatives"
    ? "representatives"
    : body.kind === "start_rounds" ? "start_rounds" : "results";
  const competitionType = body.competitionType === "senbatsu" ? "senbatsu" : body.competitionType === "summer" ? "summer" : "";
  const year = Number(body.year);
  const baseDate = String(body.baseDate || "").trim();
  if (!eventId) throw new Error("eventId is required");
  if (!competitionType) throw new Error("competitionType must be summer or senbatsu");
  if (!Number.isInteger(year) || year < 2020 || year > 2035) throw new Error("year must be between 2020 and 2035");
  if (kind === "results") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(baseDate) || Number.isNaN(Date.parse(`${baseDate}T00:00:00+09:00`))) {
      throw new Error("baseDate must be YYYY-MM-DD");
    }
    if (Number(baseDate.slice(0, 4)) !== year) throw new Error("baseDate year must match year");
  }
  if (["representatives", "start_rounds"].includes(kind) && competitionType !== "summer") {
    throw new Error(`${kind} is only supported for summer`);
  }
  return { kind, eventId, competitionType, year, baseDate: kind === "results" ? baseDate : undefined };
}

function dateInJapan(value: string, offsetDays: number): string {
  const date = new Date(`${value}T00:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

function sourceUrlFor(request: FetchRequest, date: string): URL {
  const compactDate = date.replaceAll("-", "");
  const root = request.competitionType === "summer" ? "sensyuken" : "senbatsu";
  return new URL(`https://www.jhbf.or.jp/${root}/${request.year}/schedule/schedule_${compactDate}.html`);
}

function representativeSourceUrlFor(request: FetchRequest): URL {
  return new URL(`https://www.jhbf.or.jp/sensyuken/${request.year}/team/`);
}

function startRoundsSourceUrlFor(request: FetchRequest): URL {
  return new URL(`https://www.jhbf.or.jp/sensyuken/${request.year}/tournament/`);
}

function assertAllowedJhbfUrl(url: URL, request: FetchRequest): void {
  const expectedRoot = request.competitionType === "summer" ? "sensyuken" : "senbatsu";
  const expectedPath = request.kind === "representatives"
    ? new RegExp(`^/${expectedRoot}/${request.year}/team/?$`)
    : request.kind === "start_rounds"
      ? new RegExp(`^/${expectedRoot}/${request.year}/tournament/?$`)
      : new RegExp(`^/${expectedRoot}/${request.year}/schedule/schedule_[0-9]{8}\\.html$`);
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname) || url.username || url.password || url.port || url.search || url.hash
    || !expectedPath.test(url.pathname)) {
    throw new Error("JHBF source URL was rejected by the allowlist");
  }
}

async function fetchAllowedHtml(initialUrl: URL, request: FetchRequest): Promise<{ status: number; url: string; html: string }> {
  let current = initialUrl;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    assertAllowedJhbfUrl(current, request);
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
          "User-Agent": "YOSO-JHBF-Result-Importer/1.0 (+private prediction league; low-frequency admin fetch)",
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
    if (response.status === 404) return { status: 404, url: current.toString(), html: "" };
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
    return { status: response.status, url: current.toString(), html };
  }
  throw new Error("JHBF redirect limit exceeded");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const authorization = req.headers.get("Authorization") || "";
  if (!authorization.toLowerCase().startsWith("bearer ")) return jsonResponse({ error: "authentication_required" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !anonKey) return jsonResponse({ error: "function_configuration_error" }, 500);

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let request: FetchRequest;
  try {
    request = parseRequest(await req.json());
  } catch (error) {
    return jsonResponse({ error: "invalid_request", message: errorMessage(error) }, 400);
  }

  if (request.kind === "representatives") {
    try {
      const requestedUrl = representativeSourceUrlFor(request);
      assertAllowedJhbfUrl(requestedUrl, request);
      const fetched = await fetchAllowedHtml(requestedUrl, request);
      const parsed = parseJhbfRepresentativeTeamsHtml(fetched.html, {
        sourceUrl: fetched.url,
        fetchedAt: new Date().toISOString(),
        competitionType: request.competitionType,
        year: request.year,
      });
      return jsonResponse({ source: SOURCE, rows: parsed.rows, warnings: parsed.warnings, sourceUrls: [fetched.url], fetchedAt: new Date().toISOString() });
    } catch (error) {
      console.error("JHBF representative fetch failed", errorMessage(error));
      return jsonResponse({ error: "jhbf_fetch_failed", message: "日本高野連公式の代表校一覧を取得できませんでした。既存データは変更していません。" }, 502);
    }
  }

  if (request.kind === "start_rounds") {
    const { error: adminError } = await supabase.rpc("get_koshien_external_import_context", {
      p_event_id: request.eventId,
    });
    if (adminError) {
      return jsonResponse({ error: "fetch_not_allowed", message: "開始ラウンド候補の取得には管理者権限が必要です。" }, 403);
    }
    try {
      const requestedUrl = startRoundsSourceUrlFor(request);
      assertAllowedJhbfUrl(requestedUrl, request);
      const fetched = await fetchAllowedHtml(requestedUrl, request);
      const fetchedAt = new Date().toISOString();
      const parsed = parseJhbfStartRoundsHtml(fetched.html, {
        sourceUrl: fetched.url,
        fetchedAt,
        competitionType: request.competitionType,
        year: request.year,
      });
      return jsonResponse({ source: SOURCE, rows: parsed.rows, matches: parsed.matches, round2Matches: parsed.round2Matches, warnings: parsed.warnings, sourceUrls: [fetched.url], fetchedAt });
    } catch (error) {
      console.error("JHBF start-round fetch failed", errorMessage(error));
      return jsonResponse({ error: "jhbf_fetch_failed", message: "日本高野連公式の組み合わせ表を取得できませんでした。既存データは変更していません。" }, 502);
    }
  }

  const { data: fetchState, error: startError } = await supabase.rpc("request_koshien_external_fetch", {
    p_event_id: request.eventId,
    p_source: SOURCE,
  });
  if (startError) {
    const cooldown = /cooldown/i.test(startError.message || "");
    return jsonResponse({ error: cooldown ? "fetch_cooldown" : "fetch_not_allowed", message: startError.message }, cooldown ? 429 : 403);
  }

  const fetchId = String(fetchState?.fetchId || fetchState?.fetch_id || "");
  const dates = [dateInJapan(request.baseDate || "", 0), dateInJapan(request.baseDate || "", -1)];
  const sourceUrls: string[] = [];
  const rows: Record<string, unknown>[] = [];
  const warnings: string[] = [];

  try {
    for (const matchDate of dates) {
      const requestedUrl = sourceUrlFor(request, matchDate);
      assertAllowedJhbfUrl(requestedUrl, request);
      const fetched = await fetchAllowedHtml(requestedUrl, request);
      sourceUrls.push(fetched.url);
      if (fetched.status === 404) {
        warnings.push(`page_not_found:${matchDate}`);
        continue;
      }
      const parsed = parseJhbfResultsHtml(fetched.html, {
        sourceUrl: fetched.url,
        fetchedAt: new Date().toISOString(),
        competitionType: request.competitionType,
        year: request.year,
        matchDate,
      });
      rows.push(...parsed.rows);
      warnings.push(...parsed.warnings.map((warning: string) => `${matchDate}:${warning}`));
    }
    if (fetchId) {
      const { error: completeError } = await supabase.rpc("complete_koshien_external_fetch", {
        p_fetch_id: fetchId,
        p_status: "completed",
        p_source_urls: sourceUrls,
        p_row_count: rows.length,
        p_error_code: null,
      });
      if (completeError) throw completeError;
    }
    return jsonResponse({ source: SOURCE, rows, warnings, sourceUrls, fetchedAt: new Date().toISOString() });
  } catch (error) {
    if (fetchId) {
      await supabase.rpc("complete_koshien_external_fetch", {
        p_fetch_id: fetchId,
        p_status: "failed",
        p_source_urls: sourceUrls,
        p_row_count: 0,
        p_error_code: error instanceof DOMException && error.name === "AbortError" ? "fetch_timeout" : "fetch_failed",
      });
    }
    console.error("JHBF result fetch failed", errorMessage(error));
    return jsonResponse({ error: "jhbf_fetch_failed", message: "日本高野連公式の結果を取得できませんでした。既存データは変更していません。" }, 502);
  }
});
