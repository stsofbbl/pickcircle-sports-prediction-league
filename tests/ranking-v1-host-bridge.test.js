const test=require("node:test");
const assert=require("node:assert/strict");
const {createRankingHostBridge}=require("../prototypes/ranking-v1/host-bridge.cjs");
const actorId="00000000-0000-0000-0000-000000000001",leagueId="00000000-0000-0000-0000-000000000010";
const other="00000000-0000-0000-0000-000000000020";
function harness(){
 let context={actorId,leagueId,provider:"supabase"},user={id:actorId},clubs=[{league_id:leagueId,membership_role:"owner"}];
 const calls=[],client={rpc(){}};
 const root={children:[],ownerDocument:{createElement:()=>({setAttribute(){},textContent:""})},replaceChildren(...nodes){this.children=nodes;}};
 const host=createRankingHostBridge({root,getHostContext:()=>context,
  supabase:{client:async()=>{calls.push("client");return client;},sessionUser:async()=>{calls.push("user");return user;}},
  dataService:{isAuthEnabled:()=>true,league:{listMyClubs:async()=>{calls.push("clubs");return typeof clubs==="function"?clubs():clubs;}}},
  mount:(r,options)=>{assert.equal(options.client,client);calls.push("mount");return {setContext:async s=>{calls.push(s);r.replaceChildren({textContent:"private view"});},dispose:()=>{calls.push("dispose");r.replaceChildren();}};}});
 return {host,root,calls,context:x=>{context=x;},user:x=>{user=x;},clubs:x=>{clubs=x;}};
}
test("existing client reused, role derived only from selected club membership",async()=>{
 const h=harness();h.clubs([{league_id:leagueId,membership_role:"member"},{league_id:other,membership_role:"owner"}]);
 h.user({id:actorId,user_metadata:{role:"owner"}});
 assert.equal(await h.host.open(),true);
 assert.deepEqual(h.calls,["client","user","clubs","user","mount",{actorId,leagueId,canManage:false}]);
 h.host.invalidate();assert.deepEqual(h.root.children,[]);assert.equal(h.calls.at(-1),"dispose");
});
test("local identity and password recovery never request ranking RPC or client",async()=>{
 const h=harness();h.context({actorId,leagueId,provider:"local"});
 assert.equal(await h.host.open(),false);
 h.context({actorId,leagueId,provider:"supabase",authRecoveryMode:true});
 assert.equal(await h.host.open(),false);assert.deepEqual(h.calls,[]);
});
test("missing membership or changed authenticated identity denies mounting",async()=>{
 const h=harness();h.clubs([{league_id:other,membership_role:"owner"}]);
 assert.equal(await h.host.open(),false);assert.ok(!h.calls.includes("mount"));
 h.clubs([{league_id:leagueId,membership_role:"owner"}]);h.user({id:other});
 assert.equal(await h.host.open(),false);assert.ok(!h.calls.includes("mount"));
});
test("slow prior club response cannot remount after logout or club switch",async()=>{
 const h=harness();let resolve;h.clubs(()=>new Promise(r=>resolve=r));
 const a=h.host.open();
 while(!resolve)await Promise.resolve();
 h.context(null);h.host.invalidate();
 resolve([{league_id:leagueId,membership_role:"owner"}]);
 assert.equal(await a,false);assert.deepEqual(h.root.children,[]);assert.ok(!h.calls.includes("mount"));
});
test("actor changes during membership lookup are rejected even with unchanged host context",async()=>{
 const h=harness();h.clubs(()=>{h.user({id:other});return [{league_id:leagueId,membership_role:"owner"}];});
 assert.equal(await h.host.open(),false);assert.ok(!h.calls.includes("mount"));
});
test("old async request cannot clear a newly mounted scope",async()=>{
 const h=harness();let resolve;h.clubs(()=>new Promise(r=>resolve=r));
 const a=h.host.open();while(!resolve)await Promise.resolve();
 h.context({actorId,leagueId:other,provider:"supabase"});h.clubs([{league_id:other,membership_role:"co_owner"}]);
 assert.equal(await h.host.open(),true);
 resolve([{league_id:leagueId,membership_role:"owner"}]);assert.equal(await a,false);
 assert.equal(h.root.children[0].textContent,"private view");
 assert.deepEqual(h.calls.at(-1),{actorId,leagueId:other,canManage:true});
 h.host.dispose();assert.equal(await h.host.open(),false);
});
