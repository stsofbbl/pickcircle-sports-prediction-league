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
    structuredClone,onlineWorkspaceMode:online,isSupabaseAuthEnabled:()=>online,scopedLocalWorkspace:null,
    templates:{worldCup:{},rankingOdds:{},koshien:{}},baseTemplateId:x=>x,
    currentAuthUser:()=>ctx.onlineAuthUser,
    normalizeEvent:x=>x,uniqueStrings:xs=>[...new Set(xs.filter(Boolean))],
    setActiveEvent:id=>{ctx.state.activeEventId=id;ctx.state.event=ctx.state.events.find(e=>e.id===id);},
    STORAGE_KEY:"legacy",defaultState:{activeTemplate:"worldCup",participants:["example"],connection:{}},
    window:{YosoSupabase:{config:()=>({inviteCode:"fixture",url:"https://fixture.invalid",activeLeagueId:ctx.onlineLeagueId})}},
    localStorage:{getItem:k=>{reads.push(k);return k==="legacy"?legacy:(writes.filter(x=>x[0]===k).at(-1)?.[1]??null);},setItem:(k,v)=>writes.push([k,v])},
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
    extract("function localWorkspaceIdentity()","\nfunction captureOnlineKoshienScope"),
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

test("only explicitly local events are stored and restored for the verified actor and club",()=>{
 const h=harness();const c=h.ctx;
 assert.equal(c.activateScopedLocalWorkspace({league_id:"club-A"}),true);
 const local={id:"local-1",templateId:"rankingOdds",predictions:{"LOCAL PICK":{picks:["A"]}}};
 const server={id:"server-1",templateId:"koshien",predictions:{"SERVER PRIVATE":{}}};
 c.scopedLocalWorkspace.ids.add(local.id);c.state.events=[local,server];c.state.event=local;
 assert.equal(c.persist(),true);
 const [key,raw]=h.writes.at(-1);assert.notEqual(key,"legacy");
 assert.deepEqual(JSON.parse(raw).events,[local]);
 c.applyOnlineAuthUser({id:"B"});c.onlineLeagueId="club-A";
 assert.equal(c.activateScopedLocalWorkspace({league_id:"club-A"}),true);
 assert.equal(c.state.events.length,0);
 c.applyOnlineAuthUser({id:"A"});c.onlineLeagueId="club-B";
 assert.equal(c.activateScopedLocalWorkspace({league_id:"club-B"}),true);
 assert.equal(c.state.events.length,0);
 c.invalidateOnlineKoshienScope({clearWorkspace:true});c.onlineLeagueId="club-A";
 assert.equal(c.activateScopedLocalWorkspace({league_id:"club-A"}),true);
 assert.equal(c.state.events[0].id,"local-1");
 assert.equal(c.state.event.id,"local-1");
 assert.ok(!JSON.stringify(c.state).includes("SERVER PRIVATE"));
});
test("corrupt scoped storage is not overwritten",()=>{
 const h=harness();const c=h.ctx;
 c.localStorage.getItem=()=>"{bad";
 assert.equal(c.activateScopedLocalWorkspace({league_id:"club-A"}),false);
 assert.equal(c.persist(),false);
 assert.equal(h.writes.length,0);
});

test("an older tab refuses to overwrite a changed scoped key or recreate a deleted key",()=>{
 const h=harness();const c=h.ctx;
 assert.equal(c.activateScopedLocalWorkspace({league_id:"club-A"}),true);
 const local={id:"local-1",templateId:"rankingOdds",predictions:{}};
 c.scopedLocalWorkspace.ids.add(local.id);c.state.events=[local];c.state.event=local;
 assert.equal(c.persist(),true);
 const [key,first]=h.writes.at(-1);const count=h.writes.length;
 assert.equal(c.persist(),true);assert.equal(h.writes.length,count);
 const external=JSON.stringify({...JSON.parse(first),events:[{...local,name:"other tab"}]});
 h.writes.push([key,external]);local.name="stale tab";
 assert.equal(c.persist(),false);assert.equal(c.scopedLocalWorkspace.conflict,true);
 assert.equal(h.writes.at(-1)[1],external);
 h.writes.push([key,first]);assert.equal(c.persist(),false);
 assert.equal(h.writes.at(-1)[1],first);
 c.invalidateOnlineKoshienScope({clearWorkspace:true});
 assert.equal(c.activateScopedLocalWorkspace({league_id:"club-A"}),true);
 c.localStorage.getItem=()=>null;
 assert.equal(c.persist(),false);
 assert.equal(h.writes.at(-1)[1],first);
});
