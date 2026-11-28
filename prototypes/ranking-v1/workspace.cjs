// Review-only navigation/creation shell. Role hint is not authorization.
"use strict";
const {createRankingController}=require("./controller.cjs");
const {mountRankingPanel}=require("./panel.cjs");
const {mountDraftForm}=require("./draft-form.cjs");
const {createCreationJournal}=require("./creation-journal.cjs");
function mountRankingWorkspace(root,{client,newId=()=>globalThis.crypto.randomUUID(),storage}){
  if(storage===undefined){try{storage=root.ownerDocument.defaultView.sessionStorage;}catch(_){storage=null;}}
  const journal=createCreationJournal(storage);
  const controller=createRankingController({client}),doc=root.ownerDocument;
  let context=null,epoch=0,busy=false,mode="catalog",pending=null,message="",panel=null,creationBlocked=false;
  function add(parent,tag,value){const e=doc.createElement(tag);if(value!==undefined)e.textContent=value;parent.append(e);return e;}
  function button(parent,label,action,fn){
    const e=add(parent,"button",label),version=epoch;
    e.type="button";e.dataset.action=action;
    e.addEventListener("click",()=>{if(version===epoch&&root.contains(e)&&!busy)fn();});return e;
  }
  function clear(){panel?.dispose();panel=null;root.replaceChildren();}
  function scope(eventId=null){return {actorId:context.actorId,leagueId:context.leagueId,eventId};}
  function current(version){return version===epoch&&context!==null;}
  async function perform(operation){
    if(!context||busy)return;
    const version=epoch;busy=true;message="";render();
    try{await operation(version);}
    catch(_){if(current(version))message="操作結果を確認できません。再取得してください。";}
    finally{if(current(version)){busy=false;render();}}
  }
  async function catalog(){
    if(pending)return;
    mode="catalog";controller.select(scope());
    await perform(async()=>{await controller.list();});
  }
  function selectEvent(id){
    if(pending||!context||busy)return;
    mode="event";controller.select(scope(id));
    void perform(async()=>{await controller.refresh();});
  }
  function sameDraft(v,request){
    const p=request.input;
    return v.status==="draft"&&v.eventId===request.id&&v.name===p.name&&v.sportType===p.sportType&&
      Date.parse(v.deadline)===Date.parse(p.deadline)&&JSON.stringify(v.config)===JSON.stringify(p.config);
  }
  function create(input){
    if(!context?.canManage||pending||busy)return;
    if(creationBlocked)return;
    let request;
    try{request={...journal.save(context,{version:1,id:newId(),input}),checked:false};}
    catch(_){creationBlocked=true;message="作成情報を安全に保持できません。大会作成を停止しました。";mode="catalog";render();return;}
    pending=request;controller.select(scope(request.id));mode="pending";
    void perform(async version=>{
      await controller.createDraft(request.input);
      if(!current(version))return;
      journal.complete(context,request);pending=null;mode="event";
    });
  }
  function verifyPending(){
    if(!pending)return;
    const request=pending;request.checked=false;
    void perform(async version=>{
      try{
        const v=await controller.refresh();
        if(!current(version))return;
        if(!sameDraft(v,request)){message="同じIDの大会内容が異なります。新規作成は停止しています。";return;}
        try{journal.complete(context,request);}catch(_){message="作成済み大会を確認しましたが、復旧情報を消去できません。再取得してください。";return;}
        pending=null;mode="event";
      }catch(_){
        if(!current(version))return;
        // A failed read does not prove absence. Only exact same-ID retry
        // is allowed, and server authorization remains authoritative.
        request.checked=true;
        message="大会の作成を確認できません。同じ作成ID・同じ内容でのみ再試行できます。";
      }
    });
  }
  function retryPending(){
    if(!pending?.checked||!context?.canManage)return;
    const request=pending;request.checked=false;
    void perform(async version=>{
      await controller.createDraft(request.input);
      if(!current(version))return;
      journal.complete(context,request);pending=null;mode="event";
    });
  }
  function render(){
    clear();
    if(!context){add(root,"p","クラブを選択してください。");return;}
    if(message){const e=add(root,"p",message);e.setAttribute("role","status");}
    if(busy){add(root,"p","通信中…");return;}
    if(mode==="pending"){
      add(root,"h2","大会作成の確認");add(root,"p",pending.input.name);
      add(root,"p","作成ID："+pending.id);
      button(root,"同じ大会を再取得","verify-creation",verifyPending);
      if(pending.checked)button(root,"同じID・内容で再試行","retry-creation",retryPending);
      return;
    }
    if(mode==="event"){
      button(root,"大会一覧に戻る","back-catalog",()=>{if(!controller.getState().busy)void catalog();});
      const child=add(root,"section");panel=mountRankingPanel(child,controller,{newId});return;
    }
    if(mode==="create"){
      add(root,"h2","新規大会");
      const version=epoch;
      mountDraftForm(root,{newId,active:()=>current(version)&&mode==="create"&&!busy,
        submit:create,cancel:()=>{mode="catalog";render();}});
      return;
    }
    add(root,"h2","大会一覧");
    button(root,"大会一覧を再取得","reload-catalog",()=>{void catalog();});
    const list=controller.getState().catalog;
    if(!list){add(root,"p","大会一覧を取得してください。");return;}
    if(list.truncated)add(root,"p","大会一覧の一部のみ表示しています。");
    for(const e of list.items)button(root,e.name+" / "+e.statusLabel,"select-event",()=>selectEvent(e.eventId));
    if(context.canManage&&!creationBlocked)button(root,"新規大会作成","new-draft",()=>{mode="create";render();});
    if(context.canManage&&creationBlocked)add(root,"p","作成情報の保存領域を確認できないため、新規作成を停止しています。");
  }
  return Object.freeze({
    setContext(next){
      epoch++;busy=false;pending=null;message="";mode="catalog";creationBlocked=false;
      controller.select(null);context=next?{actorId:next.actorId,leagueId:next.leagueId,canManage:next.canManage===true}:null;
      if(context?.canManage){
        try{const record=journal.load(context);if(record){pending={...record,checked:false};mode="pending";controller.select(scope(record.id));}}
        catch(_){creationBlocked=true;}
      }
      render();if(context&&!pending)return catalog();
    },
    getState:()=>controller.getState(),
    dispose(){epoch++;context=null;pending=null;busy=false;controller.select(null);clear();}
  });
}
module.exports={mountRankingWorkspace};
