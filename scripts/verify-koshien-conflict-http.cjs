// Real PostgREST against captured RPC bodies in the disposable CI fixture.
"use strict";
const assert=require("node:assert/strict");
const {createHmac}=require("node:crypto");
const base=process.env.YOSO_CONFLICT_HTTP_URL,secret=process.env.YOSO_CONFLICT_HTTP_SECRET;
assert.equal(process.env.GITHUB_ACTIONS,"true");
assert.equal(base,"http://127.0.0.1:39117");assert.ok(secret);
const b64=x=>Buffer.from(JSON.stringify(x)).toString("base64url");
function jwt(sub,role="authenticated",signingSecret=secret){
  const msg=b64({alg:"HS256",typ:"JWT"})+"."+b64({sub,role,aud:"authenticated",exp:Math.floor(Date.now()/1000)+600});
  return msg+"."+createHmac("sha256",signingSecret).update(msg).digest("base64url");
}
const uid="00000000-0000-0000-0000-000000000001",other="00000000-0000-0000-0000-000000000002";
const team="00000000-0000-0000-0000-000000000041",event="conflict-event";
const cases=[
 ["finalize_koshien_admin_results",{p_event_id:event,p_expected_revision:"b".repeat(32)},"reviewed scoreboard changed; refresh before finalizing"],
 ["save_koshien_phase2_draft_pick",{p_draft_id:"00000000-0000-0000-0000-000000000021",p_team_id:team,p_expected_pick_no:1,p_request_id:"00000000-0000-0000-0000-000000000051"},"draft turn changed"],
 ["save_koshien_phase3_prediction",{p_event_id:event,p_score_a:1,p_score_b:0,p_tiebreak_score_a:null,p_tiebreak_score_b:null,p_expected_version:1,p_request_id:"00000000-0000-0000-0000-000000000052"},"phase 3 version conflict"],
 ["save_koshien_revenge_pick",{p_event_id:event,p_target_team_id:team,p_expected_version:1,p_request_id:"00000000-0000-0000-0000-000000000053"},"revenge version conflict"],
 ["save_koshien_zombie_prediction",{p_event_id:event,p_target_team_id:team,p_expected_version:1,p_request_id:"00000000-0000-0000-0000-000000000054"},"zombie version conflict"],
];
async function rpc(name,args,token){
 const start=Date.now();
 const response=await fetch(base+"/rpc/"+name,{method:"POST",headers:{"Content-Type":"application/json",...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(args),signal:AbortSignal.timeout(5000)});
 const data=await response.json();
 return {status:response.status,data,elapsed:Date.now()-start};
}
async function main(){
 for(const [name,args,message] of cases){
   const conflict=await rpc(name,args,jwt(uid));
   assert.equal(conflict.status,409,JSON.stringify(conflict));
   assert.equal(conflict.data.code,"PT409");
   assert.equal(conflict.data.message,message);
   assert.ok(conflict.elapsed<5000);
   const outsider=await rpc(name,args,jwt(other));
   assert.equal(outsider.status,403,JSON.stringify(outsider));
   assert.equal(outsider.data.code,"42501");
   const anon=await rpc(name,args);
   assert.ok([401,403,404].includes(anon.status),JSON.stringify(anon));
   const forged=await rpc(name,args,jwt(uid,"authenticated","wrong-secret"));
   assert.equal(forged.status,401,JSON.stringify(forged));
   console.log("PASS: "+name+" HTTP 409 PT409 ("+conflict.elapsed+"ms), outsider/anonymous/forged denied");
 }
 console.log("PASS: 20 actual HTTP requests across five captured production RPCs");
}
main().catch(e=>{console.error(e);process.exitCode=1;});
