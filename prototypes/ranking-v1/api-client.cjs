// Review-only transport; not imported by app.js. Supabase-compatible rpc
// client and a caller-owned monotonic selection generation are injected.
"use strict";
const { validateConfig, validatePrediction, validateResult } = require("./contract.cjs");
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REV=/^[0-9a-f]{32}$/;
function need(condition,message){if(!condition)throw new Error(message);}
function createRankingApi({client,getScope}){
  need(client&&typeof client.rpc==="function"&&typeof getScope==="function","ranking API unavailable");
  const capture=()=>{
    const s=getScope();
    need(s&&UUID.test(s.actorId)&&UUID.test(s.leagueId)&&Number.isSafeInteger(s.generation),"ranking scope unavailable");
    return {actorId:s.actorId,leagueId:s.leagueId,generation:s.generation,eventId:s.eventId??null};
  };
  const assertCurrent=s=>{
    const n=capture();
    need(n.actorId===s.actorId&&n.leagueId===s.leagueId&&n.generation===s.generation&&n.eventId===s.eventId,"ranking scope changed");
  };
  async function call(name,extra={},event=false,check=()=>{}){
    const s=capture();
    if(event)need(typeof s.eventId==="string"&&s.eventId.length>0&&s.eventId.length<=128,"ranking event required");
    const args={p_league_id:s.leagueId,p_actor_id:s.actorId,...(event?{p_event_id:s.eventId}:{}),...extra};
    assertCurrent(s);
    const {data,error}=await client.rpc(name,args);
    assertCurrent(s);
    if(error)throw error;
    need(data&&data.actorId===s.actorId&&data.leagueId===s.leagueId&&(!event||data.eventId===s.eventId),"ranking response scope mismatch");
    check(data);
    return data;
  }
  return Object.freeze({
    list:()=>call("ranking_v1_api_list",{},false,data=>{
      need(Array.isArray(data.events)&&data.events.length<=100&&typeof data.truncated==="boolean","invalid ranking catalog");
    }),
    snapshot:()=>call("ranking_v1_api_snapshot",{},true,data=>{
      const config=validateConfig(data.config);
      need(["draft","open","resultWait","finalized"].includes(data.status)&&typeof data.predictionsPublic==="boolean"
        &&typeof data.canSubmit==="boolean"&&typeof data.canManage==="boolean"&&Array.isArray(data.ranking)&&Array.isArray(data.publishedPredictions),"invalid ranking snapshot");
      if(data.ownPrediction!==null)validatePrediction(data.ownPrediction,config);
      if(!data.predictionsPublic)need(data.publishedPredictions.length===0,"unexpected prediction publication");
      if(data.status==="finalized"){
        validateResult(data.result,config);
        need(data.predictionsPublic&&data.ranking.length===data.publishedPredictions.length,"incomplete final ranking");
      }else need(data.result===null&&data.ranking.length===0,"unexpected ranking result");
    }),
    save:(prediction,config)=>{
      const p=validatePrediction(prediction,config);
      return call("ranking_v1_api_save",{p_prediction:p},true,data=>{
        const returned=validatePrediction(data.prediction,config);
        need(returned.candidateIds.every((id,i)=>id===p.candidateIds[i]),"ranking save not confirmed");
      });
    },
    review:()=>call("ranking_v1_api_review",{},true,data=>need(typeof data.revision==="string"&&REV.test(data.revision),"invalid ranking revision")),
    finalize:(revision,result,config)=>{
      need(typeof revision==="string"&&REV.test(revision),"invalid ranking revision");
      const p=validateResult(result,config);
      return call("ranking_v1_api_finalize",{p_revision:revision,p_result:p},true,data=>{
        need(data.status==="finalized"&&Number.isSafeInteger(data.scoreCount)&&data.scoreCount>0&&typeof data.recovered==="boolean","ranking finalization not confirmed");
      });
    }
  });
}
module.exports={createRankingApi};
