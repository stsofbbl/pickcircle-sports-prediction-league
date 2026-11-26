// Review-only, tab-scoped creation journal. No tokens, predictions or scores.
"use strict";
const {normalizeDraft}=require("./draft-form.cjs");
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const eventUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[48][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function key({actorId,leagueId}){
 if(!uuid.test(actorId)||!uuid.test(leagueId))throw Error("invalid creation scope");
 return "yoso:ranking-v1:pending:"+actorId+":"+leagueId;
}
function canonical(record){
 if(!record||record.version!==1||!eventUuid.test(record.id)||!record.input||record.input.config?.version!==1)throw Error("invalid pending creation");
 const {name,sportType,deadline,config}=record.input;
 const input=normalizeDraft({name,sportType,deadline,candidates:config.candidates});
 return {version:1,id:record.id,input};
}
function createCreationJournal(storage){
 function available(){
  if(!storage||typeof storage.getItem!=="function"||typeof storage.setItem!=="function"||typeof storage.removeItem!=="function")throw Error("creation storage unavailable");
 }
 function load(scope){
  available();const raw=storage.getItem(key(scope));
  if(raw===null)return null;
  if(typeof raw!=="string"||raw.length>100000)throw Error("invalid pending creation");
  return canonical(JSON.parse(raw));
 }
 function save(scope,record){
  const checked=canonical(record);
  const old=load(scope);
  if(old&&JSON.stringify(old)!==JSON.stringify(checked))throw Error("unresolved creation exists");
  storage.setItem(key(scope),JSON.stringify(checked));
  if(JSON.stringify(load(scope))!==JSON.stringify(checked))throw Error("creation journal not confirmed");
  return checked;
 }
 function complete(scope,record){
  const old=load(scope),expected=canonical(record);
  if(old&&JSON.stringify(old)!==JSON.stringify(expected))throw Error("creation journal changed");
  if(old)storage.removeItem(key(scope));
  if(load(scope)!==null)throw Error("creation journal not cleared");
 }
 return Object.freeze({load,save,complete});
}
module.exports={createCreationJournal};
