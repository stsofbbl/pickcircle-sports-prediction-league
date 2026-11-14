const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
function fixture({ online = true, templateId = "koshien", policy = "admin" } = {}) {
  const state = { participants: ["Owner", "Member"], approvalPolicy: policy, event: {
    templateId, status: "resultWait", approvalPolicy: policy,
    resultFlow: { status: "none", approvals: {}, submittedAt: "", finalizedAt: "" },
  } };
  const context = { state, Date, renders: 0,
    window: { YosoDataService: { shouldAutoSaveKoshien: () => online } },
    baseTemplateId: id => id, currentParticipantName: () => "Owner",
    normalizeResultFlow: flow => flow, createResultFlow: () => ({ status: "none", approvals: {} }),
    render() { context.renders += 1; },
  };
  vm.createContext(context);
  const start = source.indexOf("function requiredApprovalCount()");
  const end = source.indexOf("function renderApprovalPolicy()", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), context);
  return context;
}
test("online submission cannot finalize locally or create unshared approval records", () => {
  const c = fixture();
  const before = JSON.stringify(c.state);
  c.submitResults();
  assert.equal(JSON.stringify(c.state), before);
  assert.equal(c.renders, 0);
});
test("online approval cannot impersonate another participant or finalize cached votes", () => {
  const c = fixture({ policy: "unanimous" });
  c.state.event.resultFlow = { status: "submitted", approvals: { Owner: "prior" } };
  const before = JSON.stringify(c.state);
  c.approveResults("Member");
  c.finalizeResultsIfReady();
  assert.equal(JSON.stringify(c.state), before);
  c.state.event.resultFlow.approvals.Member = "cached";
  c.finalizeResultsIfReady();
  assert.equal(c.state.event.status, "resultWait");
});
test("offline approval flow still submits and reaches the required threshold", () => {
  const c = fixture({ online: false, policy: "unanimous" });
  c.submitResults();
  assert.equal(c.state.event.resultFlow.status, "submitted");
  assert.equal(c.state.event.status, "resultWait");
  c.approveResults("Member");
  assert.equal(c.state.event.status, "finalized");
});
test("other local presets keep their existing result flow", () => {
  const c = fixture({ templateId: "fightCard" });
  c.submitResults();
  assert.equal(c.state.event.status, "finalized");
});

test("online result panel explains unavailable sharing and offers no local approval actions", () => {
  const c = fixture();
  const start = source.indexOf("function resultFlowPanel()");
  const end = source.indexOf("function resultFlowMessage()", start);
  assert.ok(start >= 0 && end > start);
  vm.runInContext(source.slice(start, end), c);
  const html = c.resultFlowPanel();
  assert.match(html, /オンライン共有に未対応/);
  assert.doesNotMatch(html, /data-result-submit|data-result-approve|data-result-approver/);
  c.state.event.status = "open";
  assert.equal(c.resultFlowPanel(), "");
});
