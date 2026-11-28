// Explicitly disabled until the release is approved. Not a security boundary.
"use strict";
const {createRankingHostBridge}=require("./host-bridge.cjs");
const RELEASE_ENABLED=false;
function createRankingEntry({enabled=RELEASE_ENABLED,section,button,root,supabase,dataService,getHostContext,makeBridge=createRankingHostBridge}){
 let bridge=null,context=null,disposed=false;
 function invalidate(){
  bridge?.dispose();bridge=null;context=null;root.replaceChildren();
  section.hidden=true;button.hidden=true;root.hidden=true;
 }
 function sync(next){
  if(disposed||!enabled||!next||next.page!=="active"||next.authRecoveryMode||next.provider!=="supabase"||!next.actorId||!next.leagueId){invalidate();return;}
  if(context&&(context.actorId!==next.actorId||context.leagueId!==next.leagueId))invalidate();
  context={actorId:next.actorId,leagueId:next.leagueId};section.hidden=false;button.hidden=false;
 }
 async function open(){
  if(disposed||!enabled||!context||section.hidden)return false;
  bridge?.dispose();
  const next=makeBridge({root,supabase,dataService,getHostContext});
  bridge=next;root.hidden=false;
  return next.open();
 }
 const onClick=()=>{void open();};
 button.addEventListener("click",onClick);
 invalidate();
 return Object.freeze({sync,open,invalidate,dispose(){disposed=true;invalidate();button.removeEventListener("click",onClick);}});
}
module.exports={RELEASE_ENABLED,createRankingEntry};
