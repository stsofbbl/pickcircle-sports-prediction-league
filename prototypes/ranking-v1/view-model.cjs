// Review-only view adapter. No DOM, HTML, local storage or local score calculation.
"use strict";
const {validateConfig,validatePrediction,validateResult}=require("./contract.cjs");
function need(ok,message){if(!ok)throw new Error(message);}
const statuses=["draft","open","resultWait","finalized"];
const names={draft:"準備中",open:"予想受付中",resultWait:"結果待ち",finalized:"結果確定"};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text=(s,max=120)=>typeof s==="string"&&s.length>0&&s.length<=max;
function eventFields(id,name,sportType,status,deadline){
  need(text(id,128)&&text(name,240)&&text(sportType,32)&&statuses.includes(status)
    &&typeof deadline==="string"&&Number.isFinite(Date.parse(deadline)),"invalid event display");
  return {eventId:id,name,sportType,status,deadline};
}
function catalogView(data){
  need(Array.isArray(data.events)&&data.events.length<=100&&typeof data.truncated==="boolean","invalid catalog");
  const seen=new Set();
  const items=data.events.map(e=>{
    const item=eventFields(e.id,e.name,e.sport_type,e.status,e.prediction_deadline);
    need(!seen.has(item.eventId),"duplicate event");seen.add(item.eventId);
    return {...item,statusLabel:names[item.status]};
  });
  return {items,truncated:data.truncated};
}
function snapshotView(s){
  const event=eventFields(s.eventId,s.name,s.sportType,s.status,s.deadline);
  const config=validateConfig(s.config);
  const byId=new Map(config.candidates.map(c=>[c.id,c]));
  const displayOrder=p=>p.candidateIds.map((id,index)=>({rank:index+1,candidateId:id,label:byId.get(id).label}));
  need(typeof s.canManage==="boolean"&&typeof s.canSubmit==="boolean"&&typeof s.predictionsPublic==="boolean","invalid permissions");
  need(!s.canSubmit||(s.status==="open"&&!s.predictionsPublic),"inconsistent submission state");
  need(s.status!=="draft"||(!s.predictionsPublic&&!s.canSubmit&&s.ownPrediction===null),"invalid draft state");
  need(!["resultWait","finalized"].includes(s.status)||s.predictionsPublic,"missing publication");
  need(Array.isArray(s.publishedPredictions)&&s.publishedPredictions.length<=200&&Array.isArray(s.ranking)&&s.ranking.length<=200,"invalid display lists");
  need(s.predictionsPublic||s.publishedPredictions.length===0,"unexpected prediction publication");
  const own=s.ownPrediction===null?null:validatePrediction(s.ownPrediction,config);
  const submitted=new Map();
  const published=s.publishedPredictions.map(p=>{
    need(uuid.test(p.playerId)&&text(p.name,1000)&&!submitted.has(p.playerId),"invalid published player");
    const prediction=validatePrediction(p.prediction,config);
    submitted.set(p.playerId,prediction);
    return {playerId:p.playerId,name:p.name,picks:displayOrder(prediction)};
  });
  let result=null,ranking=[];
  if(s.status==="finalized"){
    need(s.ranking.length===submitted.size&&submitted.size>0,"incomplete ranking");
    result=displayOrder(validateResult(s.result,config));
    const seen=new Set();let previous=Infinity,lastRank=0;
    ranking=s.ranking.map((r,i)=>{
      need(submitted.has(r.playerId)&&!seen.has(r.playerId)&&text(r.name,1000)&&Number.isFinite(r.score)&&r.score>=0&&r.score<=2500,"invalid ranked player");
      seen.add(r.playerId);
      need(r.score<=previous&&r.rank===(r.score===previous?lastRank:i+1),"inconsistent server rank");
      previous=r.score;lastRank=r.rank;
      const b=r.breakdown;
      need(b&&b.version===1&&Number.isSafeInteger(b.scoreTenths)&&b.scoreTenths>=0&&b.scoreTenths/10===r.score
        &&Array.isArray(b.breakdown)&&b.breakdown.length===4,"invalid score breakdown");
      let total=0;
      const detail=b.breakdown.map((d,j)=>{
        const id=submitted.get(r.playerId).candidateIds[j];
        need(d.candidateId===id&&d.predictedRank===j+1
          &&(d.actualRank===null||Number.isInteger(d.actualRank)&&d.actualRank>=1&&d.actualRank<=4)
          &&Number.isSafeInteger(d.basePoints)&&d.basePoints>=0&&d.basePoints<=10
          &&d.multiplierTenths===byId.get(id).multiplierTenths
          &&Number.isSafeInteger(d.scoreTenths)&&d.scoreTenths>=0,"invalid score detail");
        total+=d.scoreTenths;
        return {candidateId:id,label:byId.get(id).label,predictedRank:d.predictedRank,actualRank:d.actualRank,
          basePoints:d.basePoints,multiplier:d.multiplierTenths/10,score:d.scoreTenths/10};
      });
      need(total===b.scoreTenths,"inconsistent score detail");
      return {playerId:r.playerId,name:r.name,rank:r.rank,score:r.score,detail};
    });
  }else need(s.result===null&&s.ranking.length===0,"unconfirmed result");
  return {...event,statusLabel:s.status==="open"&&s.predictionsPublic?"締切・結果待ち":names[s.status],config,
    candidates:config.candidates.map(c=>({id:c.id,label:c.label,multiplier:c.multiplierTenths/10})),
    ownPrediction:own,ownPicks:own?displayOrder(own):[],publishedPredictions:published,
    predictionsPublic:s.predictionsPublic,result,ranking,
    actions:{save:s.canSubmit,edit:s.canManage&&s.status==="draft",open:s.canManage&&s.status==="draft",
      close:s.canManage&&s.status==="open"&&s.predictionsPublic,reviewResult:s.canManage&&s.status==="resultWait"}};
}
module.exports={catalogView,snapshotView};
