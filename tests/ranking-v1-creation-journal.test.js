const test=require("node:test");
const assert=require("node:assert/strict");
const {createCreationJournal}=require("../prototypes/ranking-v1/creation-journal.cjs");
const actorId="00000000-0000-0000-0000-000000000001",leagueId="00000000-0000-0000-0000-000000000010";
const scope={actorId,leagueId},id="a0000000-0000-4000-8000-000000000001";
const record={version:1,id,input:{name:"Cup",sportType:"baseball",deadline:"2027-01-01T03:00:00.000Z",config:{version:1,candidates:["a","b","c","d"].map(id=>({id,label:id,multiplierTenths:10}))}}};
function store(){const m=new Map();return {m,getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};}
test("reload recovers exact ID and input, isolated by actor and club",()=>{
 const s=store(),a=createCreationJournal(s);
 a.save(scope,record);const b=createCreationJournal(s);
 assert.deepEqual(b.load(scope),record);
 assert.equal(b.load({...scope,actorId:"00000000-0000-0000-0000-000000000002"}),null);
 assert.equal(b.load({...scope,leagueId:"00000000-0000-0000-0000-000000000020"}),null);
 b.complete(scope,record);assert.equal(a.load(scope),null);
});
test("unresolved creation cannot be overwritten or cleared by another request",()=>{
 const a=createCreationJournal(store());a.save(scope,record);
 const other={...record,id:"a0000000-0000-4000-8000-000000000002"};
 assert.throws(()=>a.save(scope,other));assert.throws(()=>a.complete(scope,other));
 assert.deepEqual(a.load(scope),record);
});
test("storage unavailable, corrupt or silent failed write fails closed",()=>{
 assert.throws(()=>createCreationJournal(null).save(scope,record));
 const s=store();s.setItem=()=>{};assert.throws(()=>createCreationJournal(s).save(scope,record));
 const b=store();b.m.set("yoso:ranking-v1:pending:"+actorId+":"+leagueId,"bad");
 assert.throws(()=>createCreationJournal(b).load(scope));
 assert.throws(()=>createCreationJournal(b).save(scope,record));
});
