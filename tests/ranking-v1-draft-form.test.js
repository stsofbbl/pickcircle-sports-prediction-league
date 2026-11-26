const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizeDraft,multiplierTenths}=require("../prototypes/ranking-v1/draft-form.cjs");
const initial={name:"Cup",sportType:"baseball",deadline:"2027-01-01T12:00:00+09:00",candidates:["a","b","c","d"].map(id=>({id,label:id,multiplierTenths:10}))};
test("draft input normalizes timezone and preserves candidate IDs",()=>{
 const out=normalizeDraft(initial);
 assert.equal(out.deadline,"2027-01-01T03:00:00.000Z");
 assert.deepEqual(out.config.candidates,initial.candidates);
 const renamed={...initial,candidates:initial.candidates.map(c=>({...c,label:"Team "+c.id}))};
 assert.deepEqual(normalizeDraft(renamed).config.candidates.map(c=>c.id),["a","b","c","d"]);
});
test("draft rejects missing timezone, malformed name/code and duplicate candidates",()=>{
 for(const patch of [{deadline:"2027-01-01T12:00:00"},{name:" Cup"},{sportType:"Baseball"},{candidates:[...initial.candidates.slice(0,3),initial.candidates[0]]}])assert.throws(()=>normalizeDraft({...initial,...patch}));
});
test("multiplier decimal input rejects unsupported precision and bounds",()=>{
 assert.equal(multiplierTenths("0.1"),1);assert.equal(multiplierTenths("100"),1000);assert.equal(multiplierTenths("1.3"),13);
 for(const value of ["0","100.1","1.23","1e1","NaN",""])assert.throws(()=>multiplierTenths(value));
});
