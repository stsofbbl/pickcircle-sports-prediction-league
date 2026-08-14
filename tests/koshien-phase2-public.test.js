const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const code = fs.readFileSync("js/jhbf-admin-visibility.js", "utf8");

function buildView(status = "locked", pickCount = 16) {
  const players = [
    ["p1", "ぎん"],
    ["p2", "いの"],
    ["p3", "den"],
    ["p4", "50銭"],
  ].map(([playerId, displayName]) => ({ playerId, displayName }));
  const teams = [
    ["t1", "横浜"], ["t2", "智辯和歌山"], ["t3", "履正社"], ["t4", "花巻東"],
    ["t5", "三重"], ["t6", "健大高崎"], ["t7", "英明"], ["t8", "天理"],
    ["t9", "佐野日大"], ["t10", "仙台育英"], ["t11", "有明"], ["t12", "拓大紅陵"],
    ["t13", "敦賀気比"], ["t14", "東日大昌平"], ["t15", "高川学園"], ["t16", "霞ケ浦"],
  ].map(([teamId, name]) => ({ teamId, name }));
  const playerOrder = ["p1", "p2", "p3", "p4", "p4", "p3", "p2", "p1", "p1", "p2", "p3", "p4", "p4", "p3", "p2", "p1"];
  const picks = playerOrder.slice(0, pickCount).map((playerId, index) => ({
    playerId,
    teamId: `t${index + 1}`,
    pickNo: index + 1,
    draftRound: Math.floor(index / 4) + 1,
  }));
  return {
    available: true,
    status,
    players,
    eligibleTeams: teams,
    snakeOrder: playerOrder,
    picks,
  };
}

function runWithView(view) {
  let originalCalls = 0;
  const styleNodes = [];
  const sandbox = {
    console,
    koshienPhase2DraftView: view,
    participantKoshienDraftBlock() {
      originalCalls += 1;
      return "ORIGINAL";
    },
    setTimeout() {},
    addEventListener() {},
    document: {
      readyState: "loading",
      getElementById() { return null; },
      querySelector() { return null; },
      createElement(tag) {
        if (tag !== "style") return { dataset: {} };
        const node = { id: "", textContent: "", dataset: {} };
        styleNodes.push(node);
        return node;
      },
      head: { appendChild() {} },
    },
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox);
  return {
    html: sandbox.participantKoshienDraftBlock(),
    originalCalls,
    styleNodes,
  };
}

{
  const { html, originalCalls, styleNodes } = runWithView(buildView());
  assert.strictEqual(originalCalls, 0, "completed draft should replace the operation UI");
  assert.match(html, /フェーズ2・全員のYOSO/);
  assert.match(html, /公開中/);
  assert.match(html, /ぎん/);
  assert.match(html, /横浜/);
  assert.match(html, /2巡目[^]*天理/);
  assert.match(html, /いの/);
  assert.match(html, /智辯和歌山/);
  assert.match(html, /den/);
  assert.match(html, /履正社/);
  assert.match(html, /50銭/);
  assert.match(html, /敦賀気比/);
  assert.doesNotMatch(html, /data-koshien-phase2-team/);
  assert.doesNotMatch(html, /この高校を指名する/);
  assert.ok(styleNodes.some((node) => node.id === "yoso-koshien-phase2-public-style"));
}

{
  const { html, originalCalls } = runWithView(buildView("drafting", 15));
  assert.strictEqual(html, "ORIGINAL");
  assert.strictEqual(originalCalls, 1, "active draft must keep the existing operation UI");
}

console.log("koshien phase2 public display tests passed");
