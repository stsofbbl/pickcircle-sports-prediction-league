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

function harness({ user = { id: "admin" }, role = "owner", membershipLeague = leagueId, insertError = null, response = null, missing = false, existingRow = null, readError = null, listRows = null, listError = null, rpcResponse = null, rpcError = null } = {}) {
  const calls = [];
  const queries = [];
  class Query {
    constructor(table) { this.table = table; this.filters = {}; }
    select(columns) { this.columns = columns; return this; }
    eq(k,v) { this.filters[k] = v; return this; }
    order() { return this; }
    limit(n) { this.limitCount = n; return this.resolve(); }
    maybeSingle() { return this.resolve(); }
    single() { return this.resolve(); }
    insert(payload) { this.payload = payload; calls.push({table:this.table, payload}); return this; }
    resolve() {
      queries.push({table:this.table, filters:this.filters, columns:this.columns, limit:this.limitCount});
      if (this.table === "leagues") return {data:[{id:leagueId,invite_code:"club"}],error:null};
      if (this.table === "league_members") return {data:{league_id:membershipLeague,role},error:null};
      if (this.table === "profiles") return {data:{display_name:"admin"},error:null};
      if (this.table === "events" && this.payload) return {data:response || this.payload,error:insertError};
      if (this.table === "events" && this.limitCount === 101) return {data:listRows,error:listError};
      if (this.table === "events" && (missing || existingRow || readError)) {
        return {data: existingRow === "same" ? calls[0].payload
          : (typeof existingRow === "function" ? existingRow(calls[0].payload) : existingRow), error: readError};
      }
      throw Error("unexpected query: "+this.table);
    }
  }
  const window = {YosoSupabase:{
    config:()=>({inviteCode:"club",sync:{autoSaveKoshien:true}}),
    hasConfig:()=>true,
    client:()=>({from:table=>new Query(table), rpc:async(name,args)=>{calls.push({name,args});return {data:rpcResponse,error:rpcError};}}),
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
test("duplicate INSERT recovers only the same unchanged draft after ambiguous reload", async () => {
  const h = harness({insertError:{code:"23505",message:"duplicate"},existingRow:"same"});
  const result = await h.service.koshien.createDraft(args);
  assert.equal(result.recovered,true);
  assert.equal(result.eventId,eventId);
  assert.equal(h.calls.length,1);
  const eventReads = h.queries.filter(x=>x.table==="events" && x.filters.id);
  assert.equal(eventReads.length,1);
  assert.equal(eventReads[0].filters.league_id,leagueId);
});
test("unrelated duplicate, inaccessible row, read error and wrong response never become success", async () => {
  const duplicate={code:"23505",message:"duplicate"};
  for(const opts of [
    {insertError:duplicate,missing:true},
    {insertError:duplicate,readError:{code:"42501",message:"denied"}},
    {insertError:duplicate,existingRow:{id:eventId,league_id:leagueId,status:"draft"}},
    {insertError:duplicate,existingRow:payload=>({...payload,name:"別大会"})},
    {insertError:duplicate,existingRow:payload=>({...payload,rules:{...payload.rules,config:{...payload.rules.config,teams:["fake"]}}})},
    {insertError:{code:"42501",message:"denied"}},
    {response:{id:"other"}},
  ]){
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

const catalogRow = { id:eventId, league_id:leagueId, preset_type:"koshien", name:"2027大会", status:"draft", season:"2027" };
test("member can read the selected club catalog without downloading scores or predictions", async () => {
  const h = harness({ role:"member", listRows:[catalogRow] });
  const result = await h.service.koshien.listEvents({leagueId});
  assert.equal(result.events[0].id,eventId);
  assert.equal(result.userId,"admin");
  const query = h.queries.find(q=>q.table==="events");
  assert.equal(query.filters.league_id,leagueId);
  assert.equal(query.filters.preset_type,"koshien");
  assert.equal(query.limit,101);
  assert.doesNotMatch(query.columns,/rules|predictions|scores/);
  assert.equal(h.calls.length,0);
});
test("catalog fails closed for cross-club rows, missing membership and server error", async () => {
  for(const opts of [{membershipLeague:"wrong"},{listRows:[{...catalogRow,league_id:"wrong"}]},{listError:{message:"offline"}}]) {
    const h=harness(opts);
    await assert.rejects(h.service.koshien.listEvents({leagueId}));
    assert.equal(h.calls.length,0);
  }
});
test("catalog marks an incomplete list rather than claiming all events were downloaded", async () => {
  const h=harness({listRows:Array.from({length:101},(_,i)=>({...catalogRow,id:String(i)}))});
  const result=await h.service.koshien.listEvents({leagueId});
  assert.equal(result.events.length,100);
  assert.equal(result.truncated,true);
});
function catalogUiHarness() {
  const start=app.indexOf("function onlineKoshienCatalogScope()");
  const end=app.indexOf("function renderTournamentManageList()",start);
  const queue=[], applied=[], alerts=[];
  const ctx=vm.createContext({
    onlineLeagueId:leagueId, onlineKoshienCatalog:{scope:"",rows:[]}, onlineKoshienCatalogSequence:0,
    currentAuthUser:()=>({id:"admin"}), isSupabaseAuthEnabled:()=>true,
    window:{YosoDataService:{shouldAutoSaveKoshien:()=>true,koshien:{listEvents:()=>new Promise(resolve=>queue.push(resolve))}},alert:m=>alerts.push(m)},
    els:{onlineKoshienCatalog:null}, state:{events:[],event:{id:"previous"},activeEventId:"previous"},
    loadedKoshienOnlineEventId:"previous", pendingKoshienLoadPromise:null, onlineKoshienDraftCreating:false,
    baseTemplateId:x=>x,
    setActiveEvent:id=>applied.push(["local",id]), render(){},
    loadKoshienOnlineState:async opts=>{applied.push(["read",opts]);return null;},
  });
  vm.runInContext(app.slice(start,end),ctx);
  return {ctx,queue,applied,alerts};
}
test("late catalog response after club switch is discarded; metadata never becomes scoring state", async () => {
  const {ctx,queue}=catalogUiHarness();
  const first=ctx.refreshOnlineKoshienCatalog();
  ctx.onlineLeagueId="other";
  const second=ctx.refreshOnlineKoshienCatalog();
  queue[0]({leagueId,userId:"admin",events:[catalogRow]});
  await first;
  assert.equal(ctx.onlineKoshienCatalog.scope,JSON.stringify(["admin","other"]));
  queue[1]({leagueId:"other",userId:"admin",events:[]});
  await second;
  assert.equal(ctx.onlineKoshienCatalog.rows.length,0);
  assert.equal(ctx.state.events.length,0);
  assert.equal(ctx.state.event.id,"previous");
});
test("catalog selection requires strict server load and never locally switches on failure", async () => {
  const {ctx,queue,applied,alerts}=catalogUiHarness();
  const request=ctx.refreshOnlineKoshienCatalog();
  queue[0]({leagueId,userId:"admin",events:[catalogRow]});
  await request;
  await ctx.selectTournamentFromUi(eventId);
  assert.equal(applied.length,1);
  assert.equal(applied[0][0],"read");
  assert.equal(applied[0][1].exactEventId,eventId);
  assert.equal(applied[0][1].expectedLeagueId,leagueId);
  assert.equal(ctx.state.event.id,"previous");
  assert.equal(alerts.length,1);
});

test("opening calls only the server RPC with the reviewed event revision", async () => {
  const revision="a".repeat(32);
  const h=harness({rpcResponse:{event_id:eventId,status:"open"}});
  const result=await h.service.koshien.openDraft({eventId,expectedRevision:revision});
  assert.equal(result.status,"open");
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].name,"open_koshien_draft");
  assert.equal(h.calls[0].args.p_event_id,eventId);
  assert.equal(h.calls[0].args.p_expected_revision,revision);
  for (const opts of [{rpcError:{message:"stale"}},{rpcResponse:{event_id:"wrong",status:"open"}},{rpcResponse:{event_id:eventId,status:"draft"}}]) {
    const failed=harness(opts);
    await assert.rejects(failed.service.koshien.openDraft({eventId,expectedRevision:revision}));
  }
  const invalid=harness();
  await assert.rejects(invalid.service.koshien.openDraft({eventId,expectedRevision:"invalid"}));
  assert.equal(invalid.calls.length,0);
});
test("draft open UI uses loaded ID and exact reload; official draft year is fixed",()=>{
  assert.match(app,/async function openOnlineKoshienDraft/);
  assert.match(app,/openDraft\(\{ eventId: id, expectedRevision: loadedKoshienResultRevision \}\)/);
  assert.match(app,/exactEventId: id, expectedLeagueId: leagueId/);
  const source=fs.readFileSync(path.join(__dirname,"../js/jhbf-result-import.js"),"utf8");
  assert.match(source,/fixedDraftSeason: true/);
  assert.equal((source.match(/config\.fixedDraftSeason \? config\.year : Number/g)||[]).length,3);
});
