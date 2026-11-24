// Actual SDK -> HTTP -> PostgREST -> PostgreSQL. Locally signed synthetic JWTs;
// no Supabase Auth server, cloud credentials, production network or browser.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHmac, randomUUID } = require("node:crypto");
const base = process.env.YOSO_HTTP_URL;
const secret = process.env.YOSO_HTTP_SECRET;
if (base !== "http://127.0.0.1:39117" || !secret || !process.argv[2]) throw Error("Use disposable CI fixture only");
// The CDN UMD bundle exposes a browser global rather than CommonJS exports.
const sdkSource = fs.readFileSync(path.resolve(process.argv[2]), "utf8");
const sdkContext = vm.createContext({
  console, URL, URLSearchParams, fetch, Headers, Request, Response, AbortController,
  AbortSignal, TextEncoder, TextDecoder, setTimeout, clearTimeout, setInterval,
  clearInterval, crypto: globalThis.crypto, WebSocket: globalThis.WebSocket,
  atob, btoa, Blob, FormData, ArrayBuffer, Uint8Array,
});
sdkContext.self = sdkContext;
sdkContext.window = sdkContext;
vm.runInContext(sdkSource, sdkContext);
const createClient = sdkContext.supabase?.createClient;
assert.equal(typeof createClient, "function", "browser SDK global unavailable");
const repoRoot = path.join(__dirname, "..");
const leagueId = "00000000-0000-0000-0000-000000000010";
const owner = "00000000-0000-0000-0000-000000000001";
const member = "00000000-0000-0000-0000-000000000002";
const outsider = "00000000-0000-0000-0000-000000000003";
const b64 = x => Buffer.from(JSON.stringify(x)).toString("base64url");
function token(sub, options = {}) {
  const input = b64({ alg: "HS256", typ: "JWT" }) + "." + b64({
    sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now()/1000) + (options.expired ? -3600 : 300),
    user_metadata: { role: "owner" },
  });
  return input + "." + createHmac("sha256", options.forged ? "not-the-fixture-signing-key" : secret).update(input).digest("base64url");
}
const wire = [];
function sdkFor(uid, options) {
  const jwt = token(uid, options);
  return createClient(base, "fixture-public-key", {
    accessToken: async () => jwt,
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input.url || input.href);
      assert.equal(url.origin, base, "non-local request");
      assert.ok(url.pathname.startsWith("/rest/v1/"), "unexpected SDK endpoint");
      url.pathname = url.pathname.slice("/rest/v1".length);
      wire.push({ method: init?.method || "GET", path: url.pathname });
      return fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
    } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
function service(uid, options) {
  const client = sdkFor(uid, options);
  const window = { YosoSupabase: {
    hasConfig: () => true, config: () => ({ inviteCode: "fixture-http", activeLeagueId: leagueId, sync: { autoSaveKoshien: true } }),
    client: () => client, sessionUser: async () => ({ id: uid }),
  } };
  const context = vm.createContext({ window, console, localStorage: {} });
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "js/koshien-results.js"), "utf8"), context);
  window.YosoKoshienResults = context.YosoKoshienResults;
  vm.runInContext(fs.readFileSync(path.join(repoRoot, "js/data-service.js"), "utf8"), context);
  return { client, service: window.YosoDataService.koshien };
}
function ok(response) {
  if (response.error) throw Error(JSON.stringify(response.error));
  return response.data;
}
function denied(response) {
  assert.ok(response.error, "expected request to be rejected");
  assert.equal(response.error.code, "42501");
}
async function main() {
  const a = service(owner), b = service(owner), m = service(member), o = service(outsider);
  const eventId = randomUUID();
  const args = { eventId, leagueId, name: "HTTP fixture 2027", season: 2027, deadline: new Date(Date.now()+86400000).toISOString() };
  const pair = await Promise.all([a.service.createDraft(args), b.service.createDraft(args)]);
  assert.equal(pair.filter(x => x.recovered).length, 1, "exactly one insert and one recovery");
  assert.ok(pair.every(x => x.ok && x.eventId === eventId));
  const catalog = await m.service.listEvents({leagueId});
  assert.equal(catalog.events.filter(x => x.id === eventId).length, 1);
  let snapshot = await b.service.loadSnapshot({eventId,strictEventId:true});
  assert.equal(snapshot.event.id,eventId);
  assert.equal(snapshot.event.status,"draft");
  assert.equal(snapshot.teams.length,0);
  assert.equal((await b.service.loadSnapshot({eventId:randomUUID(),strictEventId:true})).skipped,true);
  await assert.rejects(m.service.createDraft({...args,eventId:randomUUID()}));
  denied(await m.client.from("events").insert({id:randomUUID(),league_id:leagueId,preset_type:"koshien",status:"draft",created_by:member}));
  assert.deepEqual(ok(await o.client.from("events").select("id").eq("id",eventId)),[]);
  denied(await o.client.rpc("koshien_admin_result_revision",{p_event_id:eventId}));
  for (const opts of [{forged:true},{expired:true}]) {
    const bad=sdkFor(owner,opts);
    const response=await bad.from("events").select("id").eq("id",eventId);
    assert.equal(response.status,401,"invalid JWT should be rejected by HTTP server");
  }
  console.log("PASS: actual HTTP concurrent INSERT/recovery, strict snapshot, outsider/member denial, signed JWT rejection");
  const districts = ["北北海道","南北海道","青森","岩手","宮城","秋田","山形","福島","茨城","栃木","群馬","埼玉","千葉","東東京","西東京","神奈川","新潟","富山","石川","福井","山梨","長野","岐阜","静岡","愛知","三重","滋賀","京都","大阪","兵庫","奈良","和歌山","鳥取","島根","岡山","広島","山口","徳島","香川","愛媛","高知","福岡","佐賀","長崎","熊本","大分","宮崎","鹿児島","沖縄"];
  const roster=districts.map((districtName,i)=>({districtName,schoolName:"HTTP school "+(i+1)}));
  await a.service.replaceRepresentatives({eventId,rows:roster,year:2027});
  const teams=ok(await a.client.from("teams").select("id,seed,metadata").eq("event_id",eventId).order("seed"));
  assert.equal(teams.length,49);
  const rounds=teams.map(t=>({representativeKey:t.metadata.representative_key,startRound:t.seed<=15?2:1}));
  await a.service.updateStartRounds({eventId,rows:rounds});
  const picks=teams.filter(t=>t.seed>15).slice(0,8).map(t=>t.id);
  const prediction={p_event_id:eventId,p_team_ids:picks,p_captain_team_id:picks[0],p_payload:{fixture:true}};
  denied(await m.client.rpc("save_koshien_phase1_prediction",prediction));
  snapshot=await a.service.loadSnapshot({eventId,strictEventId:true});
  assert.equal(snapshot.teams.length,49);
  const rev=snapshot.resultRevision;
  await assert.rejects(m.service.openDraft({eventId,expectedRevision:rev}));
  await a.service.openDraft({eventId,expectedRevision:rev});
  const opened=await m.service.loadSnapshot({eventId,strictEventId:true});
  assert.equal(opened.event.status,"open");
  const saved=ok(await m.client.rpc("save_koshien_phase1_prediction",prediction));
  assert.equal(saved.pickCount,8);
  const mine=await m.service.loadSnapshot({eventId,strictEventId:true});
  const admin=await a.service.loadSnapshot({eventId,strictEventId:true});
  assert.equal(mine.predictions.length,1);
  assert.equal(admin.predictions.length,0);
  assert.equal(ok(await m.client.from("phase1_picks").select("id,captain").eq("event_id",eventId)).length,8);
  assert.deepEqual(ok(await a.client.from("predictions").select("user_id").eq("event_id",eventId)),[]);
  assert.deepEqual(ok(await a.client.from("phase1_picks").select("id").eq("event_id",eventId)),[]);
  await assert.rejects(a.service.replaceRepresentatives({eventId,rows:roster,year:2027}));
  assert.equal((await a.service.loadSnapshot({eventId,strictEventId:true})).event.status,"open");
  console.log("PASS: HTTP roster 49, confirmed start rounds, admin open, member prediction, pre-deadline privacy and open roster guard");
  console.log("Verified " + wire.length + " local SDK HTTP requests");
}
main().catch(error=>{console.error(error);process.exitCode=1;});
