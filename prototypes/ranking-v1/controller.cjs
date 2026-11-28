// Review-only controller for the future online ranking page.
// One operation per scope, no local fallback, no implicit confirmation or retries.
"use strict";
const {createRankingApi}=require("./api-client.cjs");
const {validateResult}=require("./contract.cjs");
const {catalogView,snapshotView}=require("./view-model.cjs");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const copy=v=>JSON.parse(JSON.stringify(v));
function need(ok,message){if(!ok)throw new Error(message);}
function createRankingController({client}){
  let scope=null,generation=0;
  let state={catalog:null,view:null,review:null,busy:null,error:null,notice:null};
  const api=createRankingApi({client,getScope:()=>scope});
  const reset=()=>{state={catalog:null,view:null,review:null,busy:null,error:null,notice:null};};
  function select(next){
    if(next===null){scope=null;generation++;reset();return;}
    need(next&&typeof next.actorId==="string"&&uuid.test(next.actorId)&&typeof next.leagueId==="string"&&uuid.test(next.leagueId),"invalid selection");
    const eventId=next.eventId??null;
    need(eventId===null||typeof eventId==="string"&&eventId.length>0&&eventId.length<=128,"invalid event selection");
    scope={actorId:next.actorId,leagueId:next.leagueId,eventId,generation:++generation};reset();
  }
  function current(s){need(scope===s,"ranking selection changed");}
  function errorKind(error,mutation,acknowledged){
    if(acknowledged)return "confirmed_reload_failed";
    if(error?.code==="PT409")return "conflict_reload_required";
    if(error?.code==="42501")return "denied_reload_required";
    if(mutation)return "unconfirmed_reload_required";
    return "load_failed";
  }
  async function run(name,operation,{mutation=false,keepReview=false}={}){
    need(scope!==null,"ranking selection required");
    need(!state.busy,"ranking operation in progress");
    const s=scope;
    state.busy=name;state.error=null;state.notice=null;
    if(!keepReview)state.review=null;
    let acknowledged=false;
    try{
      const value=await operation(s,()=>{acknowledged=true;});
      current(s);return copy(value);
    }catch(error){
      if(scope===s){
        state.view=null;state.catalog=null;state.review=null;
        state.error=errorKind(error,mutation,acknowledged);
      }
      throw error;
    }finally{
      if(scope===s)state.busy=null;
    }
  }
  async function read(s){
    const raw=await api.snapshot();current(s);
    const view=snapshotView(raw);state.view=view;return view;
  }
  function requireAction(action){
    need(state.view?.actions?.[action]===true,"ranking action unavailable");
    return state.view;
  }
  function requireReview(kind){
    need(state.review?.kind===kind,"explicit review required");
    return state.review;
  }
  async function mutate(name,call){
    return run(name,async(s,ack)=>{
      await call();current(s);ack();
      const view=await read(s);
      state.notice="server_acknowledged_and_reloaded";return view;
    },{mutation:true});
  }
  return Object.freeze({
    select,
    getState:()=>copy(state),
    list:()=>run("list",async s=>{
      const data=await api.list();current(s);
      state.catalog=catalogView(data);return state.catalog;
    }),
    refresh:()=>run("refresh",read),
    createDraft:async input=>{
      need(!state.view,"select a new creation ID first");
      return mutate("createDraft",()=>api.createDraft(input));
    },
    save:async prediction=>{
      const {config}=requireAction("save");
      return mutate("save",()=>api.save(prediction,config));
    },
    reviewDraft:async()=>{
      requireAction("edit");
      return run("reviewDraft",async s=>{
        const d=await api.draftReview();current(s);
        state.review={kind:"draft",revision:d.revision,config:d.config,name:d.name,sportType:d.sportType,deadline:d.deadline};
        return state.review;
      });
    },
    editDraft:async input=>{
      requireAction("edit");const {revision}=requireReview("draft");
      return mutate("editDraft",()=>api.editDraft(revision,input));
    },
    open:async()=>{
      requireAction("open");const {revision}=requireReview("draft");
      return mutate("open",()=>api.open(revision));
    },
    close:async()=>{
      requireAction("close");return mutate("close",()=>api.close());
    },
    reviewResult:async result=>{
      const {config}=requireAction("reviewResult");
      const reviewed=validateResult(result,config);
      return run("reviewResult",async s=>{
        const d=await api.review();current(s);
        state.review={kind:"result",revision:d.revision,result:reviewed};
        return state.review;
      });
    },
    finalize:async()=>{
      const {config}=requireAction("reviewResult");
      const {revision,result}=requireReview("result");
      return mutate("finalize",()=>api.finalize(revision,result,config));
    }
  });
}
module.exports={createRankingController};
