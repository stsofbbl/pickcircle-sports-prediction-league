// REVIEW PROTOTYPE ONLY. A small DOM panel, deliberately not wired to app.js.
"use strict";
const {mountDraftForm}=require("./draft-form.cjs");
const messages={
  conflict_reload_required:"他の操作で情報が変更されました。再取得して確認してください。",
  denied_reload_required:"操作できません。所属・権限を確認して再取得してください。",
  confirmed_reload_failed:"保存応答は確認済みです。再取得に失敗しました。再送せず再取得してください。",
  unconfirmed_reload_required:"保存結果を確認できません。再送せず再取得してください。",
  load_failed:"データを取得できませんでした。再取得してください。"
};
function mountRankingPanel(root,controller,{newId=()=>globalThis.crypto.randomUUID()}={}){
  const doc=root.ownerDocument;
  let disposed=false,renderEpoch=0,editReview=null;
  const element=(tag,value)=>{const e=doc.createElement(tag);if(value!==undefined)e.textContent=String(value);return e;};
  const add=(parent,tag,value)=>{const e=element(tag,value);parent.append(e);return e;};
  function button(parent,label,action,callback,disabled=false){
    const b=add(parent,"button",label);
    b.type="button";b.dataset.action=action;b.disabled=disabled;
    const epoch=renderEpoch;
    b.addEventListener("click",()=>{if(epoch===renderEpoch&&root.contains(b)&&!b.disabled)void invoke(callback);});
    return b;
  }
  async function invoke(operation){
    if(disposed)return;
    try{
      const pending=operation();
      render();
      await pending;
    }catch(_error){
      // Controller owns scoped failure state. Do not leak arbitrary RPC
      // messages or display an old request's error in the next event.
    }finally{
      if(!disposed)render();
    }
  }
  function orderForm(parent,v,kind,initial,submit,busy){
    const form=add(parent,"form");
    const selects=[];
    for(let i=0;i<4;i++){
      const label=add(form,"label",(i+1)+"位");
      const field=add(label,"select");
      field.dataset.pick=kind+"-"+i;
      field.required=true;
      const empty=add(field,"option","選択してください");empty.value="";
      for(const candidate of v.candidates){
        const option=add(field,"option",candidate.label+" ×"+candidate.multiplier);
        option.value=candidate.id;
      }
      field.value=initial?.candidateIds?.[i]||"";
      field.disabled=busy;
      selects.push(field);
    }
    const b=add(form,"button",kind==="own"?"予想を保存":"公式結果を確認");
    b.type="submit";b.dataset.action=kind==="own"?"save":"review-result";
    const chosen=()=>selects.map(s=>s.value);
    function update(){
      const values=chosen();
      b.disabled=busy||values.some(v=>!v)||new Set(values).size!==4;
    }
    selects.forEach(s=>s.addEventListener("change",update));update();
    const epoch=renderEpoch;
    form.addEventListener("submit",event=>{
      event.preventDefault();
      if(epoch!==renderEpoch||!root.contains(form))return;
      update();if(b.disabled)return;
      void invoke(()=>submit({version:1,candidateIds:chosen()}));
    });
  }
  function render(){
    if(disposed)return;
    const state=controller.getState(),busy=!!state.busy,v=state.view;
    const epoch=++renderEpoch;
    if(!v||state.review?.kind!=="draft"||editReview?.revision!==state.review.revision||editReview?.eventId!==v.eventId)editReview=null;
    root.replaceChildren();
    const status=add(root,"p",state.error?messages[state.error]||"再取得してください。":busy?"通信中…":state.notice==="server_acknowledged_and_reloaded"?"保存応答・再取得を確認しました。":"");
    status.setAttribute("role","status");
    button(root,"再取得","refresh",()=>controller.refresh(),busy);
    if(!v){add(root,"p","大会情報を取得してください。");return;}
    add(root,"h2",v.name);add(root,"p",v.statusLabel);
    add(root,"p","締切："+v.deadline);
    if(v.actions.save){
      add(root,"h3","あなたの予想");
      orderForm(root,v,"own",v.ownPrediction,p=>controller.save(p),busy);
    }else if(v.ownPicks.length){
      add(root,"h3","あなたの予想");
      const ol=add(root,"ol");v.ownPicks.forEach(p=>add(ol,"li",p.label));
    }
    if(!v.predictionsPublic)add(root,"p","他の会員の予想は締切まで非公開です。");
    if(v.predictionsPublic){
      add(root,"h3","公開予想");
      for(const entry of v.publishedPredictions){
        const row=add(root,"section");add(row,"h4",entry.name);
        const ol=add(row,"ol");entry.picks.forEach(p=>add(ol,"li",p.label));
      }
    }
    if(v.actions.open){
      if(state.review?.kind==="draft"){
        const review=add(root,"section");add(review,"h3","受付開始前の確認");
        add(review,"p",state.review.name+" / "+state.review.sportType+" / "+state.review.deadline);
        const ol=add(review,"ol");state.review.config.candidates.forEach(c=>add(ol,"li",c.label+" ×"+c.multiplierTenths/10));
        if(editReview&&!busy){
          mountDraftForm(review,{initial:state.review,newId,active:()=>epoch===renderEpoch&&!disposed,
            submit:input=>{editReview=null;void invoke(()=>controller.editDraft(input));},
            cancel:()=>{editReview=null;render();}});
        }else{
          button(review,"設定を編集","edit-draft",()=>{editReview={eventId:v.eventId,revision:state.review.revision};},busy);
          button(review,"確認した設定で受付開始","open",()=>controller.open(),busy);
        }
      }else button(root,"大会設定を確認","review-draft",()=>controller.reviewDraft(),busy);
    }
    if(v.actions.close)button(root,"結果待ちに移行","close",()=>controller.close(),busy);
    if(v.actions.reviewResult){
      if(state.review?.kind==="result"){
        add(root,"h3","確定する公式結果");
        const ol=add(root,"ol");
        state.review.result.candidateIds.forEach(id=>add(ol,"li",v.candidates.find(c=>c.id===id).label));
        button(root,"確認した結果で確定","finalize",()=>controller.finalize(),busy);
        button(root,"確認を取り消す","cancel-review",()=>controller.refresh(),busy);
      }else{
        add(root,"h3","公式結果の入力");
        orderForm(root,v,"result",null,p=>controller.reviewResult(p),busy);
      }
    }
    if(v.result){
      add(root,"h3","公式結果");const ol=add(root,"ol");v.result.forEach(p=>add(ol,"li",p.label));
      add(root,"h3","ランキング");
      const list=add(root,"ol");
      v.ranking.forEach(r=>add(list,"li",r.rank+"位 "+r.name+" "+r.score+"pt"));
    }
  }
  render();
  return Object.freeze({render,refresh:()=>invoke(()=>controller.refresh()),dispose:()=>{disposed=true;root.replaceChildren();}});
}
module.exports={mountRankingPanel};
