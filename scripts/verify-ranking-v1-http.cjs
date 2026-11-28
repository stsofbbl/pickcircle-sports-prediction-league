// Actual SDK + pinned local GoTrue + PostgREST + disposable PostgreSQL.
// No production URL, secret, browser or full production schema.
"use strict";
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {createHmac,randomUUID}=require("node:crypto");
const {execFileSync}=require("node:child_process");
const {createRankingApi}=require("../prototypes/ranking-v1/api-client.cjs");
const {scoreRanking}=require("../prototypes/ranking-v1/contract.cjs");
const {createRankingController}=require("../prototypes/ranking-v1/controller.cjs");
const base=process.env.YOSO_RANKING_HTTP_URL,authBase=process.env.YOSO_RANKING_AUTH_URL,secret=process.env.YOSO_RANKING_HTTP_SECRET;
assert.equal(process.env.GITHUB_ACTIONS,"true");
assert.equal(base,"http://127.0.0.1:39117");
assert.equal(authBase,"http://127.0.0.1:39118");
assert.ok(secret&&process.argv[2]);
const ctx=vm.createContext({console,URL,URLSearchParams,fetch,Headers,Request,Response,AbortController,AbortSignal,TextEncoder,TextDecoder,setTimeout,clearTimeout,setInterval,clearInterval,crypto:globalThis.crypto,WebSocket:globalThis.WebSocket,atob,btoa,Blob,FormData,ArrayBuffer,Uint8Array});
ctx.self=ctx;ctx.window=ctx;
vm.runInContext(fs.readFileSync(process.argv[2],"utf8"),ctx);
const createClient=ctx.supabase?.createClient;
assert.equal(typeof createClient,"function");
const b64=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
function token(claims,key=secret){
  const message=b64({alg:"HS256",typ:"JWT"})+"."+b64({aud:"authenticated",exp:Math.floor(Date.now()/1000)+3600,...claims});
  return message+"."+createHmac("sha256",key).update(message).digest("base64url");
}
const anon=token({role:"anon"});
const wire=[];
function sdk({jwt,storage=new Map()}={}){
  return createClient(base,anon,{
    ...(jwt?{accessToken:async()=>jwt}:{}),
    auth:{persistSession:!jwt,autoRefreshToken:false,detectSessionInUrl:false,
      storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}},
    global:{fetch:async(input,init)=>{
      const url=new URL(typeof input==="string"?input:input.url||input.href);
      assert.equal(url.origin,base,"non-local request");
      const auth=url.pathname.startsWith("/auth/v1/");
      assert.ok(auth||url.pathname.startsWith("/rest/v1/"),"unexpected endpoint");
      const dest=new URL((auth?authBase:base)+url.pathname.slice(auth?8:8)+url.search);
      wire.push({method:init?.method||"GET",path:url.pathname});
      const response=await fetch(dest,{...init,signal:AbortSignal.timeout(10000)});
      if(!auth&&!response.ok){
        const body=await response.clone().json().catch(()=>({}));
        console.log("HTTP rejection",url.pathname,response.status,JSON.stringify({code:body.code,message:body.message}));
      }
      return response;
    }}
  });
}
function ok(r){if(r.error)throw Error(JSON.stringify(r.error));return r.data;}
const plain=x=>JSON.parse(JSON.stringify(x));
const club="00000000-0000-0000-0000-000000000010",otherClub="00000000-0000-0000-0000-000000000020";
const config={version:1,candidates:["a","b","c","d","e","f"].map((id,i)=>({id,label:id.toUpperCase(),multiplierTenths:10+i*3}))};
const pick=(...candidateIds)=>({version:1,candidateIds});
const first=pick("a","b","c","d"),second=pick("b","a","d","c");
function sql(s){return execFileSync("sudo",["-u","postgres","psql","-X","-qAt","-v","ON_ERROR_STOP=1","-d","yoso_ranking_v1_test","-c",s],{encoding:"utf8",timeout:10000}).trim();}
const uuid=/^[0-9a-f-]{36}$/;
function seed(uid,role,league,name){
  assert.match(uid,uuid);assert.match(league,uuid);assert.ok(["owner","member"].includes(role));assert.ok(["HTTP owner","HTTP member","HTTP outsider"].includes(name));
  sql("BEGIN; INSERT INTO auth.users(id) VALUES('"+uid+"'); INSERT INTO public.profiles(id,auth_user_id,display_name) VALUES('"+uid+"','"+uid+"','"+name+"'); INSERT INTO public.league_members(league_id,user_id,role,membership_status) VALUES('"+league+"','"+uid+"','"+role+"','active'); INSERT INTO public.players(id,league_id,profile_id,display_name,is_admin) VALUES('"+randomUUID()+"','"+league+"','"+uid+"','"+name+"',"+(role==="owner")+"); COMMIT;");
}
function service(client,actorId,leagueId,eventId){
  let scope={actorId,leagueId,eventId,generation:1};
  return {client,api:createRankingApi({client,getScope:()=>scope}),scope:()=>scope,change:patch=>{scope={...scope,...patch,generation:scope.generation+1};}};
}
async function account(name,role,league){
  const storage=new Map(),client=sdk({storage}),email=randomUUID()+"@example.com",password="Fixture-"+randomUUID();
  const signup=ok(await client.auth.signUp({email,password,options:{data:{role:"owner"}}}));
  assert.ok(signup.user?.id&&signup.session?.access_token,"GoTrue signup did not return a session");
  seed(signup.user.id,role,league,name);
  ok(await client.auth.signOut());
  const login=ok(await client.auth.signInWithPassword({email,password}));
  assert.equal(login.user.id,signup.user.id);
  return {client,storage,uid:login.user.id};
}
async function main(){
  const [owner,member,outsider]=await Promise.all([account("HTTP owner","owner",club),account("HTTP member","member",club),account("HTTP outsider","owner",otherClub)]);
  const event=randomUUID();
  const a=service(owner.client,owner.uid,club,event),m=service(member.client,member.uid,club,event),x=service(outsider.client,outsider.uid,club,event);
  const denied=e=>e?.code==="42501";
  const stale=e=>{assert.equal(e?.code,"PT409",JSON.stringify({code:e?.code,message:e?.message}));assert.equal(e?.message,"ranking draft stale");return true;};
  const input={name:"HTTP ranking fixture",sportType:"baseball",deadline:new Date(Date.now()+40000).toISOString(),config};
  await assert.rejects(m.api.createDraft(input),denied);
  const created=await a.api.createDraft(input);
  assert.equal(created.status,"draft");
  assert.equal((await a.api.createDraft(input)).recovered,true);
  assert.ok((await m.api.list()).events.some(e=>e.id===event));
  assert.equal((await m.api.snapshot()).canSubmit,false);
  await assert.rejects(m.api.save(first,config),denied);
  await assert.rejects(x.api.snapshot(),denied);
  const reviewed=await a.api.draftReview();
  const changed={...input,name:"HTTP ranking edited"};
  const edited=await a.api.editDraft(reviewed.revision,changed);
  const staleStart=Date.now();
  await assert.rejects(a.api.open(reviewed.revision),stale);
  assert.ok(Date.now()-staleStart<5000,"business conflict did not return promptly");
  assert.equal((await a.api.snapshot()).status,"draft");
  console.log("PASS: stale draft HTTP conflict returned promptly without opening");
  await assert.rejects(m.api.open(edited.revision),denied);
  assert.equal((await a.api.open(edited.revision)).status,"open");
  assert.equal((await a.api.open(edited.revision)).recovered,true);
  const deniedMetadata=async payload=>{
    const response=await owner.client.from("events").update(payload).eq("id",event);
    assert.equal(response.error?.code,"42501","direct metadata write must be denied");
  };
  await deniedMetadata({name:"HTTP bypass"});
  await deniedMetadata({rules_config:{bypass:true}});
  assert.equal((await a.api.open(edited.revision)).recovered,true);
  await assert.rejects(a.api.close(),denied);
  await Promise.all([a.api.save(first,config),m.api.save(second,config)]);
  const memberView=createRankingController({client:member.client});
  memberView.select({actorId:member.uid,leagueId:club,eventId:event});
  assert.ok((await memberView.list()).items.some(e=>e.eventId===event));
  const privateView=await memberView.refresh();
  assert.deepEqual(plain(privateView.ownPrediction),second);
  assert.equal(privateView.actions.save,true);
  assert.equal(privateView.publishedPredictions.length,0);
  assert.equal((await memberView.save(second)).ownPrediction.candidateIds[0],"b");
  const before=await m.api.snapshot();
  assert.deepEqual(plain(before.ownPrediction),second);
  assert.equal(before.predictionsPublic,false);
  assert.equal(before.publishedPredictions.length,0);
  const direct=ok(await member.client.from("predictions").select("user_id,payload").eq("event_id",event));
  assert.equal(direct.length,1);
  assert.equal(direct[0].user_id,member.uid);
  await assert.rejects(m.api.review(),denied);
  const raw=await member.client.rpc("ranking_v1_api_save",{p_league_id:club,p_event_id:event,p_actor_id:owner.uid,p_prediction:first});
  assert.equal(raw.error?.code,"42501");
  const refreshed=ok(await member.client.auth.refreshSession());
  assert.equal(refreshed.user.id,member.uid);
  // Another SDK instance reconstructs the persisted real session.
  const resumed=sdk({storage:member.storage});
  assert.equal(ok(await resumed.auth.getUser()).user.id,member.uid);
  const m2=service(resumed,member.uid,club,event);
  assert.deepEqual(plain((await m2.api.snapshot()).ownPrediction),second);
  const forged=sdk({jwt:token({sub:owner.uid,role:"authenticated"},"wrong-signature")});
  const expired=sdk({jwt:token({sub:owner.uid,role:"authenticated",exp:Math.floor(Date.now()/1000)-3600})});
  for(const c of [forged,expired,sdk()]){
    const r=await c.rpc("ranking_v1_api_snapshot",{p_league_id:club,p_event_id:event,p_actor_id:owner.uid});
    assert.ok(r.error,"invalid/anonymous token accessed snapshot");
  }
  const wait=Math.max(0,Date.parse(input.deadline)-Date.now()+500);
  assert.ok(wait<=40500);await new Promise(resolve=>setTimeout(resolve,wait));
  assert.equal((await m2.api.snapshot()).predictionsPublic,true);
  await assert.rejects(m2.api.save(first,config),denied);
  assert.equal((await a.api.close()).status,"resultWait");
  assert.equal((await a.api.close()).recovered,true);
  await deniedMetadata({name:"Closed bypass"});
  const managerView=createRankingController({client:owner.client});
  managerView.select({actorId:owner.uid,leagueId:club,eventId:event});
  assert.equal((await managerView.refresh()).actions.reviewResult,true);
  const finalReview=await managerView.reviewResult(first);
  await assert.rejects(m2.api.finalize(finalReview.revision,first,config),denied);
  const rendered=await managerView.finalize();
  assert.equal(rendered.status,"finalized");
  await deniedMetadata({name:"Finalized bypass"});
  await deniedMetadata({archived_at:new Date().toISOString()});
  assert.equal(rendered.ranking.length,2);
  assert.deepEqual(plain(rendered.ranking.map(r=>r.score)),[first,second].map(prediction=>scoreRanking({config,prediction,result:first}).scoreTenths/10).sort((a,b)=>b-a));
  assert.equal((await a.api.finalize(finalReview.revision,first,config)).recovered,true);
  await assert.rejects(a.api.finalize(finalReview.revision,second,config),e=>e?.code==="PT409"&&e?.message==="ranking already finalized with different review or result");
  const [sa,sm]=await Promise.all([a.api.snapshot(),m2.api.snapshot()]);
  assert.deepEqual(plain(sa.ranking),plain(sm.ranking));
  assert.equal(sm.status,"finalized");
  assert.equal(sm.ranking.length,2);
  const expected=[first,second].map(prediction=>scoreRanking({config,prediction,result:first}).scoreTenths/10).sort((a,b)=>b-a);
  assert.deepEqual(plain(sm.ranking.map(r=>r.score)),expected);
  assert.deepEqual(plain(sm.ranking.map(r=>r.rank)),[1,2]);
  const altered=await owner.client.from("scores").update({phase1_score:999}).eq("event_id",event);
  assert.equal(altered.error?.code,"42501");
  assert.deepEqual(plain((await a.api.snapshot()).ranking.map(r=>r.score)),expected);
  assert.match(member.uid,uuid);
  sql("UPDATE public.league_members SET membership_status='removed' WHERE league_id='"+club+"' AND user_id='"+member.uid+"'");
  await assert.rejects(m2.api.snapshot(),denied);
  assert.equal((await a.api.snapshot()).ranking.length,2);
  await assert.rejects(memberView.refresh(),denied);
  assert.equal(memberView.getState().view,null);
  console.log("PASS: online ranking view controller via real HTTP, save/review/finalize, denied membership clears view");
  ok(await resumed.auth.signOut());
  await assert.rejects(m2.api.snapshot());
  const rpcNames=new Set(wire.filter(w=>w.path.startsWith("/rest/v1/rpc/ranking_v1_api_")).map(w=>w.path.split("/").at(-1)));
  assert.equal(rpcNames.size,10);
  console.log("PASS: real GoTrue login + SDK + PostgREST, all 10 RPCs, two participants, deadline, ranking, retry, revoked membership; "+wire.length+" local HTTP requests");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
