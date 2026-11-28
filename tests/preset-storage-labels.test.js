const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");

function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a);
  assert.ok(a >= 0 && b > a, "existing function boundary");
  return app.slice(a, b);
}
function harness({ autoSave = true, templateId = "fightCard", saved = {}, throws = false, online = false, localSaved = true } = {}) {
  const calls = [], timers = [];
  const ctx = vm.createContext({
    window: { YosoDataService: { shouldAutoSaveKoshien: () => autoSave }, YosoKoshienResults: { OFFICIAL_PHASE1_POINTS: {} } },
    els: { newTournamentTemplate: { value: templateId, innerHTML: "" }, saveButton: { textContent: "" } },
    onlineWorkspaceMode: online,
    state: { activeTemplate: templateId, event: { id: "fixture-event", templateId } },
    escapeHtml: String, escapeAttr: String,
    persist: () => { calls.push("local"); return localSaved; },
    saveKoshienOnlineNow: async () => {
      calls.push("online");
      if (throws) throw new Error("network unavailable");
      return saved;
    },
    setTimeout: fn => timers.push(fn),
    console: { warn() {} },
  });
  vm.runInContext(section("const UI_TEXT =", "const presetRuleDescriptions ="), ctx);
  vm.runInContext(section("function baseTemplateId(", "function createConfig("), ctx);
  vm.runInContext(section("function renderTournamentCreateOptions()", "function createTournamentFromSettings("), ctx);
  vm.runInContext(section("async function confirmSave()", "els.resetButton?.addEventListener"), ctx);
  return { ctx, calls, timers };
}

test("all nine presets identify actual storage capability; only configured Koshien is online", () => {
  for (const autoSave of [true, false]) {
    const { ctx } = harness({ autoSave });
    ctx.renderTournamentCreateOptions();
    const options = ctx.els.newTournamentTemplate.innerHTML.match(/<option[^>]*>[^<]*<\/option>/g);
    assert.equal(options.length, 9);
    assert.equal(options.filter(x => x.includes("オンライン対応")).length, autoSave ? 1 : 0);
    assert.equal(options.filter(x => x.includes("端末内のみ")).length, autoSave ? 8 : 9);
    if (autoSave) assert.match(options.find(x => x.includes("オンライン対応")), /value="koshien"/);
    assert.match(options.find(x => x.includes('value="fightCard"')), /selected/);
  }
});

test("local-only saves never display shared confirmation or call the online path", async () => {
  for (const options of [{ templateId: "fightCard" }, { templateId: "rankingOdds" }, { templateId: "worldCup" }, { templateId: "koshien", autoSave: false }]) {
    const { ctx, calls, timers } = harness(options);
    await ctx.confirmSave();
    assert.deepEqual(calls, ["local"]);
    assert.equal(ctx.els.saveButton.textContent, "ローカル保存");
    timers[0]();
    assert.equal(ctx.els.saveButton.textContent, "確定");
  }
});

test("existing online Koshien save statuses are unchanged", async () => {
  for (const [options, expected] of [[{}, "保存済み"], [{ saved: { skipped: true } }, "ローカル保存"], [{ saved: { partial: true } }, "一部保存"], [{ throws: true }, "ローカル保存"]]) {
    const { ctx, calls } = harness({ templateId: "koshien", ...options });
    await ctx.confirmSave();
    assert.deepEqual(calls, ["local", "online"]);
    assert.equal(ctx.els.saveButton.textContent, expected);
  }
});

test("online local-format save is not shown as successful when scoped storage failed", async () => {
  const {ctx,calls}=harness({online:true,localSaved:false});
  await ctx.confirmSave();
  assert.deepEqual(calls,["local"]);
  assert.equal(ctx.els.saveButton.textContent,"未保存");
});
test("online Koshien failures are not shown as local saves",async()=>{
  for(const options of [{saved:{skipped:true}},{throws:true}]){
    const {ctx}=harness({online:true,templateId:"koshien",...options});
    await ctx.confirmSave();
    assert.equal(ctx.els.saveButton.textContent,"未保存");
  }
});
