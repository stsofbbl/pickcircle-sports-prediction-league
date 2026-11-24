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
    sourceConfig:()=>({year:2027,fixedDraftSeason:true}), saveLocalStateOnly:()=>saves.push("local"),
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
  await Promise.resolve();
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
