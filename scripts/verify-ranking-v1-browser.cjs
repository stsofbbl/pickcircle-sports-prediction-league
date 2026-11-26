// Real isolated Chrome / mocked RPC. No package install or network.
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),http=require("node:http"),os=require("node:os");
const {execFile}=require("node:child_process");
const {promisify}=require("node:util");
const run=promisify(execFile),chrome=process.env.CHROME_BIN;
assert.ok(chrome);
const dir=path.join(__dirname,"../prototypes/ranking-v1");
const names=["contract.cjs","api-client.cjs","view-model.cjs","controller.cjs","draft-form.cjs","panel.cjs","workspace.cjs"];
// Fixed allowlist of CommonJS modules wrapped in ordinary script functions.
// No eval, dynamic loading or production bundle creation.
const source="(()=>{const modules={"+names.map(n=>JSON.stringify("./"+n)+":(module,exports,require)=>{\n"+fs.readFileSync(path.join(dir,n),"utf8")+"\n}").join(",")+"};const cache={};function require(id){if(!Object.hasOwn(modules,id))throw Error('unknown fixture module');if(cache[id])return cache[id].exports;const module={exports:{}};cache[id]=module;modules[id](module,module.exports,require);return module.exports;}window.RankingFixture={...require('./controller.cjs'),...require('./panel.cjs'),...require('./workspace.cjs')};})();";
const checks=`
const root=document.getElementById("root");
const actorId="00000000-0000-0000-0000-000000000001",leagueId="00000000-0000-0000-0000-000000000010",eventId="demo";
const playerId="00000000-0000-0000-0000-000000000011",rev="a".repeat(32);
const config={version:1,candidates:["a","b","c","d"].map(id=>({id,label:id==="a"?"<img src=x onerror=alert(1)>":id,multiplierTenths:10}))};
const pick={version:1,candidateIds:["a","b","c","d"]};
const scope={actorId,leagueId,eventId};
let snapshot={...scope,name:"<script>bad</script>",sportType:"baseball",deadline:"2027-01-01T00:00:00Z",config,status:"open",canManage:false,canSubmit:true,predictionsPublic:false,ownPrediction:null,publishedPredictions:[],result:null,ranking:[]};
const calls=[];
const controller=RankingFixture.createRankingController({client:{rpc:async(name,args)=>{
 calls.push({name,args});
 if(name.endsWith("_snapshot"))return {data:snapshot};
 if(name.endsWith("_save")){
  snapshot={...snapshot,ownPrediction:args.p_prediction};
  return {data:{...scope,prediction:args.p_prediction}};
 }
 if(name.endsWith("_draft_review"))return {data:{...snapshot,revision:rev,recovered:false}};
 if(name.endsWith("_edit_draft")){
  snapshot={...snapshot,name:args.p_name,sportType:args.p_sport,deadline:args.p_deadline,config:args.p_config};
  return {data:{...snapshot,revision:"b".repeat(32),recovered:false}};
 }
 if(name.endsWith("_review"))return {data:{...scope,revision:rev}};
 if(name.endsWith("_finalize")){
  snapshot={...snapshot,status:"finalized",result:args.p_result,ranking:[{playerId,name:"player",rank:1,score:25,breakdown:{version:1,scoreTenths:250,breakdown:[10,7,5,3].map((basePoints,i)=>({candidateId:pick.candidateIds[i],predictedRank:i+1,actualRank:i+1,basePoints,multiplierTenths:10,scoreTenths:basePoints*10}))}}]};
  return {data:{...scope,status:"finalized",scoreCount:1,recovered:false}};
 }
 throw Error("unexpected RPC "+name);
}}});
const panel=RankingFixture.mountRankingPanel(root,controller);
const check=(ok,message)=>{if(!ok)throw Error(message);};
const action=name=>root.querySelector('[data-action="'+name+'"]');
async function idle(){for(let i=0;i<50;i++){await Promise.resolve();if(!controller.getState().busy){await Promise.resolve();await Promise.resolve();return;}}throw Error("operation did not finish");}
function fill(kind){
 for(let i=0;i<4;i++){
  const field=root.querySelector('[data-pick="'+kind+'-'+i+'"]');
  field.value=pick.candidateIds[i];field.dispatchEvent(new Event("change"));
 }
}
(async()=>{
 snapshot={...snapshot,status:"draft",canManage:true,canSubmit:false};
 controller.select(scope);await panel.refresh();
 check(action("review-draft"),"draft review missing");
 action("review-draft").click();await idle();
 check(action("edit-draft")&&action("open"),"review controls missing");
 const oldOpen=action("open");
 action("edit-draft").click();await idle();
 check(!action("open"),"open exposed while editing");
 oldOpen.click();
 check(!calls.some(c=>c.name.endsWith("_open")),"detached open invoked");
 const draftName=root.querySelector('[data-draft-field="name"]');
 draftName.value="Updated Cup";draftName.dispatchEvent(new Event("input",{bubbles:true}));
 const candidate=root.querySelector('[data-draft-field="candidate-label"]');
 candidate.value="Renamed";candidate.dispatchEvent(new Event("input",{bubbles:true}));
 action("save-draft").click();await idle();
 const edited=calls.find(c=>c.name.endsWith("_edit_draft"));
 check(edited.args.p_revision===rev&&edited.args.p_config.candidates[0].id==="a"&&edited.args.p_config.candidates[0].label==="Renamed","draft edit ID or revision lost");
 check(!action("open")&&action("review-draft"),"edit left old review usable");
 snapshot={...snapshot,name:"<script>bad</script>",config,status:"open",canManage:false,canSubmit:true};
 controller.select(scope);await panel.refresh();
 check(root.textContent.includes("他の会員の予想は締切まで非公開"),"privacy text absent");
 check(!action("finalize")&&!action("review-result")&&!action("open"),"member got management controls");
 check(action("save").disabled,"incomplete prediction enabled");
 fill("own");check(!action("save").disabled,"valid prediction disabled");
 const duplicate=root.querySelector('[data-pick="own-3"]');duplicate.value="a";duplicate.dispatchEvent(new Event("change"));
 check(action("save").disabled,"duplicate prediction enabled");
 fill("own");action("save").click();await idle();
 check(calls.filter(c=>c.name.endsWith("_save")).length===1,"save not dispatched exactly once");
 check(controller.getState().view.ownPrediction.candidateIds.join(",")==="a,b,c,d","save not reloaded");
 check(root.textContent.includes("保存応答・再取得"),"confirmation not displayed");
 check(!root.querySelector("img")&&!root.querySelector("script"),"untrusted label was parsed as HTML");
 snapshot={...snapshot,status:"resultWait",canManage:true,canSubmit:false,predictionsPublic:true,publishedPredictions:[{playerId,name:"player",prediction:pick}]};
 controller.select(scope);await panel.refresh();
 check(!action("save")&&action("review-result"),"closed manager controls invalid");
 fill("result");action("review-result").click();await idle();
 check(action("finalize")&&!calls.some(c=>c.name.endsWith("_finalize")),"review automatically finalized");
 check(root.textContent.includes("確定する公式結果"),"review missing");
 action("finalize").click();await idle();
 check(calls.filter(c=>c.name.endsWith("_finalize")).length===1,"finalize count");
 check(root.textContent.includes("1位 player 25pt"),"server ranking not displayed");
 check(!action("finalize")&&!action("save"),"finalized edit allowed");
 controller.select(null);panel.render();
 check(!root.textContent.includes("player")&&!root.textContent.includes("25pt"),"logout retained private view");
 panel.dispose();
 let created=null,attempt=0,firstArgs=null;
 const wsCalls=[];
 const ws=RankingFixture.mountRankingWorkspace(root,{client:{rpc:async(name,args)=>{
  wsCalls.push({name,args});
  if(name.endsWith("_list"))return {data:{actorId,leagueId,events:created?[{id:created.eventId,name:created.name,sport_type:created.sportType,status:created.status,prediction_deadline:created.deadline}]:[],truncated:false}};
  if(name.endsWith("_create_draft")){
   attempt++;
   if(attempt===1){firstArgs=JSON.stringify(args);return {error:{message:"timeout"}};}
   check(JSON.stringify(args)===firstArgs,"creation retry changed ID or content");
   created={actorId,leagueId,eventId:args.p_event_id,name:args.p_name,sportType:args.p_sport,deadline:args.p_deadline,config:args.p_config,
    status:"draft",canManage:true,canSubmit:false,predictionsPublic:false,ownPrediction:null,publishedPredictions:[],result:null,ranking:[]};
   return {data:{...created,revision:rev,recovered:true}};
  }
  if(name.endsWith("_snapshot"))return created?{data:created}:{error:{code:"42501"}};
  throw Error("unexpected workspace RPC "+name);
 }}});
 await ws.setContext({actorId,leagueId,canManage:false});
 check(!action("new-draft"),"member creation UI exposed");
 await ws.setContext({actorId,leagueId,canManage:true});
 action("new-draft").click();
 function change(field,value){field.value=value;field.dispatchEvent(new Event("input",{bubbles:true}));}
 change(root.querySelector('[data-draft-field="name"]'),"New Cup");
 change(root.querySelector('[data-draft-field="deadline"]'),"2027-01-01T12:00:00+09:00");
 [...root.querySelectorAll('[data-draft-field="candidate-label"]')].forEach((e,i)=>change(e,"Team "+i));
 check(!action("create-draft").disabled,"complete creation disabled");
 action("create-draft").click();
 async function until(fn){for(let i=0;i<100;i++){await Promise.resolve();if(fn())return;}throw Error("workspace operation incomplete");}
 await until(()=>!!action("verify-creation"));
 check(!action("new-draft")&&!action("retry-creation"),"ambiguous create allowed immediate retry or new ID");
 action("verify-creation").click();await until(()=>!!action("retry-creation"));
 action("retry-creation").click();await until(()=>!!action("back-catalog"));
 check(root.textContent.includes("New Cup"),"created draft not displayed");
 check(attempt===2,"unexpected creation attempts");
 action("back-catalog").click();await until(()=>!!action("select-event"));
 action("select-event").click();await until(()=>!!action("back-catalog"));
 check(root.textContent.includes("New Cup"),"selected draft not displayed");
 await ws.setContext(null);
 check(!root.textContent.includes("New Cup"),"workspace logout retained draft");
 ws.dispose();
 document.documentElement.dataset.result="pass";document.getElementById("result").textContent="PASS: member save, duplicate rejection, manager explicit review/finalize, safe rendering, logout";
})().catch(error=>{document.documentElement.dataset.result="fail";document.getElementById("result").textContent=String(error.stack||error);});
`;
const page='<!doctype html><html lang="ja"><meta charset="utf-8"><title>Ranking panel fixture</title><div id="root"></div><pre id="result">pending</pre><script src="/bundle.js"></script><script src="/checks.js"></script></html>';
const routes={"/":page,"/bundle.js":source,"/checks.js":checks};
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,"http://127.0.0.1").pathname;
 res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'self'; connect-src 'none'; form-action 'none'");
 res.setHeader("Content-Type",pathname==="/"? "text/html; charset=utf-8":"application/javascript; charset=utf-8");
 res.writeHead(Object.hasOwn(routes,pathname)?200:404);res.end(routes[pathname]||"");
});
(async()=>{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),"yoso-ranking-browser-"));
 try{
  const {stdout}=await run(chrome,["--headless","--no-sandbox","--disable-gpu","--disable-background-networking","--no-proxy-server","--user-data-dir="+profile,"--dump-dom","--virtual-time-budget=10000","http://127.0.0.1:"+server.address().port+"/"],{timeout:30000,maxBuffer:1024*1024});
  assert.ok(stdout.includes('data-result="pass"'),stdout.slice(-6000));
  console.log("PASS: actual Chrome ranking panel / mocked RPC / no external network");
 }finally{fs.rmSync(profile,{recursive:true,force:true});server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
