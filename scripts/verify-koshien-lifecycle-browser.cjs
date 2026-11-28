// Exercise the actual checked-out page and application scripts in Chromium.
// ONLY the backend adapter is synthetic. PostgreSQL RPCs are tested separately
// in koshien-lifecycle-integration.sql. Never send traffic to production.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const os = require("node:os");
const {execFile} = require("node:child_process");
const {promisify} = require("node:util");
const run = promisify(execFile);
const root = path.resolve(__dirname, "..");
const chrome = process.env.CHROME_BIN;
if (!chrome) throw Error("Set CHROME_BIN to an existing Chromium executable");

const fixture = String.raw`
(() => {
  const scenario = new URLSearchParams(location.search).get("scenario");
  if (!["owner","member"].includes(scenario)) throw Error("invalid fixture scenario");
  const owner = {id:"00000000-0000-4000-8000-000000000001",displayName:"Fixture Owner",clubRole:"owner",role:"admin"};
  const member = {id:"00000000-0000-4000-8000-000000000002",displayName:"Fixture Member",clubRole:"member",role:"member"};
  let user = scenario === "owner" ? owner : member;
  let offline = false, membershipRevoked = false;
  const poisoned = JSON.stringify({
    leagueName:"LEGACY PRIVATE CLUB",participants:["LEGACY PRIVATE PERSON"],
    activeTemplate:"rankingOdds",activeEventId:"legacy-private",
    events:[{id:"legacy-private",name:"LEGACY PRIVATE EVENT",templateId:"rankingOdds",predictions:{"LEGACY PRIVATE PERSON":{picks:["SECRET PICK"]}}}],
    connection:{mode:"supabase"}
  });
  localStorage.setItem("yoso-league-state-v1",poisoned);
  const leagueId = "00000000-0000-4000-8000-000000000010";
  const priorId = "00000000-0000-4000-8000-000000000011";
  const nextId = "00000000-0000-4000-8000-000000000012";
  const revision = "a".repeat(32);
  const deadline = "2035-08-01T00:00:00Z";
  const districts = ["北北海道","南北海道","青森","岩手","宮城","秋田","山形","福島","茨城","栃木","群馬","埼玉","千葉","東東京","西東京","神奈川","新潟","富山","石川","福井","山梨","長野","岐阜","静岡","愛知","三重","滋賀","京都","大阪","兵庫","奈良","和歌山","鳥取","島根","岡山","広島","山口","徳島","香川","愛媛","高知","福岡","佐賀","長崎","熊本","大分","宮崎","鹿児島","沖縄"];
  const roster = districts.map((districtName,i) => ({districtName,schoolName:"Fixture School "+(i+1)}));
  const key = row => row.districtName+":"+row.schoolName.toLowerCase().replace(/\s+/g,"");
  const events = new Map(), calls = [], errors = [], alerts = [];
  const clone = value => JSON.parse(JSON.stringify(value));
  const record = (kind,args) => calls.push({kind,...clone(args)});
  function requireRow(id) {const row=events.get(id); if(!row) throw Error("unknown fixture event "+id); return row;}
  function requireOwner(){if(scenario!=="owner") throw Error("member cannot write tournament settings");}
  function eventRow(id,year,name,status){
    return {id,league_id:leagueId,name,preset_type:"koshien",sport_type:"baseball",season:String(year),status,
      prediction_deadline:deadline,archived_at:null,created_at:"2026-11-24T00:00:00Z",
      rules:{approvalPolicy:"admin",resultFlow:{status:status==="finalized"?"finalized":"none"},config:{teams:[],teamMeta:{},startRoundsConfirmed:false,externalResults:{competitionType:"summer",year}}}};
  }
  function prepareRoster(row,rows,confirmed=false){
    row.fixtureTeams=rows.map((school,i)=>({id:row.id+"-team-"+i,name:school.schoolName,metadata:{district:school.districtName,source:"jhbf",source_year:Number(row.season),representative_key:key(school),startRound:i<34?1:2}}));
    row.rules.config.teams=row.fixtureTeams.map(t=>t.name);
    row.rules.config.teamMeta=Object.fromEntries(row.fixtureTeams.map(t=>[t.name,{district:t.metadata.district,source:"jhbf",representativeKey:t.metadata.representative_key,startRound:t.metadata.startRound,odds:1}]));
    row.rules.config.startRoundsConfirmed=confirmed;
  }
  const prior=eventRow(priorId,2026,"Fixture Prior 2026","finalized");
  prepareRoster(prior,roster,true);
  events.set(priorId,prior);
  if(scenario==="member"){
    const next=eventRow(nextId,2027,"Fixture Summer 2027","open");
    prepareRoster(next,roster,true);
    events.set(nextId,next);
  }
  const priorBefore=JSON.stringify(prior);
  const members=[owner,member].map(person=>({user_id:person.id,role:person.clubRole,profiles:{display_name:person.displayName}}));
  function snapshot(row){
    const event=clone(row);
    delete event.fixtureTeams;
    return {ok:true,event,league:{id:leagueId,invite_code:"fixture-club"},currentUser:clone(user),members:clone(members),
      teams:clone(row.fixtureTeams||[]),predictions:[],players:[],scores:[],results:null,predictionsPublic:row.status==="finalized",resultRevision:revision};
  }
  const config={url:"https://fixture.invalid",anonKey:"synthetic-key",inviteCode:"fixture-club",activeLeagueId:leagueId};
  window.YosoSupabase={
    config:()=>config,hasConfig:()=>true,allowsConnectionOverrides:()=>false,
    saveConfig:next=>Object.assign(config,next),
    client:async()=>({
      functions:{invoke:async(name,{body})=>{
        requireOwner();const row=requireRow(body.eventId);
        if(name!=="jhbf-results"||String(body.year)!==row.season||body.competitionType!=="summer") throw Error("wrong official request");
        record("official",{eventId:body.eventId,year:body.year,kindName:body.kind});
        if(body.kind==="representatives") return {data:{rows:clone(roster),warnings:[]}};
        if(body.kind==="start_rounds") return {data:{rows:clone(roster.slice(0,34)),matches:[],round2Matches:[],warnings:[],sourceUrls:["https://fixture.invalid/draw"],fetchedAt:"2027-07-30T00:00:00Z"}};
        throw Error("unexpected official kind");
      }},
      rpc:async(name,args)=>{
        if(name!=="get_koshien_external_import_context") throw Error("unexpected fixture RPC "+name);
        const row=requireRow(args.p_event_id);
        record("context",{eventId:row.id});
        return {data:{teams:(row.fixtureTeams||[]).map(t=>({teamId:t.id,name:t.name})),aliases:[],matches:[]}};
      }
    })
  };
  window.YosoDataService={
    isAuthEnabled:()=>true,shouldAutoSaveKoshien:()=>true,
    auth:{currentUser:async()=>clone(user),onAuthStateChange:async()=>{}},
    league:{listMyClubs:async()=>membershipRevoked?[]:[{league_id:leagueId,league_name:"Fixture club",invite_code:"fixture-club",membership_role:user.clubRole}],listMyJoinRequests:async()=>{if(membershipRevoked)throw Error("secondary request unavailable");return [];},listPendingJoinRequests:async()=>[]},
    koshien:{
      listEvents:async({leagueId:id})=>{
        if(id!==leagueId) throw Error("wrong catalog scope");
        record("list",{leagueId:id});
        return {leagueId:id,userId:user.id,events:[...events.values()].map(row=>({id:row.id,league_id:id,name:row.name,preset_type:"koshien",season:row.season,status:row.status,prediction_deadline:row.prediction_deadline})),truncated:false};
      },
      loadSnapshot:async({eventId,strictEventId})=>{
        record("load",{eventId,strictEventId:Boolean(strictEventId)});
        if(offline) throw Error("fixture offline");
        const row=events.get(eventId)||(strictEventId?null:prior);
        return row?snapshot(row):{skipped:true,reason:"not found"};
      },
      createDraft:async args=>{
        requireOwner();record("create",args);
        if(args.leagueId!==leagueId||args.season!==2027||events.has(args.eventId)) throw Error("invalid fixture create");
        const row=eventRow(args.eventId,args.season,args.name,"draft");
        row.prediction_deadline=new Date(args.deadline).toISOString();
        events.set(row.id,row);
        return {ok:true,eventId:row.id,status:"draft"};
      },
      replaceRepresentatives:async({eventId,year,rows})=>{
        requireOwner();const row=requireRow(eventId);
        record("roster",{eventId,year,count:rows.length});
        if(row.status!=="draft"||String(year)!==row.season||rows.length!==49) throw Error("invalid fixture roster");
        prepareRoster(row,rows);
        return {count:49,startRoundsConfirmed:false};
      },
      updateStartRounds:async({eventId,rows})=>{
        requireOwner();const row=requireRow(eventId);
        record("rounds",{eventId,count:rows.length});
        if(row.status!=="draft"||rows.length!==49||rows.filter(x=>x.startRound===1).length!==34) throw Error("invalid fixture draw");
        for(const team of row.fixtureTeams){
          const selected=rows.find(x=>x.representativeKey===team.metadata.representative_key);
          if(!selected) throw Error("unmatched fixture school");
          team.metadata.startRound=selected.startRound;
          row.rules.config.teamMeta[team.name].startRound=selected.startRound;
        }
        row.rules.config.startRoundsConfirmed=true;
        return {count:49,startRoundsConfirmed:true,invalidPredictionCount:0};
      },
      openDraft:async({eventId,expectedRevision})=>{
        requireOwner();const row=requireRow(eventId);
        record("open",{eventId,expectedRevision});
        if(row.status!=="draft"||expectedRevision!==revision||!row.rules.config.startRoundsConfirmed||row.fixtureTeams.length!==49) throw Error("draft not ready");
        row.status="open";
        return {event_id:eventId,status:"open"};
      },
      saveSnapshot:async({event,eventId,participantName})=>{
        const row=requireRow(eventId);
        const prediction=event.predictions[participantName];
        record("prediction",{eventId,participantName,teams:prediction?.teams||[],captain:prediction?.captain||""});
        if(row.status!=="open"||event.id!==eventId||prediction?.profileId!==user.id||prediction.teams.length!==8||new Set(prediction.teams).size!==8||!prediction.teams.includes(prediction.captain)) throw Error("invalid fixture prediction");
        return {ok:true};
      }
    }
  };
  window.confirm=()=>true;
  window.alert=message=>alerts.push(String(message));
  window.fetch=async()=>{throw Error("Network disabled in lifecycle fixture");};
  addEventListener("error",e=>errors.push(String(e.message)));
  addEventListener("unhandledrejection",e=>errors.push(String(e.reason)));
  window.lifecycleFixture={scenario,user,leagueId,priorId,nextId,revision,calls,alerts,errors,events,roster,priorUnchanged:()=>JSON.stringify(prior)===priorBefore,
    cacheUnchanged:()=>localStorage.getItem("yoso-league-state-v1")===poisoned,
    switchOffline(){offline=true;user=scenario==="owner"?member:owner;return clone(user);},
    restoreOriginal(){user=scenario==="owner"?owner:member;return clone(user);},
    revokeMembership(){membershipRevoked=true;}
  };
})();
`;
const assertions = String.raw`
(async()=>{
  const f=window.lifecycleFixture;
  const check=(condition,message)=>{if(!condition) throw Error(message);};
  const wait=async(predicate,message)=>{
    for(let i=0;i<250;i++){if(predicate()) return; await new Promise(resolve=>setTimeout(resolve,20));}
    throw Error(message+"; alerts="+JSON.stringify(f.alerts)+"; errors="+JSON.stringify(f.errors));
  };
  const q=selector=>document.querySelector(selector);
  const click=selector=>{const el=q(selector);check(el&&!el.disabled,"missing or disabled "+selector);el.click();};
  const value=(selector,next)=>{const el=q(selector);check(el,"missing "+selector);el.value=next;check(el.value===next,"value rejected "+selector);};
  const navigate=async(page)=>{
    click('[data-nav-page="'+page+'"]');
    await wait(()=>q('[data-page="'+page+'"].is-active'),"page not active: "+page);
  };
  const active=()=>q("#activeEventManager .active-manager-summary h3")?.textContent;
  await wait(()=>q("#onlineKoshienCatalog [data-online-koshien-select]")&&active()==="Fixture Prior 2026"&&q("#authScreen")?.hidden===true,"bootstrap/catalog did not finish");
  check(f.cacheUnchanged(),"startup overwrote legacy cache");
  check(!document.body.textContent.includes("LEGACY PRIVATE"),"legacy data rendered on startup");
  await navigate("settings");
  if(f.scenario==="owner"){
    value("#newTournamentTemplate","koshien");
    value("#newTournamentSport","baseball");
    value("#newTournamentName","Fixture Summer 2027");
    value("#newTournamentSeason","2027");
    value("#newTournamentDeadline","2035-08-01T00:00");
    click("#settingsNewEventButton");
    await wait(()=>f.calls.some(c=>c.kind==="create")&&active()==="Fixture Summer 2027"&&q("[data-koshien-open-draft]"),"draft creation did not reload");
    const create=f.calls.find(c=>c.kind==="create");
    const id=create.eventId;
    check(f.calls.filter(c=>c.kind==="create").length===1,"duplicate create");
    check(f.calls.some(c=>c.kind==="load"&&c.eventId===id&&c.strictEventId),"no strict reload");
    check(q("[data-koshien-open-draft]").disabled,"empty draft can open");
    await navigate("prediction");
    check(q("#eventForm").textContent.includes("大会準備中")&&!q("[data-koshien-phase1-save]"),"draft prediction exposed");
    await navigate("active");
    await wait(()=>q("[data-jhbf-fetch-representatives]")&&!q("[data-jhbf-fetch-representatives]").disabled,"missing official roster control");
    click("[data-jhbf-fetch-representatives]");
    await wait(()=>q("[data-jhbf-apply-representatives]")&&!q("[data-jhbf-apply-representatives]").disabled,"49-school preview not ready");
    click("[data-jhbf-apply-representatives]");
    await wait(()=>f.calls.some(c=>c.kind==="roster")&&q("[data-jhbf-fetch-start-rounds]")&&!q("[data-jhbf-fetch-start-rounds]").disabled,"roster not applied");
    click("[data-jhbf-fetch-start-rounds]");
    await wait(()=>q("[data-jhbf-apply-start-rounds]")&&!q("[data-jhbf-apply-start-rounds]").disabled,"start rounds preview not ready");
    click("[data-jhbf-apply-start-rounds]");
    await wait(()=>f.calls.some(c=>c.kind==="rounds")&&q("[data-koshien-open-draft]")&&!q("[data-koshien-open-draft]").disabled,"draft not ready after confirmed rounds");
    click("[data-koshien-open-draft]");
    await wait(()=>f.events.get(id).status==="open"&&q("#eventForm [data-koshien-phase1-save]")&&!q("[data-koshien-open-draft]"),"opening did not refresh");
    check(f.calls.some(c=>c.kind==="open"&&c.eventId===id&&c.expectedRevision===f.revision),"wrong open revision");
    check(q("[data-koshien-start-rounds-save]")?.disabled,"confirmed rounds can be edited");
    check(f.calls.filter(c=>c.kind==="official").every(c=>c.eventId===id&&c.year===2027),"wrong official scope");
    await navigate("settings");
    await wait(()=>q('#onlineKoshienCatalog [data-online-koshien-select="'+f.priorId+'"]'),"prior event absent");
    click('#onlineKoshienCatalog [data-online-koshien-select="'+f.priorId+'"]');
    await wait(()=>active()==="Fixture Prior 2026"&&q('#onlineKoshienCatalog [data-online-koshien-select="'+id+'"]'),"cannot select prior event");
    click('#onlineKoshienCatalog [data-online-koshien-select="'+id+'"]');
    await wait(()=>active()==="Fixture Summer 2027"&&q("#eventForm [data-koshien-phase1-save]"),"cannot select new event");
  }else{
    check(q("#settingsNewEventButton").disabled,"member can create");
    click('#onlineKoshienCatalog [data-online-koshien-select="'+f.nextId+'"]');
    await wait(()=>active()==="Fixture Summer 2027"&&q("#eventForm [data-koshien-phase1-save]"),"member cannot select new event");
    check(!q("[data-koshien-open-draft]"),"member opening button exposed");
    await navigate("prediction");
    const selects=[...document.querySelectorAll("#eventForm [data-koshien-pick]")];
    check(selects.length===8,"eight picks missing");
    for(let i=0;i<8;i++){
      selects[i].value=f.roster[i].schoolName;
      check(selects[i].value===f.roster[i].schoolName,"school option missing");
      selects[i].dispatchEvent(new Event("change",{bubbles:true}));
    }
    const captain=q("[data-koshien-captain]");
    captain.value=f.roster[0].schoolName;
    captain.dispatchEvent(new Event("change",{bubbles:true}));
    click("[data-koshien-phase1-save]");
    await wait(()=>f.calls.some(c=>c.kind==="prediction")&&q("[data-koshien-phase1-message]")?.textContent.includes("保存しました"),"prediction save not acknowledged");
    const saved=f.calls.find(c=>c.kind==="prediction");
    check(saved.eventId===f.nextId&&saved.teams.length===8&&saved.captain===f.roster[0].schoolName,"wrong prediction payload");
  }
  check(f.priorUnchanged(),"prior event modified");
  // Exercise real DOM creation and persistence for a non-server preset.
  const officialTitle=active(), localTitle="Fixture private local ranking";
  let localKey="", localRaw="";
  if(f.scenario==="owner"){
    await navigate("settings");
    value("#newTournamentTemplate","rankingOdds");
    value("#newTournamentName",localTitle);
    click("#settingsNewEventButton");
    await wait(()=>active()===localTitle,"local tournament creation failed");
    localKey=scopedLocalWorkspace?.key;
    check(Boolean(localKey)&&localKey!=="yoso-league-state-v1","missing actor/club local key");
    localRaw=localStorage.getItem(localKey);
    const saved=JSON.parse(localRaw);
    check(saved.events.length===1&&saved.events[0].name===localTitle&&saved.events[0].templateId==="rankingOdds","wrong local payload");
    check(!localRaw.includes(officialTitle)&&!localRaw.includes("Fixture School"),"server event leaked into local storage");
  }
  // Switch identity while offline using the actual host function.
  const oldTitle=active();
  const next=f.switchOffline();
  applyOnlineAuthUser(next);
  check(q("#authScreen").hidden===true,"new actor unexpectedly locked");
  check(!document.body.textContent.includes(oldTitle),"previous event survives identity switch");
  check(!q("#eventForm").textContent.includes("Fixture School"),"old prediction roster survives identity switch");
  check(q("#saveButton").disabled,"unloaded event can save");
  check(await loadKoshienOnlineState({force:true})===null,"offline fixture returned snapshot");
  render();
  check(!document.body.textContent.includes(oldTitle),"offline reload revealed previous event");
  check(!document.body.textContent.includes("LEGACY PRIVATE"),"offline reload revealed legacy cache");
  check(f.cacheUnchanged(),"online prediction/render overwrote legacy storage");
  if(f.scenario==="owner"){
    await refreshClubPathwayData();
    check(!document.body.textContent.includes(localTitle),"different actor restored private local event");
    check(localStorage.getItem(localKey)===localRaw,"different actor changed private local data");
    applyOnlineAuthUser(f.restoreOriginal());
    check(!document.body.textContent.includes(localTitle),"local event restored before membership verification");
    await refreshClubPathwayData();
    await wait(()=>active()===localTitle,"verified actor failed to restore local format");
    check(state.events.every(e=>baseTemplateId(e.templateId)!=="koshien"),"offline restoration included server snapshot");
    check(JSON.parse(localStorage.getItem(localKey)).events.length===1,"local restore duplicated event");
    // A distinct same-origin browsing context generates a genuine storage event.
    const peer=document.createElement("iframe");
    peer.hidden=true;
    document.body.append(peer);
    const external=JSON.parse(localStorage.getItem(localKey));
    external.events[0].name="Fixture updated in peer window";
    const changed=JSON.stringify(external);
    peer.contentWindow.localStorage.setItem(localKey,changed);
    await wait(()=>scopedLocalWorkspace?.conflict===true,"cross-window storage event not received");
    state.event.name="Fixture stale edit";
    await confirmSave();
    check(q("#saveButton").textContent==="別タブで変更・未保存","missing stale write warning");
    check(localStorage.getItem(localKey)===changed,"stale browser overwrote peer update");
    peer.remove();
    f.revokeMembership();
    await refreshClubPathwayData();
    check(!state.event.id&&state.events.length===0,"revoked membership retained workspace");
    check(!isClubAdmin(),"revoked owner retained club admin controls");
    check(!document.body.textContent.includes("Fixture stale edit"),"revoked workspace is rendered");
    check(localStorage.getItem(localKey)===changed,"revocation changed local storage");
  }
  check(f.alerts.length===0,"unexpected alert: "+f.alerts.join(";"));
  check(f.errors.length===0,"unexpected browser error: "+f.errors.join(";"));
  document.documentElement.dataset.lifecycleResult="pass";
  q("#lifecycle-fixture-result").textContent=JSON.stringify({scenario:f.scenario,calls:f.calls.map(c=>c.kind),priorUnchanged:true});
})().catch(error=>{
  document.documentElement.dataset.lifecycleResult="fail";
  document.querySelector("#lifecycle-fixture-result").textContent=String(error.stack||error);
});
`;
const html=fs.readFileSync(path.join(root,"index.html"),"utf8").replace("</body>",'<pre id="lifecycle-fixture-result">pending</pre><script src="/fixture-assert.js"></script></body>');
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,"http://127.0.0.1").pathname;
  res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'");
  res.setHeader("Cache-Control","no-store");
  let body;
  if(pathname==="/"){body=html;res.setHeader("Content-Type","text/html; charset=utf-8");}
  else if(pathname==="/fixture-assert.js"){body=assertions;res.setHeader("Content-Type","application/javascript; charset=utf-8");}
  else if(pathname==="/js/supabase-client.js"){body=fixture;res.setHeader("Content-Type","application/javascript; charset=utf-8");}
  else if(["/js/supabase-public-config.js","/supabase-config.js","/js/data-service.js"].includes(pathname)){body="";res.setHeader("Content-Type","application/javascript; charset=utf-8");}
  else {
    const file=path.resolve(root,"."+pathname);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    const type={".js":"application/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".svg":"image/svg+xml",".jpg":"image/jpeg",".webp":"image/webp"}[path.extname(file)];
    res.setHeader("Content-Type",type||"application/octet-stream");
    body=fs.readFileSync(file);
  }
  res.writeHead(200);res.end(body);
});
(async()=>{
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    for(const scenario of ["owner","member"]){
      const profile=fs.mkdtempSync(path.join(os.tmpdir(),"yoso-lifecycle-chrome-"));
      try {
        const url="http://127.0.0.1:"+server.address().port+"/?scenario="+scenario+"#settings";
        const {stdout}=await run(chrome,["--headless","--no-sandbox","--disable-gpu","--disable-background-networking","--no-proxy-server","--user-data-dir="+profile,"--dump-dom","--virtual-time-budget=12000",url],{timeout:45000,maxBuffer:24*1024*1024});
        const result=stdout.match(/<pre id="lifecycle-fixture-result">([\s\S]*?)<\/pre>/)?.[1]||"missing result";
        if(!stdout.includes('data-lifecycle-result="pass"')) throw Error("Browser "+scenario+" failed: "+result.slice(0,4000));
        console.log("PASS actual page/Chrome with synthetic backend: "+result);
      }finally{fs.rmSync(profile,{recursive:true,force:true});}
    }
  }finally{server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
