// Disposable local Chrome + real SDK, GoTrue and PostgREST.
// Uses actual ranking bundle, host render hook, auth client and data service.
// The surrounding legacy app shell and list_my_clubs are synthetic fixtures.
"use strict";
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),os=require("node:os"),http=require("node:http");
const {spawn,execFileSync}=require("node:child_process");
const {createHmac,randomUUID}=require("node:crypto");
const {scoreRanking}=require("../prototypes/ranking-v1/contract.cjs");
const base=process.env.YOSO_RANKING_HTTP_URL,authBase=process.env.YOSO_RANKING_AUTH_URL,secret=process.env.YOSO_RANKING_HTTP_SECRET;
assert.equal(process.env.GITHUB_ACTIONS,"true");assert.equal(base,"http://127.0.0.1:39117");assert.equal(authBase,"http://127.0.0.1:39118");
assert.ok(secret&&process.env.CHROME_BIN&&process.argv[2]);
const club="00000000-0000-0000-0000-000000000010";
const otherClub="00000000-0000-0000-0000-000000000020";
const root=path.join(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const delay=ms=>new Promise(r=>setTimeout(r,ms));
const b64=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
const msg=b64({alg:"HS256",typ:"JWT"})+"."+b64({role:"anon",aud:"authenticated",exp:Math.floor(Date.now()/1000)+3600});
const anon=msg+"."+createHmac("sha256",secret).update(msg).digest("base64url");
const sql=s=>execFileSync("sudo",["-u","postgres","psql","-X","-qAt","-v","ON_ERROR_STOP=1","-d","yoso_ranking_v1_test","-c",s],{encoding:"utf8",timeout:10000}).trim();
async function account(role,name){
 const email=randomUUID()+"@example.com",password="Fixture-"+randomUUID();
 const response=await fetch(authBase+"/signup",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({email,password})});
 const data=await response.json();
 assert.ok(response.ok,"fixture signup failed: "+response.status);
 const uid=data.user?.id||data.id;assert.match(uid,/^[0-9a-f-]{36}$/);
 const league=role==="outsider"?otherClub:club,r=role==="member"?"member":"owner";
 sql("BEGIN; INSERT INTO auth.users(id) VALUES('"+uid+"'); INSERT INTO public.profiles(id,auth_user_id,display_name) VALUES('"+uid+"','"+uid+"','"+name+"'); INSERT INTO public.league_members VALUES('"+league+"','"+uid+"','"+r+"','active'); INSERT INTO public.players(id,league_id,profile_id,display_name,is_admin) VALUES('"+randomUUID()+"','"+league+"','"+uid+"','"+name+"',"+(r==="owner")+"); COMMIT;");
 return {uid,email,password};
}
const index=read("index.html"),section=index.match(/<section[^>]+id="rankingV1Section"[^>]*>[\s\S]*?<\/section>/)?.[0];assert.ok(section);
const app=read("app.js");
function extract(start,end){const a=app.indexOf(start),b=app.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return app.slice(a,b);}
const bundle=read("js/ranking-v1.generated.js");
assert.equal(bundle.split("const RELEASE_ENABLED=false;").length,2);
const enabled=bundle.replace("const RELEASE_ENABLED=false;","const RELEASE_ENABLED=true;");
const hook=extract("function rankingV1HostContext()","function applyTheme(")+extract("function applyOnlineAuthUser(","async function bootstrapSupabaseAuth(");
const setup=`
window.YOSO_SUPABASE_CONFIG={url:location.origin,anonKey:${JSON.stringify(anon)},sdkUrl:"/sdk.js",activeLeagueId:${JSON.stringify(club)},auth:{enabled:true}};
`;
const harness=`
let onlineAuthUser=null,onlineLeagueId=${JSON.stringify(club)},authRecoveryMode=false,lastRenderedPageId="",loadedKoshienOnlineEventId="",lastKoshienOnlineLoadUserId="";
let pageId="active";
const els={pages:[],navLinks:[]};
const currentAuthUser=()=>onlineAuthUser,currentPageId=()=>pageId;
${hook}
const check=(ok,msg)=>{if(!ok)throw Error(msg);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<250;i++){if(fn())return;await sleep(40);}throw Error("timed out: "+label+" / "+document.getElementById("rankingV1Root").textContent.slice(0,200));}
const section=document.getElementById("rankingV1Section"),root=document.getElementById("rankingV1Root");
const button=key=>root.querySelector('[data-action="'+key+'"]');
async function action(key,next){const b=button(key);check(b&&!b.disabled,"missing action "+key);b.click();if(next)await until(next,key);}
function change(e,value){check(e,"field missing");e.value=value;e.dispatchEvent(new Event("input",{bubbles:true}));e.dispatchEvent(new Event("change",{bubbles:true}));}
function fill(kind,ids){ids.forEach((id,i)=>change(root.querySelector('[data-pick="'+kind+'-'+i+'"]'),id));}
window.fixture={
 async login(email,password,uid){
  const c=await YosoSupabase.client(),r=await c.auth.signInWithPassword({email,password});
  check(!r.error&&r.data.user.id===uid,"login failed");
  applyOnlineAuthUser({id:uid,provider:"supabase"});renderPage();
  check(!section.hidden,"entry hidden after login");return true;
 },
 async enter(expect){document.getElementById("rankingV1Open").click();
  await until(()=>root.textContent.includes(expect),"open workspace");return true;},
 async create(name,deadline){
  await action("new-draft",()=>!!button("create-draft"));
  change(root.querySelector('[data-draft-field="name"]'),name);
  change(root.querySelector('[data-draft-field="deadline"]'),deadline);
  [...root.querySelectorAll('[data-draft-field="candidate-label"]')].forEach((e,i)=>change(e,"Browser team "+(i+1)));
  await action("create-draft",()=>!!button("review-draft"));return true;
 },
 async open(){await action("review-draft",()=>!!button("open"));await action("open",()=>!!button("save"));return true;},
 async choose(name){const b=[...root.querySelectorAll('[data-action="select-event"]')].find(e=>e.textContent.includes(name));check(b,"event absent");b.click();await until(()=>!!button("save")||!!button("refresh"),"select event");return true;},
 ids(){return [...root.querySelector('[data-pick="own-0"]').options].map(o=>o.value).filter(Boolean);},
 async save(ids){fill("own",ids);await action("save",()=>root.textContent.includes("保存応答・再取得"));return true;},
 async refresh(text){await action("refresh",()=>root.textContent.includes(text)&&!!button("refresh")&&!button("refresh").disabled);return root.textContent;},
 async finalize(ids){await action("close",()=>!!button("review-result"));fill("result",ids);await action("review-result",()=>!!button("finalize"));await action("finalize",()=>root.textContent.includes("ランキング"));return root.textContent;},
 async membershipDenied(){await action("refresh",()=>root.textContent.includes("所属・権限"));check(!root.textContent.includes("Browser team"),"revoked member retained view");return true;},
 async leave(){pageId="home";renderPage();check(section.hidden&&root.textContent==="","navigation retained data");pageId="active";renderPage();return true;},
 async logout(){YosoRankingV1.invalidate();const c=await YosoSupabase.client();await c.auth.signOut();applyOnlineAuthUser(null);renderPage();check(section.hidden&&root.textContent==="","logout retained data");return true;},
 text(){return root.textContent;},canCreate(){return !!button("new-draft");},visible(){return !section.hidden;}
};
`;
const page='<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="stylesheet" href="/style.css">'+section+'<script src="/setup.js"></script><script src="/sdk.js"></script><script src="/client.js"></script><script src="/service.js"></script><script src="/ranking.js"></script><script src="/harness.js"></script></html>';
const routes={"/":page,"/style.css":read("styles.css"),"/setup.js":setup,"/sdk.js":fs.readFileSync(process.argv[2],"utf8"),"/client.js":read("js/supabase-client.js"),"/service.js":read("js/data-service.js"),"/ranking.js":enabled,"/harness.js":harness};
let calls=0;
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,"http://127.0.0.1");
  if(Object.hasOwn(routes,url.pathname)){
   res.setHeader("Content-Type",url.pathname==="/"? "text/html; charset=utf-8":url.pathname.endsWith(".css")?"text/css":"application/javascript");
   res.setHeader("Content-Security-Policy","default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:");
   res.end(routes[url.pathname]);return;
  }
  const auth=url.pathname.startsWith("/auth/v1/"),rest=url.pathname.startsWith("/rest/v1/");
  if(!auth&&!rest){res.writeHead(404);res.end();return;}
  calls++;
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const headers={};
  for(const key of ["authorization","apikey","content-type","accept","prefer","range","x-client-info","x-supabase-api-version","accept-profile","content-profile"])if(req.headers[key])headers[key]=req.headers[key];
  const upstream=await fetch((auth?authBase:base)+url.pathname.slice(8)+url.search,{method:req.method,headers,...(["GET","HEAD"].includes(req.method)?{}:{body:Buffer.concat(chunks)}),signal:AbortSignal.timeout(10000)});
  res.statusCode=upstream.status;
  for(const key of ["content-type","content-range","range-unit"])if(upstream.headers.has(key))res.setHeader(key,upstream.headers.get(key));
  res.end(Buffer.from(await upstream.arrayBuffer()));
 }catch(_){res.writeHead(502);res.end("local fixture proxy failure");}
});
async function browser(){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),"ranking-http-chrome-"));
 // A separate process group lets cleanup terminate only this disposable Chrome and its children.
 assert.equal(process.platform,"linux");
 const proc=spawn(process.env.CHROME_BIN,["--headless","--no-sandbox","--disable-gpu","--disable-background-networking","--no-proxy-server","--remote-debugging-port=0","--user-data-dir="+profile,"about:blank"],{stdio:"ignore",detached:true});
 const exited=new Promise(resolve=>{proc.once("exit",resolve);proc.once("error",resolve);});
 let ws;
 function signalGroup(signal){
  if(!proc.pid)return;
  try{process.kill(-proc.pid,signal);}catch(error){if(error.code!=="ESRCH")throw error;}
 }
 async function close(){
  try{ws?.close();}finally{
   try{
    signalGroup("SIGTERM");
    await Promise.race([exited,delay(2000)]);
    signalGroup("SIGKILL");
    await Promise.race([exited,delay(2000)]);
   }finally{
    // Chrome child processes may still be releasing files after the parent exits.
    await fs.promises.rm(profile,{recursive:true,force:true,maxRetries:10,retryDelay:100});
   }
  }
 }
 try{
  const portFile=path.join(profile,"DevToolsActivePort");
  for(let i=0;i<100&&!fs.existsSync(portFile);i++)await delay(100);
  const port=fs.readFileSync(portFile,"utf8").split("\n")[0];
  const tabs=await(await fetch("http://127.0.0.1:"+port+"/json/list")).json();
  const tab=tabs.find(t=>t.type==="page");assert.ok(tab);
  ws=new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{ws.addEventListener("open",resolve,{once:true});ws.addEventListener("error",reject,{once:true});});
  let seq=0;const pending=new Map();
  ws.addEventListener("message",e=>{const data=JSON.parse(e.data);const cb=pending.get(data.id);if(cb){pending.delete(data.id);cb(data);}});
  function send(method,params={}){return new Promise((resolve,reject)=>{
   const id=++seq,timer=setTimeout(()=>{pending.delete(id);reject(Error("CDP timeout "+method));},25000);
   pending.set(id,data=>{clearTimeout(timer);if(data.error)reject(Error(data.error.message));else resolve(data.result);});
   ws.send(JSON.stringify({id,method,params}));
  });}
  async function evaluate(expression){const r=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});
   if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
   return r.result.value;}
  await send("Page.navigate",{url:"http://127.0.0.1:"+server.address().port+"/"});
  for(let i=0;i<100;i++){if(await evaluate("typeof window.fixture==='object'"))break;await delay(100);}
  assert.equal(await evaluate("typeof window.fixture"),"object");
  return {call:(method,...args)=>evaluate("fixture["+JSON.stringify(method)+"]("+args.map(a=>JSON.stringify(a)).join(",")+")"),close};
 }catch(error){await close();throw error;}
}
(async()=>{
 const browsers=[];
 try{
  await new Promise(r=>server.listen(0,"127.0.0.1",r));
  const owner=await account("owner","Browser owner"),member=await account("member","Browser member"),outsider=await account("outsider","Browser outsider");
  for(let i=0;i<3;i++)browsers.push(await browser());
  const [a,m,x]=browsers;
  for(const [b,u] of [[a,owner],[m,member],[x,outsider]])await b.call("login",u.email,u.password,u.uid);
  await a.call("enter","大会一覧");await m.call("enter","大会一覧");
  assert.equal(await a.call("canCreate"),true);assert.equal(await m.call("canCreate"),false);
  await x.call("enter","クラブ所属を確認できません");
  assert.equal(await x.call("canCreate"),false);
  const name="Browser E2E "+randomUUID().slice(0,8),deadline=new Date(Date.now()+30000).toISOString();
  await a.call("create",name,deadline);await a.call("open");
  const ids=await a.call("ids");assert.equal(ids.length,4);
  await m.call("leave");await m.call("enter",name);await m.call("choose",name);
  const other=[ids[1],ids[0],ids[3],ids[2]];
  await a.call("save",ids);await m.call("save",other);
  const privateText=await m.call("text");assert.ok(privateText.includes("他の会員の予想は締切まで非公開"));assert.ok(!privateText.includes("Browser owner"));
  await delay(Math.max(0,Date.parse(deadline)-Date.now()+400));
  await a.call("refresh","公開予想");
  await m.call("refresh","公開予想");
  const result=await a.call("finalize",ids);
  const memberResult=await m.call("refresh","ランキング");
  const config={version:1,candidates:ids.map((id,i)=>({id,label:"Browser team "+(i+1),multiplierTenths:10}))};
  const score=p=>scoreRanking({config,prediction:{version:1,candidateIds:p},result:{version:1,candidateIds:ids}}).scoreTenths/10;
  for(const t of [result,memberResult]){assert.ok(t.includes("1位 Browser owner "+score(ids)+"pt"));assert.ok(t.includes("2位 Browser member "+score(other)+"pt"));}
  sql("UPDATE public.league_members SET membership_status='removed' WHERE league_id='"+club+"' AND user_id='"+member.uid+"'");
  await m.call("membershipDenied");
  await a.call("leave");await a.call("logout");await m.call("logout");await x.call("logout");
  console.log("PASS: actual Chrome independent profiles + real GoTrue/SDK/PostgREST, creation/open/save/deadline/finalize/ranking/revocation/logout; "+calls+" local HTTP requests");
 }finally{
  // One cleanup failure must not leave other browsers or the proxy running.
  const closed=await Promise.allSettled(browsers.map(b=>b.close()));
  if(server.listening){
   await new Promise((resolve,reject)=>{
    server.close(error=>error?reject(error):resolve());
    server.closeAllConnections();
   });
  }
  const failures=closed.filter(result=>result.status==="rejected").map(result=>result.reason);
  if(failures.length)throw new AggregateError(failures,"Chrome fixture cleanup failed");
  console.log("PASS: all browser profiles and local HTTP proxy cleaned up");
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
