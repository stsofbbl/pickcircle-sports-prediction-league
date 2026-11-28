// Review-only integration seam for the existing YosoSupabase/YosoDataService.
// The host must invalidate synchronously before logout, recovery, user/club
// switch, or closing this page. No new auth subscription or client instance.
"use strict";
const {mountRankingWorkspace}=require("./workspace.cjs");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function createRankingHostBridge({root,supabase,dataService,getHostContext,mount=mountRankingWorkspace}){
 let generation=0,workspace=null,closed=false;
 function invalidate(){
  generation++;workspace?.dispose();workspace=null;root.replaceChildren();
 }
 function expectedContext(){
  const s=getHostContext();
  if(!s||s.authRecoveryMode||s.provider!=="supabase"||!uuid.test(s.actorId)||!uuid.test(s.leagueId))return null;
  return {actorId:s.actorId,leagueId:s.leagueId};
 }
 function same(a,b){return !!a&&!!b&&a.actorId===b.actorId&&a.leagueId===b.leagueId;}
 function current(ticket,scope){return !closed&&ticket===generation&&same(expectedContext(),scope);}
 function notice(message){
  const e=root.ownerDocument.createElement("p");e.setAttribute("role","status");e.textContent=message;root.replaceChildren(e);
 }
 async function open(){
  if(closed)return false;
  invalidate();const ticket=generation,scope=expectedContext();
  if(!scope||!dataService.isAuthEnabled?.())return false;
  notice("オンライン大会を確認しています。");
  try{
   const client=await supabase.client();
   if(!current(ticket,scope))return false;
   if(!client||typeof client.rpc!=="function")throw Error("client unavailable");
   const user=await supabase.sessionUser();
   if(!current(ticket,scope))return false;
   if(user?.id!==scope.actorId)throw Error("actor mismatch");
   const clubs=await dataService.league.listMyClubs();
   if(!current(ticket,scope))return false;
   if(!Array.isArray(clubs))throw Error("membership unavailable");
   const matches=clubs.filter(c=>c.league_id===scope.leagueId);
   if(matches.length!==1||!["owner","co_owner","member"].includes(matches[0].membership_role))throw Error("membership unavailable");
   const verified=await supabase.sessionUser();
   if(!current(ticket,scope))return false;
   if(verified?.id!==scope.actorId)throw Error("actor changed");
   root.replaceChildren();
   const active=mount(root,{client});
   workspace=active;
   await active.setContext({...scope,canManage:["owner","co_owner"].includes(matches[0].membership_role)});
   if(!current(ticket,scope)){
    // Invalidation by the host already disposed the old workspace. Do not
    // dispose it again: it shares the root with the new workspace.
    if(ticket===generation){invalidate();}
    return false;
   }
   return true;
  }catch(_){
   if(ticket===generation&&!closed){
    invalidate();
    if(same(expectedContext(),scope))notice("クラブ所属を確認できません。再ログイン・再取得してください。");
   }
   return false;
  }finally{
   // Also handle a host scope change detected at a read boundary, even
   // when the caller has not yet invoked invalidate().
   if(ticket===generation&&!current(ticket,scope))invalidate();
  }
 }
 return Object.freeze({open,invalidate,dispose(){closed=true;invalidate();}});
}
module.exports={createRankingHostBridge};
