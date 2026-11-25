const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { validateConfig, validatePrediction, validateResult, scoreRanking } = require("../prototypes/ranking-v1/contract.cjs");
const config = { version: 1, candidates: ["a","b","c","d","e","f"].map((id,i) => ({id,label:id.toUpperCase(),multiplierTenths:10+i*3})) };
const order = (...candidateIds) => ({ version: 1, candidateIds });
const result = order("a","b","c","d");
test("exact rank, misplaced top four and miss use existing points; exact integer tenths", () => {
  const scored = scoreRanking({ config, prediction: order("a","c","e","b"), result });
  assert.deepEqual(scored.breakdown.map(x => x.basePoints), [10,2,0,2]);
  assert.deepEqual(scored.breakdown.map(x => x.scoreTenths), [100,32,0,26]);
  assert.equal(scored.scoreTenths,158);
});
test("matches the actual legacy rank scoring formula for valid distinct picks", () => {
  const app = fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
  const start = app.indexOf("score = prediction.picks.reduce((total, pick, index) => {");
  const end = app.indexOf("}, 0);",start);
  assert.ok(start >= 0 && end > start);
  const legacy = app.slice(start,end+6);
  // Execute the existing formula verbatim in a narrow VM harness.
  const context = vm.createContext({template:{basePoints:[10,7,5,3]},state:{event:{results:{finalTop4:result.candidateIds}}},prediction:{},score:0});
  for (const a of config.candidates) for (const b of config.candidates) for (const c of config.candidates) for (const d of config.candidates) {
    const ids = [a.id,b.id,c.id,d.id];
    if (new Set(ids).size !== 4) continue;
    context.prediction = { picks:ids, odds:[a,b,c,d].map(x=>x.multiplierTenths/10) };
    vm.runInContext(legacy,context);
    const next=scoreRanking({config,prediction:order(...ids),result});
    assert.equal(next.scoreTenths, Math.round(context.score*10));
  }
});
test("reject malformed, duplicate, unknown or incomplete submissions and result lists", () => {
  for (const payload of [null, [], {version:2,candidateIds:["a","b","c","d"]}, order("a","a","b","c"), order("a","b","c"), order("a","b","c","missing"), {...result,score:999}, {...result,multipliers:[1000,1000,1000,1000]}, {...result,userId:"other"}]) {
    assert.throws(()=>validatePrediction(payload,config),TypeError);
    assert.throws(()=>validateResult(payload,config),TypeError);
  }
});
test("reject invalid or duplicate candidates and noninteger or excessive multiplier", () => {
  const changed = patch=>({...config,candidates:[{...config.candidates[0],...patch},...config.candidates.slice(1)]});
  for(const candidate of [changed({id:"b"}),changed({label:"B"}),changed({multiplierTenths:0}),changed({multiplierTenths:1.2}),changed({multiplierTenths:1001}),changed({multiplierTenths:"10"}),changed({multiplierTenths:Infinity}),changed({score:500})]) {
    assert.throws(()=>validateConfig(candidate),TypeError);
  }
  assert.throws(()=>validateConfig({...config,candidates:config.candidates.slice(0,3)}),TypeError);
});
test("renaming candidate or reordering config cannot change identity or score; canonical values are immutable",()=>{
  const p=order("a","c","e","b");
  const before=scoreRanking({config,prediction:p,result});
  const renamed={...config,candidates:[...config.candidates].reverse().map(x=>({...x,label:"Team "+x.id}))};
  assert.deepEqual(scoreRanking({config:renamed,prediction:p,result}),before);
  const checked=validateConfig(config);
  assert.ok(Object.isFrozen(checked)&&Object.isFrozen(checked.candidates)&&Object.isFrozen(checked.candidates[0]));
  assert.ok(Object.isFrozen(validatePrediction(p,config).candidateIds));
});
