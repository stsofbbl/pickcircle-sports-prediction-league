import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { authorizeJhbfEventFetch } from "../supabase/functions/_shared/jhbf-event-fetch-guard.mjs";

function backend({ event = { id: "event-a", league_id: "league-a", season: "2027" }, eventError = null, admin = true, adminError = null, throws = false } = {}) {
  const calls = [];
  const query = {
    select(columns) { calls.push(["select", columns]); return this; },
    eq(column, value) { calls.push(["eq", column, value]); return this; },
    async maybeSingle() { if (throws) throw new Error("offline"); return { data: event, error: eventError }; },
  };
  return { calls, from(table) { calls.push(["from", table]); return query; }, async rpc(name, args) { calls.push(["rpc", name, args]); return { data: admin, error: adminError }; } };
}
const request = { eventId: "event-a", year: 2027, competitionType: "summer" };

for (const kind of ["results", "representatives", "start_rounds"]) {
  test(kind + ": authorizes exact event season and rejects another year", async () => {
    const db = backend();
    assert.deepEqual(await authorizeJhbfEventFetch(db, { ...request, kind }), { ok: true });
    assert.deepEqual(db.calls, [["from", "events"], ["select", "id,league_id,season"], ["eq", "id", "event-a"], ["eq", "preset_type", "koshien"], ["rpc", "is_league_admin", { p_league_id: "league-a" }]]);
    assert.equal((await authorizeJhbfEventFetch(backend(), { ...request, kind, year: 2026 })).error, "event_season_mismatch");
  });
}

test("existing 2026 summer season remains valid", async () => {
  const db = backend({ event: { id: "event-a", league_id: "league-a", season: "2026" } });
  assert.deepEqual(await authorizeJhbfEventFetch(db, { ...request, year: 2026 }), { ok: true });
});

test("rejects another competition and malformed persisted season", async () => {
  assert.equal((await authorizeJhbfEventFetch(backend(), { ...request, competitionType: "senbatsu" })).status, 400);
  assert.equal((await authorizeJhbfEventFetch(backend({ event: { id: "event-a", league_id: "league-a", season: "2027abc" } }), request)).status, 400);
});

test("preserves legacy events without persisted season only for admins", async () => {
  const event = { id: "event-a", league_id: "league-a", season: null };
  assert.deepEqual(await authorizeJhbfEventFetch(backend({ event }), { ...request, competitionType: "senbatsu", year: 2026 }), { ok: true });
  assert.equal((await authorizeJhbfEventFetch(backend({ event, admin: false }), request)).status, 403);
});

test("missing or other-club event is denied before admin lookup", async () => {
  for (const event of [null, { id: "event-b", league_id: "league-b", season: "2027" }]) {
    const db = backend({ event });
    assert.equal((await authorizeJhbfEventFetch(db, request)).status, 403);
    assert.equal(db.calls.some(([name]) => name === "rpc"), false);
  }
});

test("non-admin, non-boolean RPC response and RPC errors are denied", async () => {
  for (const options of [{ admin: false }, { admin: "true" }, { adminError: { message: "denied" } }, { eventError: { message: "denied" } }]) {
    assert.equal((await authorizeJhbfEventFetch(backend(options), request)).status, 403);
  }
});

test("connection failures fail closed without revealing internals", async () => {
  const result = await authorizeJhbfEventFetch(backend({ throws: true }), request);
  assert.equal(result.status, 503);
  assert.doesNotMatch(result.message, /offline/);
});

test("Edge handler invokes guard and returns early before all three fetch paths", () => {
  const source = readFileSync(new URL("../supabase/functions/jhbf-results/index.ts", import.meta.url), "utf8");
  const start = source.indexOf("Deno.serve(");
  const call = source.indexOf("const guard = await authorizeJhbfEventFetch(supabase, request);", start);
  const reject = source.indexOf("if (!guard.ok) return jsonResponse(", call);
  assert.ok(start >= 0 && call > start && reject > call);
  for (const marker of ['if (request.kind === "representatives")', 'if (request.kind === "start_rounds")', 'supabase.rpc("request_koshien_external_fetch"']) {
    assert.ok(source.indexOf(marker, start) > reject, marker);
  }
});
