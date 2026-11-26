// Review-only management form; candidate IDs survive renaming.
"use strict";
const {validateConfig}=require("./contract.cjs");
function normalizeDraft({name,sportType,deadline,candidates}){
 if(typeof name!=="string"||name.trim()!==name||name.length<1||name.length>120||/[\u0000-\u001f\u007f]/.test(name))throw Error("invalid name");
 if(typeof sportType!=="string"||!/^[a-z][a-z0-9_-]{0,31}$/.test(sportType))throw Error("invalid sport");
 if(typeof deadline!=="string"||!/(?:Z|[+-]\d{2}:\d{2})$/i.test(deadline)||!Number.isFinite(Date.parse(deadline)))throw Error("explicit timezone required");
 return {name,sportType,deadline:new Date(deadline).toISOString(),config:validateConfig({version:1,candidates})};
}
function multiplierTenths(value){
 if(typeof value!=="string"||!/^\d{1,3}(?:\.\d)?$/.test(value))throw Error("invalid multiplier precision");
 const n=Math.round(Number(value)*10);
 if(n<1||n>1000)throw Error("invalid multiplier range");
 return n;
}
function mountDraftForm(parent,{initial=null,newId,submit,cancel,active=()=>true}){
 const doc=parent.ownerDocument;
 function add(parent,tag,value){const e=doc.createElement(tag);if(value!==undefined)e.textContent=value;parent.append(e);return e;}
 const form=add(parent,"form");
 function input(target,label,key,value,type="text"){
  const l=add(target,"label",label),e=add(l,"input");e.dataset.draftField=key;e.type=type;e.value=value;e.required=true;return e;
 }
 const name=input(form,"大会名","name",initial?.name||"");name.maxLength=120;
 const sport=input(form,"競技コード（例：baseball）","sport",initial?.sportType||"baseball");sport.maxLength=32;
 const deadline=input(form,"締切（例：2027-01-01T12:00:00+09:00）","deadline",initial?.deadline||"");
 const table=add(form,"div"),rows=[];
 const status=add(form,"p");status.setAttribute("role","status");
 function control(target,label,action,fn){
  const b=add(target,"button",label);b.type="button";b.dataset.action=action;
  b.addEventListener("click",()=>{if(active()&&form.isConnected&&!b.disabled)fn();});return b;
 }
 const append=control(form,"候補を追加","add-candidate",()=>{if(rows.length<128)row({id:newId(),label:"",multiplierTenths:10});update();});
 const save=add(form,"button",initial?"設定変更を保存":"大会を作成");save.type="submit";save.dataset.action=initial?"save-draft":"create-draft";
 control(form,"取り消す","cancel-draft",cancel);
 function row(c){
  const box=add(table,"div");
  const label=input(box,"候補名","candidate-label",c.label);label.maxLength=100;
  const multiplier=input(box,"倍率","candidate-multiplier",String(c.multiplierTenths/10),"number");
  multiplier.min="0.1";multiplier.max="100";multiplier.step="0.1";
  const item={id:c.id,box,label,multiplier,remove:null};
  item.remove=control(box,"候補を削除","remove-candidate",()=>{if(rows.length<=4)return;rows.splice(rows.indexOf(item),1);box.remove();update();});
  rows.push(item);
 }
 function value(){return normalizeDraft({name:name.value,sportType:sport.value,deadline:deadline.value,candidates:rows.map(x=>({id:x.id,label:x.label.value,multiplierTenths:multiplierTenths(x.multiplier.value)}))});}
 function update(){
  append.disabled=rows.length>=128;rows.forEach(x=>{x.remove.disabled=rows.length<=4;});
  try{value();save.disabled=false;status.textContent="";}catch(_){save.disabled=true;status.textContent="大会名・締切・4件以上の重複しない候補と倍率を確認してください。";}
 }
 const candidates=initial?.config?.candidates||Array.from({length:4},()=>({id:newId(),label:"",multiplierTenths:10}));
 candidates.forEach(row);
 form.addEventListener("input",update);
 form.addEventListener("submit",event=>{
  event.preventDefault();if(!active()||!form.isConnected)return;
  update();if(save.disabled)return;const data=value();save.disabled=true;submit(data);
 });
 update();return form;
}
module.exports={normalizeDraft,multiplierTenths,mountDraftForm};
