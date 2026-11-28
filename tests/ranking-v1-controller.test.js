const test=require("node:test");
const assert=require("node:assert/strict");
const {createRankingController}=require("../prototypes/ranking-v1/controller.cjs");
const {snapshotView,catalogView}=require("../prototypes/ranking-v1/view-model.cjs");
const actorId="00000000-0000-0000-0000-000000000001",leagueId="00000000-0000-0000-0000-000000000010",eventId="event";
const playerId="00000000-0000-0000-0000-000000000011";
const config={version:1,candidates:["a","b","c","d"].map(id=>({id,label:id,multiplierTenths:10}))};
const pick={version:1,candidateIds:["a","b","c","d"]},other={version:1,candidateIds:["b","a","c","d"]};
const base={actorId,leagueId,eventId,name:"Cup",sportType:"baseball",deadline:"2027-01-01T00:00:00Z",config,status:"open",canManage:false,canSubmit:true,predictionsPublic:false,ownPrediction:null,publishedPredictions:[],result:null,ranking:[]};
const rev="a".repeat(32);
const closed={...base,status:"resultWait",canManage:true,canSubmit:false,predictionsPublic:true};
const final={...closed,status:"finalized",result:pick,publishedPredictions:[{playerId,name:"<b>player</b>",prediction:pick}],ranking:[{playerId,name:"<b>player</b>",rank:1,score:25,breakdown:{version:1,scoreTenths:250,breakdown:[10,7,5,3].map((basePoints,i)=>({candidateId:pick.candidateIds[i],predictedRank:i+1,actualRank:i+1,basePoints,multiplierTenths:10,scoreTenths:basePoints*10}))}}]};
function harness(initial=base){
  const calls=[];let snapshot=initial,handler=null;
  const controller=createRankingController({client:{rpc:async(name,args)=>{
    calls.push({name,args});
    if(handler)return handler(name,args);
    return {data:snapshot,error:null};
  }}});
  controller.select({actorId,leagueId,eventId});
  return {controller,calls,set:next=>{snapshot=next;},respond:f=>{handler=f;}};
}
test("view exposes only authorized actions; renders final server score as plain data",()=>{
  const open=snapshotView(base);
  assert.equal(open.actions.save,true);assert.equal(open.actions.edit,false);assert.equal(open.actions.close,false);
  assert.deepEqual(open.publishedPredictions,[]);assert.deepEqual(open.ranking,[]);
  const waiting=snapshotView({...base,canManage:true,canSubmit:false,predictionsPublic:true});
  assert.equal(waiting.actions.close,true);assert.equal(waiting.actions.save,false);
  const done=snapshotView(final);
  assert.equal(done.ranking[0].name,"<b>player</b>");assert.equal(done.ranking[0].score,25);
  assert.equal(done.ranking[0].detail[0].score,10);assert.equal(done.actions.reviewResult,false);
  assert.throws(()=>snapshotView({...base,publishedPredictions:final.publishedPredictions}));
  assert.throws(()=>snapshotView({...final,ranking:[{...final.ranking[0],rank:2}]}));
  assert.throws(()=>snapshotView({...final,ranking:[{...final.ranking[0],score:999}]}));
});
test("catalog preserves server truncation and rejects duplicate IDs",()=>{
  const row={id:eventId,name:"Cup",sport_type:"baseball",status:"open",prediction_deadline:base.deadline};
  assert.equal(catalogView({events:[row],truncated:true}).truncated,true);
  assert.throws(()=>catalogView({events:[row,row],truncated:false}));
});
test("save is server-confirmed then reloaded, no automatic retry",async()=>{
  const h=harness();await h.controller.refresh();
  h.respond(async(name,args)=>name.endsWith("_save")?{data:{actorId,leagueId,eventId,prediction:args.p_prediction}}:{data:{...base,ownPrediction:pick}});
  const view=await h.controller.save(pick);
  assert.deepEqual(view.ownPrediction,pick);
  assert.equal(h.controller.getState().notice,"server_acknowledged_and_reloaded");
  assert.deepEqual(h.calls.map(c=>c.name),["ranking_v1_api_snapshot","ranking_v1_api_save","ranking_v1_api_snapshot"]);
});
test("acknowledged save plus failed reload is not reported as unsaved or success view",async()=>{
  const h=harness();await h.controller.refresh();
  h.respond(async(name,args)=>name.endsWith("_save")?{data:{actorId,leagueId,eventId,prediction:args.p_prediction}}:{error:{message:"network"}});
  await assert.rejects(h.controller.save(pick));
  const state=h.controller.getState();
  assert.equal(state.view,null);assert.equal(state.notice,null);assert.equal(state.error,"confirmed_reload_failed");
  await assert.rejects(h.controller.save(pick),/unavailable/);
});
test("ambiguous save failure clears cached permissions and requires a reload",async()=>{
  const h=harness();await h.controller.refresh();
  h.respond(async()=>({error:{message:"timeout"}}));
  await assert.rejects(h.controller.save(pick));
  assert.equal(h.controller.getState().error,"unconfirmed_reload_required");
  assert.equal(h.calls.length,2);
});
test("scope change and return discards response, including old busy/failure state",async()=>{
  const h=harness();let release;h.respond(()=>new Promise(r=>release=r));
  const pending=h.controller.refresh();
  await assert.rejects(h.controller.refresh(),/in progress/);
  h.controller.select({actorId,leagueId,eventId:"other"});
  h.controller.select({actorId,leagueId,eventId});
  h.respond(async()=>({data:{...base,ownPrediction:other}}));
  await h.controller.refresh();
  release({data:base});
  await assert.rejects(pending,/scope changed/);
  assert.deepEqual(h.controller.getState().view.ownPrediction,other);
  assert.equal(h.controller.getState().error,null);
  h.controller.select(null);assert.equal(h.controller.getState().view,null);
});
test("result review binds exact result and revision; a stale conflict requires fresh review",async()=>{
  const h=harness(closed);await h.controller.refresh();
  await assert.rejects(h.controller.finalize(),/explicit review/);
  h.respond(async(name,args)=>name.endsWith("_review")?{data:{actorId,leagueId,eventId,revision:rev}}:{error:{code:"PT409",message:"stale"}});
  const editable={version:1,candidateIds:[...pick.candidateIds]};
  const reviewed=await h.controller.reviewResult(editable);
  editable.candidateIds.reverse();reviewed.result.candidateIds.reverse();
  await assert.rejects(h.controller.finalize(),e=>e.code==="PT409");
  assert.deepEqual(h.calls.at(-1).args.p_result,pick);
  assert.equal(h.calls.at(-1).args.p_revision,rev);
  assert.equal(h.controller.getState().review,null);
  assert.equal(h.controller.getState().error,"conflict_reload_required");
});
test("draft opening requires explicit review; refresh invalidates review",async()=>{
  const draft={...base,status:"draft",canManage:true,canSubmit:false};
  const h=harness(draft);await h.controller.refresh();
  await assert.rejects(h.controller.open(),/explicit review/);
  h.respond(async()=>({data:{...draft,revision:rev,recovered:false}}));await h.controller.reviewDraft();
  h.respond(async()=>({data:draft}));await h.controller.refresh();
  await assert.rejects(h.controller.open(),/explicit review/);
  h.respond(async(name)=>name.endsWith("_draft_review")?{data:{...draft,revision:rev,recovered:false}}:name.endsWith("_open")?{data:{...draft,status:"open",revision:rev,recovered:false}}:{data:{...base,canManage:true}});
  await h.controller.reviewDraft();assert.equal((await h.controller.open()).status,"open");
});
