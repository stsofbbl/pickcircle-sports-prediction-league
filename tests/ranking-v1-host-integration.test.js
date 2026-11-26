const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const app=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
function extract(start,end){
 const a=app.indexOf(start),b=app.indexOf(end,a+start.length);
 assert.ok(a>=0&&b>a);return app.slice(a,b);
}
function harness(){
 let calls=[],selected="club-a",user={id:"actor",provider:"supabase"},page="active";
 const ctx=vm.createContext({calls,window:{YosoSupabase:{config:()=>({activeLeagueId:selected})}},
  currentAuthUser:()=>user,currentPageId:()=>page,els:{pages:[],navLinks:[]},requestAnimationFrame:()=>{},
  YosoRankingV1:{enabled:false,sync:s=>calls.push(s),invalidate:()=>calls.push("invalidate")},
  lastRenderedPageId:"",onlineLeagueId:"club-a",authRecoveryMode:false,onlineAuthUser:user,
  loadedKoshienOnlineEventId:"old",lastKoshienOnlineLoadUserId:"old"});
 vm.runInContext(extract("function rankingV1HostContext()","function applyTheme(")+extract("function applyOnlineAuthUser(","async function bootstrapSupabaseAuth("),ctx);
 return {ctx,calls,run:s=>vm.runInContext(s,ctx),select:s=>selected=s,page:p=>page=p,user:u=>user=u};
}
test("real renderPage skips ranking context reads and sync while disabled",()=>{
 const h=harness();
 h.ctx.currentAuthUser=()=>{throw Error("disabled path read auth");};
 h.run("renderPage()");
 assert.deepEqual(h.calls,[]);
});
test("real host context denies mismatched club and preserves current page",()=>{
 const h=harness();h.ctx.YosoRankingV1.enabled=true;
 h.run("renderPage()");
 assert.equal(h.calls[0].leagueId,"club-a");
 h.select("club-b");h.page("home");h.run("renderPage()");
 assert.equal(h.calls[1].leagueId,"");assert.equal(h.calls[1].page,"home");
});
test("real auth identity change invalidates ranking before changing user",()=>{
 const h=harness();
 h.run("applyOnlineAuthUser({id:'other',provider:'supabase'})");
 assert.deepEqual(h.calls,["invalidate"]);
 assert.equal(h.ctx.onlineAuthUser.id,"other");
 assert.equal(h.ctx.loadedKoshienOnlineEventId,"");
});
