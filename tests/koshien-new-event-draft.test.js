const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const source = fs.readFileSync(path.join(__dirname, "../js/data-service.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const eventId = "11111111-1111-4111-8111-111111111111";
const leagueId = "22222222-2222-4222-8222-222222222222";
const args = { eventId, leagueId, name: "大会", season: 2027, deadline: "2035-08-01T00:00:00Z" };

function harness({ user = { id: "admin" }, role = "owner", membershipLeague = leagueId, insertError = null, response = null, missing = false } = {}) {
  const calls = [];
  const queries = [];
  class Query {
    constructor(table) { this.table = table; this.filters = {}; }
    select() { return this; }
    eq(k,v) { this.filters[k] = v; return this; }
    order() { return this; }
    limit() { return this.resolve(); }
    maybeSingle() { return this.resolve(); }
    single() { return this.resolve(); }
    insert(payload) { this.payload = payload; calls.push({table:this.table, payload}); return this; }
    resolve() {
      queries.push({table:this.table, filters:this.filters});
      if (this.table === "leagues") return {data:[{id:leagueId,invite_code:"club"}],error:null};
      if (this.table === "league_members") return {data:{league_id:membershipLeague,role},error:null};
      if (this.table === "profiles") return {data:{display_name:"admin"},error:null};
      if (this.table === "events" && this.payload) return {data:response || this.payload,error:insertError};
      if (this.table === "events" && missing) return {data:null,error:null};
      throw Error("unexpected query: "+this.table);
    }
  }
  const window = {YosoSupabase:{
    config:()=>({inviteCode:"club",sync:{autoSaveKoshien:true}}),
    hasConfig:()=>true,
    client:()=>({from:table=>new Query(table)}),
    sessionUser:async()=>user,
  }};
  vm.runInNewContext(source,{window,localStorage:{},console});
  return {service:window.YosoDataService,calls,queries};
}

test("online draft uses one insert and never copies a prior event or placeholder representatives", async () => {
  const h = harness();
  const result = await h.service.koshien.createDraft(args);
  assert.equal(result.eventId,eventId);
  assert.equal(h.calls.length,1);
  const {table,payload} = h.calls[0];
  assert.equal(table,"events");
  assert.equal(payload.status,"draft");
  assert.equal(payload.league_id,leagueId);
  assert.equal(payload.created_by,"admin");
  assert.equal(payload.season,"2027");
  assert.equal(payload.rules.approvalPolicy,"admin");
  assert.equal(payload.rules.resultFlow.status,"none");
  assert.equal(payload.rules.config.externalResults.year,2027);
  assert.equal(payload.rules.config.teams.length,0);
  assert.equal(payload.rules.config.startRoundsConfirmed,false);
});
test("draft creation rejects login, wrong club, regular member and invalid inputs before insert", async () => {
  for (const opts of [{user:null},{role:"member"},{membershipLeague:"other"}]) {
    const h=harness(opts);
    await assert.rejects(h.service.koshien.createDraft(args));
    assert.equal(h.calls.length,0);
  }
  for (const bad of [{season:2040},{deadline:"2000-01-01"},{eventId:"old"},{leagueId:"other"}]) {
    const h=harness();
    await assert.rejects(h.service.koshien.createDraft({...args,...bad}));
    assert.equal(h.calls.length,0);
  }
});
test("duplicate, permission error and wrong response never become success", async () => {
  for(const opts of [{insertError:{code:"23505",message:"duplicate"}},{insertError:{code:"42501",message:"denied"}},{response:{id:"other"}}]){
    const h=harness(opts);
    await assert.rejects(h.service.koshien.createDraft(args));
    assert.equal(h.calls.length,1);
  }
});
test("strict draft reload cannot fall back to an unrelated event",async()=>{
  const h=harness({missing:true});
  const result=await h.service.koshien.loadSnapshot({eventId,strictEventId:true});
  assert.equal(result.skipped,true);
  assert.equal(h.queries.filter(x=>x.table==="events").length,1);
  assert.equal(h.queries.find(x=>x.table==="events").filters.id,eventId);
});
test("online creation uses a separate confirmed path, exact reload and preserves regular save guard",()=>{
  assert.match(app,/async function createTournamentFromSettingsAction/);
  assert.match(app,/await window\.YosoDataService\.koshien\.createDraft\(/);
  assert.match(app,/force: true, exactEventId: eventId, expectedLeagueId: leagueId/);
  assert.match(app,/loadedEventId !== displayedEventId/);
  assert.match(app,/if \(state\.event\?\.status === "draft"\)/);
  assert.match(app,/button\.disabled = onlineKoshien/);
});
