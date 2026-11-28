// Run only inside the disposable PostgreSQL CI database.
"use strict";
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { scoreRanking } = require("../prototypes/ranking-v1/contract.cjs");
assert.equal(process.env.GITHUB_ACTIONS, "true");
assert.deepEqual(process.argv.slice(2), ["yoso_ranking_v1_test"]);
const config = { version: 1, candidates: ["a","b","c","d","e","f"].map((id,i)=>({id,label:id,multiplierTenths:[1,10,13,57,999,1000][i]})) };
const ids = config.candidates.map(x=>x.id);
const payload = candidateIds=>({version:1,candidateIds});
const literal = x=>"'"+JSON.stringify(x).replaceAll("'","''")+"'::jsonb";
const cases = [];
for(const a of ids) for(const b of ids) for(const c of ids) for(const d of ids) {
  const picks = [a,b,c,d];
  if(new Set(picks).size!==4) continue;
  for(const actual of [["a","b","c","d"],["f","e","d","c"]]){
    cases.push({prediction:payload(picks),result:payload(actual)});
  }
}
assert.equal(cases.length,720);
const rows = cases.map((x,i)=>"("+i+","+literal(x.prediction)+","+literal(x.result)+")").join(",\n");
const query = "SELECT jsonb_build_object('index',i,'score',ranking_v1_private.score_order("+literal(config)+",p,r)) FROM (VALUES "+rows+") v(i,p,r) ORDER BY i;";
const stdout = execFileSync("sudo",["-u","postgres","psql","-h","/var/run/postgresql","-X","-qAt","-v","ON_ERROR_STOP=1","-d","yoso_ranking_v1_test"],{input:query,encoding:"utf8",timeout:30000,maxBuffer:8*1024*1024});
const actual = stdout.trim().split("\n").map(JSON.parse);
assert.equal(actual.length,cases.length);
for(const [i,row] of actual.entries()){
  assert.equal(row.index,i);
  assert.deepEqual(row.score,scoreRanking({config,...cases[i]}),"SQL/JS parity case "+i);
}
console.log("PASS: 720 SQL/JS score and breakdown comparisons, including misses and multiplier boundaries");
