const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const moduleSource = fs.readFileSync(path.join(__dirname, "../js/jhbf-result-import.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const edgeSource = fs.readFileSync(path.join(__dirname, "../supabase/functions/jhbf-results/index.ts"), "utf8");

test("admin manager loads the semi-automatic JHBF result module", () => {
  assert.match(indexSource, /js\/jhbf-result-import\.js/);
  assert.match(moduleSource, /最新結果を取得/);
  assert.match(moduleSource, /選択した結果を反映/);
  assert.match(moduleSource, /手動入力も引き続き利用できます/);
  assert.match(moduleSource, /browserInstalled/);
  assert.match(moduleSource, /MutationObserver/);
  assert.match(moduleSource, /manager\.querySelector\("\.koshien-jhbf-import"\)/);
});

test("manager extensions load deterministically after app.js", () => {
  const scripts = [
    "app.js",
    "js/koshien-current-stage.js",
    "js/jhbf-result-import.js",
    "js/jhbf-admin-visibility.js",
    "js/jhbf-test-event.js",
  ];
  const positions = scripts.map((script) => indexSource.indexOf(`src="./${script}`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);
});

test("browser integration invokes only fixed Edge Function and audited RPCs", () => {
  assert.match(moduleSource, /functions\.invoke\("jhbf-results"/);
  assert.match(moduleSource, /kind: "representatives"/);
  assert.match(moduleSource, /kind: "start_rounds"/);
  assert.match(moduleSource, /代表校を取得/);
  assert.match(moduleSource, /49代表校へ反映/);
  assert.match(moduleSource, /get_koshien_external_import_context/);
  assert.match(moduleSource, /save_koshien_external_team_alias/);
  assert.match(moduleSource, /record_koshien_external_imports/);
  assert.match(moduleSource, /updateStartRounds/);
  assert.match(moduleSource, /registerOfficialSecondRoundSlots/);
  assert.match(moduleSource, /loadKoshienOnlineState\(\{ force: true \}\)/);
  assert.doesNotMatch(moduleSource, /fetch\s*\(\s*["'`]https:\/\/www\.jhbf/);
});

test("admin reviews and applies the official R2 slot mapping separately from completed R1 cards", () => {
  assert.match(edgeSource, /round2Matches/);
  assert.match(moduleSource, /buildOfficialSecondRoundPreview/);
  assert.match(moduleSource, /公式2回戦配置/);
  assert.match(moduleSource, /data-jhbf-apply-official-second-round/);
});

test("admin confirms start rounds only after reviewing a complete safe preview", () => {
  assert.match(moduleSource, /組み合わせから候補取得/);
  assert.match(moduleSource, /1回戦スタート候補/);
  assert.match(moduleSource, /2回戦スタート候補/);
  assert.match(moduleSource, /未一致: 0校/);
  assert.match(moduleSource, /重複: 0校/);
  assert.match(moduleSource, /取得日時/);
  assert.match(moduleSource, /data-jhbf-apply-start-rounds/);
  assert.match(moduleSource, /!startRoundPreview\.valid/);
  assert.match(moduleSource, /invalidPredictionCount/);
  assert.match(edgeSource, /request\.kind === "start_rounds"[\s\S]*?get_koshien_external_import_context/);
});

test("tournament cards expose a shortcut to the reused official data panel", () => {
  assert.match(appSource, /data-jhbf-open-panel/);
  assert.match(appSource, /公式データ取得/);
  assert.match(appSource, /canOpenOfficialDataForEvent/);
  assert.match(moduleSource, /scrollToImportPanel/);
});

test("browser installer retries when app manager globals become ready after load", () => {
  let loadHandler;
  const timers = [];
  const context = {
    console,
    document: { readyState: "loading" },
    addEventListener(event, handler) {
      if (event === "load") loadHandler = handler;
    },
    setTimeout(handler) {
      timers.push(handler);
      return timers.length;
    },
  };
  context.window = context;
  context.globalThis = context;

  vm.runInNewContext(moduleSource, context);
  assert.equal(typeof loadHandler, "function");

  loadHandler();
  timers.shift()();
  timers.shift()();
  timers.shift()();

  context.state = {
    event: {
      id: "jhbf-test-event",
      config: { externalResults: { competitionType: "summer", year: 2025 } },
    },
  };
  context.renderKoshienManagerPanel = () => "base panel";
  context.bindActiveEventManagerInputs = () => {};
  context.renderActiveEventManager = () => {};

  for (let attempt = 0; attempt < 5 && timers.length; attempt += 1) {
    timers.shift()();
  }

  assert.equal(context.renderKoshienManagerPanel.name, "renderKoshienManagerPanelWithJhbf");
  assert.match(
    context.renderKoshienManagerPanel({ canEditResults: true }),
    /data-jhbf-fetch/,
  );
});

test("manager observer adds JHBF controls only to an editable Koshien event", () => {
  const timers = [];
  let inserted = 0;
  let finalized = false;
  let observerCallback;
  const manager = {
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    insertAdjacentHTML() {
      inserted += 1;
    },
  };
  const context = {
    console,
    document: {
      readyState: "complete",
      querySelector(selector) {
        return selector === "#activeEventManager" ? manager : null;
      },
    },
    state: { event: { id: "world-cup", templateId: "worldCup" } },
    isCurrentUserAdmin: () => true,
    baseTemplateId: (templateId) => templateId,
    isResultFinalized: () => finalized,
    renderKoshienManagerPanel: () => "base panel",
    bindActiveEventManagerInputs: () => {},
    renderActiveEventManager: () => {},
    MutationObserver: class {
      constructor(callback) {
        observerCallback = callback;
      }
      observe() {
        observerCallback();
      }
    },
    addEventListener() {},
    setTimeout(handler) {
      timers.push(handler);
      return timers.length;
    },
  };
  context.window = context;
  context.globalThis = context;

  vm.runInNewContext(moduleSource, context);
  while (timers.length) timers.shift()();

  assert.equal(inserted, 0);

  context.state.event = { id: "finalized-koshien", templateId: "koshien" };
  finalized = true;
  observerCallback();
  while (timers.length) timers.shift()();
  assert.equal(inserted, 0);

  context.state.event = { id: "editable-koshien", templateId: "koshien" };
  finalized = false;
  observerCallback();
  while (timers.length) timers.shift()();
  assert.equal(inserted, 1);
});

function createOfficialFetchRaceHarness() {
  const start=moduleSource.indexOf("  function currentImportScopeKey()");
  const end=moduleSource.indexOf("  async function handleApplyStartRounds()",start);
  const repStart=moduleSource.indexOf("  async function handleApplyRepresentatives()");
  const repEnd=moduleSource.indexOf("  async function handleAlias(",repStart);
  assert.ok(start>=0 && end>start && repStart>=0 && repEnd>repStart);
  const requests=[], saves=[], renders=[];
  const deferred=(kind,args)=>new Promise((resolve,reject)=>requests.push({kind,args,resolve,reject}));
  const ctx=vm.createContext({
    console:{warn(){}}, state:{event:{id:"A",config:{teams:["A"],externalResults:{year:2027}}}},
    view:{eventId:"",scopeKey:"",generation:0}, onlineLeagueId:"club",
    currentAuthUser:()=>({id:"admin"}), jstDateValue:()=>"2027-08-01",
    sourceConfig:()=>({year:2027,fixedSeason:true}), saveLocalStateOnly:()=>saves.push("local"),
    renderActiveEventManager:()=>renders.push("render"), renderScoresOnly(){},
    fetchResults:args=>deferred("results",args),
    fetchRepresentatives:args=>deferred("representatives",args),
    fetchStartRounds:args=>deferred("rounds",args),
    loadContext:eventId=>deferred("context",{eventId}),
    buildImportPreview:rows=>rows, buildRepresentativePreview:rows=>({valid:true,completeCount:rows.length,rows}),
    buildStartRoundPreview:()=>({valid:true}), getTeams:()=>ctx.state.event.config.teams,
    representativeTeamMeta:()=>({}), normalizeKoshienEvent(){},
    window:{confirm:()=>true,YosoDataService:{koshien:{replaceRepresentatives:args=>deferred("save",args)}}},
  });
  vm.runInContext(moduleSource.slice(start,end)+moduleSource.slice(repStart,repEnd),ctx);
  ctx.resetForEvent();
  const root={querySelector:()=>null};
  const switchEvent=id=>{ctx.state.event={id,config:{teams:[id],externalResults:{year:2027}}};ctx.resetForEvent();};
  return {ctx,root,requests,saves,renders,switchEvent};
}
test("delayed representative results are discarded after A → B → A switch",async()=>{
  const h=createOfficialFetchRaceHarness();
  const pending=h.ctx.handleFetchRepresentatives(h.root);
  assert.equal(h.requests[0].args.eventId,"A");
  h.switchEvent("B");h.switchEvent("A");
  const fresh=h.ctx.handleFetchRepresentatives(h.root);
  h.requests[0].resolve({rows:[{schoolName:"old"}]});
  await pending;
  assert.equal(h.ctx.view.loading,true);
  assert.equal(h.ctx.view.representativeRows.length,0);
  h.requests[1].resolve({rows:[{schoolName:"new"}]});
  await fresh;
  assert.equal(h.ctx.view.representativeRows[0].schoolName,"new");
  assert.equal(h.ctx.view.loading,false);
});
test("late official results/context and start-round responses cannot populate another event",async()=>{
  const h=createOfficialFetchRaceHarness();
  const result=h.ctx.handleFetch(h.root);
  h.requests[0].resolve({rows:[{name:"A result"}]});
  // A promise crossing a VM realm may need more than one microtask.
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests[1].kind,"context");
  h.switchEvent("B");
  h.requests[1].resolve({matches:[]});
  await result;
  assert.equal(h.ctx.view.rows.length,0);
  assert.equal(h.ctx.view.context,null);
  const rounds=h.ctx.handleFetchStartRounds(h.root);
  assert.equal(h.requests[2].args.eventId,"B");
  h.switchEvent("C");
  h.requests[2].resolve({rows:[{name:"B round"}]});
  h.requests[3].resolve({matches:[]});
  await rounds;
  assert.equal(h.ctx.view.startRoundRows.length,0);
  assert.equal(h.ctx.view.context,null);
});
test("late representative save success or failure does not overwrite selected tournament",async()=>{
  for(const fail of [false,true]){
    const h=createOfficialFetchRaceHarness();
    h.ctx.view.representativeRows=[{schoolName:"A school"}];
    const pending=h.ctx.handleApplyRepresentatives();
    assert.equal(h.requests[0].args.eventId,"A");
    h.switchEvent("B");
    if(fail) h.requests[0].reject(Error("offline")); else h.requests[0].resolve({count:49});
    await pending;
    assert.equal(h.ctx.state.event.config.teams[0],"B");
    assert.equal(h.saves.length,0);
    assert.equal(h.ctx.view.representativeMessage,"");
  }
});

test("persisted season stays authoritative after opening and rejects a mismatched result date",async()=>{
  const begin=moduleSource.indexOf("  function sourceConfig()");
  const end=moduleSource.indexOf("  async function client()",begin);
  const ctx=vm.createContext({state:{event:{season:"2027",status:"open",name:"甲子園2026",config:{externalResults:{year:2026,competitionType:"senbatsu"}}}}});
  vm.runInContext(moduleSource.slice(begin,end),ctx);
  for(const status of ["draft","open","resultWait","finalized","archive"]){
    ctx.state.event.status=status;
    assert.equal(ctx.sourceConfig().year,2027);
    assert.equal(ctx.sourceConfig().competitionType,"summer");
    assert.equal(ctx.sourceConfig().fixedSeason,true);
  }
  ctx.state.event.season="";
  assert.equal(ctx.sourceConfig().year,2026);
  assert.equal(ctx.sourceConfig().competitionType,"senbatsu");
  const h=createOfficialFetchRaceHarness();
  const wrongDate={querySelector:sel=>sel==="[data-jhbf-base-date]"?{value:"2026-08-01"}:null};
  await h.ctx.handleFetch(wrongDate);
  assert.equal(h.requests.length,0);
  assert.equal(h.saves.length,0);
  assert.match(h.ctx.view.message,/大会年度/);
});

function createOfficialWriteRaceHarness(){
  const requests=[],renders=[],saves=[],messages=[];
  const defer=(kind,args)=>new Promise((resolve,reject)=>requests.push({kind,args,resolve,reject}));
  const row={status:"ready",externalKey:"fixture-key",roundLabel:"R1",sourceUrl:"fixture",fetchedAt:"2027-08-01",match:{matchNo:1},canonicalPayload:{roundKey:"R1",team1Id:"t1",team2Id:"t2"},rawPayload:{}};
  const ctx=vm.createContext({
    console:{warn(){}},state:{event:{id:"A",results:{matches:[{match_id:"R1-1"}]}}},view:{eventId:"",scopeKey:"",generation:0},onlineLeagueId:"club",currentAuthUser:()=>({id:"admin"}),
    jstDateValue:()=>"2027-08-01",renderActiveEventManager:()=>renders.push("render"),renderScoresOnly(){},saveLocalStateOnly:()=>saves.push(ctx.state.event.id),
    buildOfficialFirstRoundPreview:()=>({valid:true,rows:[]}),buildOfficialSecondRoundPreview:()=>({valid:true,rows:[]}),
    loadContext:eventId=>defer("context",{eventId}),loadKoshienOnlineState:args=>defer("reload",args),buildImportPreview:rows=>rows,
    saveAlias:args=>defer("alias",args),recordImports:(eventId,rows)=>defer("audit",{eventId,rows}),
    sameCompletedMatch:()=>true,unorderedPairMatches:()=>true,
    localMatchFor:()=>ctx.state.event.results.matches[0],applyRowToLocalMatch:(row,match)=>{match.changed=true;},
    applyKoshienMatchFinishes(){},currentKoshienParticipantName:()=>"admin",setKoshienMatchMessage:m=>messages.push(m),
    saveKoshienOnlineNow:()=>defer("result",{eventId:ctx.state.event.id}),
    window:{confirm:()=>true,YosoDataService:{koshien:{
      registerOfficialFirstRoundMatches:args=>defer("r1",args),
      registerOfficialSecondRoundSlots:args=>defer("r2",args),
    }}},
  });
  const extract=(start,end)=>moduleSource.slice(moduleSource.indexOf(start),moduleSource.indexOf(end,moduleSource.indexOf(start)));
  vm.runInContext(extract("  function currentImportScopeKey()","  async function handleFetch(root)")+
    extract("  async function handleApplyOfficialFirstRoundMatches()","  function representativeTeamMeta(")+
    extract("  async function handleAlias(button)","  function localMatchFor(")+
    extract("  async function recordPendingImportForMatch(","  function bindControls()"),ctx);
  const switchEvent=id=>{ctx.state.event={id,results:{matches:[{match_id:"R1-1"}]}};ctx.resetForEvent();};
  switchEvent("A");
  return {ctx,requests,renders,saves,messages,row,switchEvent};
}
test("R1/R2 save cannot reload another event or mutate its status",async()=>{
  for(const [handler,count] of [["handleApplyOfficialFirstRoundMatches",17],["handleApplyOfficialSecondRoundSlots",16]]){
    const h=createOfficialWriteRaceHarness();
    const pending=h.ctx[handler]();
    assert.equal(h.requests[0].args.eventId,"A");
    h.switchEvent("B");
    h.requests[0].resolve({count});
    await pending;
    assert.equal(h.requests.length,1);
    assert.equal(h.ctx.view.startRoundMessage,"");
  }
});
test("alias and pending-match audit are bound to the captured event across awaits",async()=>{
  const h=createOfficialWriteRaceHarness();
  const alias=h.ctx.handleAlias({closest:()=>({querySelector:()=>({value:"t1"})}),dataset:{jhbfSaveAlias:"alias"}});
  assert.equal(h.requests[0].args.eventId,"A");
  h.switchEvent("B");h.requests[0].resolve({});
  await alias;
  assert.equal(h.requests.length,1);
  h.ctx.view.pendingImports["R1-1"]=h.row;
  const scope=h.ctx.captureImportScope();
  const audit=h.ctx.recordPendingImportForMatch("R1-1",scope);
  assert.equal(h.requests[1].args.eventId,"B");
  h.switchEvent("C");
  h.ctx.view.pendingImports["R1-1"]={externalKey:"C-key"};
  h.requests[1].resolve({matches:[{matchId:"fixture",status:"completed",roundKey:"R1",matchNo:1}]});
  const result=await audit;
  assert.equal(result.reason,"event_scope_changed");
  assert.equal(h.requests.length,2);
  assert.equal(h.ctx.view.pendingImports["R1-1"].externalKey,"C-key");
  const stale=await h.ctx.recordPendingImportForMatch("R1-1",scope);
  assert.equal(stale.reason,"event_scope_changed");
});
test("bulk result success or failure after switch never audits or rolls back a different event",async()=>{
  for(const failed of [false,true]){
    const h=createOfficialWriteRaceHarness();
    h.ctx.view.rows=[h.row];
    const pending=h.ctx.handleApply({querySelectorAll:()=>[{dataset:{jhbfSelect:"fixture-key"}}]});
    assert.equal(h.requests[0].kind,"result");
    h.switchEvent("B");
    if(failed)h.requests[0].reject(Error("offline"));else h.requests[0].resolve({ok:true});
    await pending;
    assert.equal(h.requests.length,1);
    assert.equal(h.saves.includes("B"),false);
    assert.equal(h.ctx.state.event.results.matches[0].changed,undefined);
    assert.equal(h.messages.length,0);
  }
});
