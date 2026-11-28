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

test("management create retains exact caller-provided ID and rejects mismatched draft responses",async()=>{
  const h=harness(),id="a0000000-0000-4000-8000-000000000001";
  const input={name:"Cup",sportType:"baseball",deadline:"2027-01-01T12:00:00+09:00",config};
  h.change({eventId:id});
  const data={actorId,leagueId,eventId:id,...input,deadline:"2027-01-01T03:00:00.000Z",status:"draft",revision,recovered:false};
  h.respond(async()=>({data}));
  await h.api.createDraft(input);
  assert.deepEqual(h.calls[0].args,{p_actor_id:actorId,p_league_id:leagueId,p_event_id:id,p_name:"Cup",p_sport:"baseball",p_deadline:data.deadline,p_config:config});
  h.respond(async()=>({data:{...data,recovered:true}}));
  assert.equal((await h.api.createDraft(input)).recovered,true);
  h.respond(async()=>({data:{...data,name:"Wrong"}}));
  await assert.rejects(h.api.createDraft(input),/draft response mismatch/);
  assert.throws(()=>h.api.createDraft({...input,deadline:"2027-01-01T12:00:00"}));
});
test("reviewed revision is preserved for edit and open; stale response fails",async()=>{
  const h=harness(),input={name:"Cup",sportType:"baseball",deadline:"2027-01-01T03:00:00Z",config};
  const data={actorId,leagueId,eventId,...input,status:"draft",revision,recovered:false};
  h.respond(async()=>({data}));await h.api.draftReview();
  await h.api.editDraft(revision,input);assert.equal(h.calls[1].args.p_revision,revision);
  h.respond(async()=>({data:{...data,status:"open",revision:"b".repeat(32)}}));
  await assert.rejects(h.api.open(revision),/revision mismatch/);
  h.respond(async()=>({data:{...data,status:"open"}}));await h.api.open(revision);
  h.respond(async()=>({data:{...data,status:"resultWait"}}));await h.api.close();
});
