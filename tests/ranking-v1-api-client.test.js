const test=require("node:test");
const assert=require("node:assert/strict");
const {createRankingApi}=require("../prototypes/ranking-v1/api-client.cjs");
const actorId="00000000-0000-0000-0000-000000000001",leagueId="00000000-0000-0000-0000-000000000010",eventId="event";
const config={version:1,candidates:["a","b","c","d"].map(id=>({id,label:id,multiplierTenths:10}))};
const prediction={version:1,candidateIds:["a","b","c","d"]};
const revision="a".repeat(32);
function harness(){
  let scope={actorId,leagueId,eventId,generation:1};
  const calls=[];
  let handler=async()=>({data:{actorId,leagueId,eventId,prediction},error:null});
  const api=createRankingApi({getScope:()=>scope,client:{rpc:(name,args)=>{calls.push({name,args});return handler(name,args);}}});
  return {api,calls,change:patch=>{scope={...scope,...patch};},respond:fn=>{handler=fn;}};
}
test("save sends explicit expected identity and validated prediction only",async()=>{
  const h=harness();await h.api.save(prediction,config);
  assert.deepEqual(h.calls,[{name:"ranking_v1_api_save",args:{p_league_id:leagueId,p_actor_id:actorId,p_event_id:eventId,p_prediction:prediction}}]);
  assert.throws(()=>h.api.save({...prediction,score:100},config));assert.equal(h.calls.length,1);
});
test("stale response discarded even when event switches away and back",async()=>{
  const h=harness();let resolve;h.respond(()=>new Promise(r=>resolve=r));
  const pending=h.api.save(prediction,config);
  h.change({eventId:"other",generation:2});h.change({eventId,generation:3});
  resolve({data:{actorId,leagueId,eventId,prediction},error:null});
  await assert.rejects(pending,/scope changed/);
});
test("mismatched actor, club, event or saved value never reports success",async()=>{
  for(const data of [{actorId:"wrong"},{leagueId:"wrong"},{eventId:"wrong"},{prediction:{version:1,candidateIds:["b","a","c","d"]}}]){
    const h=harness();h.respond(async()=>({data:{actorId,leagueId,eventId,prediction,...data},error:null}));
    await assert.rejects(h.api.save(prediction,config));
  }
});
test("server errors propagate without retry or local fallback",async()=>{
  const h=harness();h.respond(async()=>({error:{code:"42501",message:"denied"}}));
  await assert.rejects(h.api.save(prediction,config),e=>e.code==="42501");assert.equal(h.calls.length,1);
});
test("snapshot rejects early publication and malformed final response",async()=>{
  const h=harness();const base={actorId,leagueId,eventId,config,status:"open",canManage:false,canSubmit:true,predictionsPublic:false,ownPrediction:prediction,publishedPredictions:[],ranking:[],result:null};
  h.respond(async()=>({data:base}));assert.deepEqual(await h.api.snapshot(),base);
  h.respond(async()=>({data:{...base,publishedPredictions:[{}]}}));await assert.rejects(h.api.snapshot(),/publication/);
  h.respond(async()=>({data:{...base,status:"finalized"}}));await assert.rejects(h.api.snapshot());
});
test("review and finalize preserve reviewed revision and exact result, not score",async()=>{
  const h=harness();h.respond(async()=>({data:{actorId,leagueId,eventId,revision}}));
  assert.equal((await h.api.review()).revision,revision);
  h.respond(async()=>({data:{actorId,leagueId,eventId,status:"finalized",scoreCount:2,recovered:false}}));
  await h.api.finalize(revision,prediction,config);
  assert.deepEqual(h.calls[1].args,{p_league_id:leagueId,p_actor_id:actorId,p_event_id:eventId,p_revision:revision,p_result:prediction});
});
