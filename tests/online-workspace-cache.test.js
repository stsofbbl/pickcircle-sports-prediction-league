const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
function extract(start,end) {
  const a=source.indexOf(start), b=source.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a);return source.slice(a,b);
}
const privateState = { leagueName:"OLD CLUB", participants:["OLD PRIVATE USER"], activeEventId:"old-event",
  event:{id:"old-event",name:"OLD PRIVATE EVENT",predictions:{"OLD PRIVATE USER":{teams:["SECRET PICK"]}}},
  events:[{id:"old-event",name:"OLD PRIVATE EVENT"}],connection:{} };
function harness(online=true) {
  const legacy=JSON.stringify(privateState), writes=[], reads=[];
  const ctx=vm.createContext({
    structuredClone,onlineWorkspaceMode:online,isSupabaseAuthEnabled:()=>online,
    STORAGE_KEY:"legacy",defaultState:{activeTemplate:"worldCup",participants:["example"],connection:{}},
    window:{YosoSupabase:{config:()=>({inviteCode:"fixture"})}},
    localStorage:{getItem:k=>{reads.push(k);return legacy;},setItem:(k,v)=>writes.push([k,v])},
    normalizeState:x=>x,normalizeConnectionSettings:x=>x,createDefaultState:()=>({}),
    createEvent:(templateId,participants,options)=>({id:"generated",templateId,...options,predictions:{},results:{}}),
    onlineAuthUser:{id:"A"},onlineLeagueId:"club-A",onlineKoshienEventId:"old-event",onlineLeagueMembers:[{userId:"A"}],
    onlineLeagueAdminMessage:"secret",clubPathwayState:{myClubs:[{name:"OLD CLUB"}]},koshienLaterPreviewState:{secret:true},
    onlineKoshienCatalogSequence:0,onlineKoshienCatalog:{},onlineKoshienScopeVersion:0,
    pendingKoshienLoadPromise:null,pendingKoshienLoadScope:null,loadedKoshienOnlineEventId:"old-event",loadedKoshienResultRevision:"secret",
    lastKoshienOnlineLoadUserId:"A",koshienPhase2LoadRequest:null,koshienLaterLoadRequest:null,
    koshienPhase2DraftLoading:false,koshienLaterPhaseLoading:false,koshienPhase2DraftView:{secret:true},koshienLaterPhaseView:{secret:true},koshienOnlineRankingView:{secret:true},
    koshienPhase2DraftMessage:"",koshienPhase2DraftMessageKind:"",koshienLaterPhaseMessage:"",koshienLaterPhaseMessageKind:"",
    els:{confirmDialog:{open:true,close(){this.open=false;}},koshienLaterPreviewRoot:{textContent:"SECRET PICK"}},
    renderAuthState(){},render(){ctx.rendered=JSON.stringify(ctx.state);},
  });
  vm.runInContext([
    extract("function createOnlineWorkspaceState()","\nlet authSession"),
    extract("function applyOnlineAuthUser(","\nasync function bootstrapSupabaseAuth"),
    extract("function persist()","\nfunction captureOnlineKoshienScope"),
    extract("function syncActiveEvent()","\nconst PAGE_IDS")
  ].join("\n"),ctx);
  ctx.state=ctx.loadState();
  return {ctx,writes,reads,legacy};
}
test("online startup ignores unowned legacy storage and does not overwrite it",()=>{
 const h=harness();h.ctx.persist();
 assert.equal(h.reads.length,0);assert.equal(h.writes.length,0);
 assert.equal(h.ctx.state.participants.length,0);assert.equal(h.ctx.state.events.length,0);
 assert.equal(h.ctx.state.event.id,"");assert.ok(!JSON.stringify(h.ctx.state).includes("SECRET PICK"));
});
test("local-only mode retains legacy persistence",()=>{
 const h=harness(false);h.ctx.persist();
 assert.equal(h.reads.length,1);assert.equal(h.writes.length,1);
 assert.ok(h.writes[0][1].includes("SECRET PICK"));
});
test("account change clears private live workspace synchronously before rendering or failed fetch",()=>{
 const h=harness();h.ctx.state=JSON.parse(h.legacy);
 h.ctx.applyOnlineAuthUser({id:"B"});
 assert.ok(!h.ctx.rendered.includes("OLD PRIVATE"));
 assert.equal(h.ctx.state.events.length,0);assert.equal(h.ctx.onlineLeagueMembers.length,0);
 assert.equal(h.ctx.clubPathwayState.myClubs.length,0);
 assert.equal(h.ctx.onlineLeagueId,"");assert.equal(h.ctx.loadedKoshienOnlineEventId,"");
 assert.equal(h.ctx.els.confirmDialog.open,false);assert.equal(h.ctx.els.koshienLaterPreviewRoot.textContent,"");
 h.ctx.persist();assert.equal(h.writes.length,0);
});
test("same actor refresh keeps current workspace, club reset clears data but retains verified club list",()=>{
 const h=harness();h.ctx.state=JSON.parse(h.legacy);const original=h.ctx.state;
 h.ctx.applyOnlineAuthUser({id:"A",displayName:"Renamed"});assert.equal(h.ctx.state,original);
 const clubs=h.ctx.clubPathwayState.myClubs;
 h.ctx.invalidateOnlineKoshienScope({clearWorkspace:true});
 assert.equal(h.ctx.state.events.length,0);assert.equal(h.ctx.clubPathwayState.myClubs,clubs);
 assert.equal(h.ctx.onlineLeagueMembers.length,0);
});
test("online persistence never writes server snapshots or fallback data into legacy storage",()=>{
 const h=harness();h.ctx.state=JSON.parse(h.legacy);
 assert.equal(h.ctx.saveLocalStateOnly(),false);h.ctx.persist();assert.equal(h.writes.length,0);
});

test("a delayed old-account club-list response is not applied after identity changes",async()=>{
 const h=harness();let resolve;
 const delayed=new Promise(r=>resolve=r);
 h.ctx.window.YosoDataService={league:{listMyClubs:()=>delayed}};
 h.ctx.currentAuthUser=()=>h.ctx.onlineAuthUser;
 h.ctx.renderClubPathways=()=>{};
 h.ctx.refreshOnlineKoshienCatalog=()=>{throw Error("old scope refreshed catalog");};
 vm.runInContext(extract("function captureOnlineKoshienScope()","\nasync function saveKoshienOnlineNow")+extract("async function refreshClubPathwayData(","\nasync function handleClubPathwayAction"),h.ctx);
 const pending=h.ctx.refreshClubPathwayData();
 h.ctx.applyOnlineAuthUser({id:"B"});
 resolve([{league_id:"club-A",league_name:"OLD PRIVATE CLUB"}]);
 await pending;
 assert.equal(h.ctx.clubPathwayState.myClubs.length,0);
});
