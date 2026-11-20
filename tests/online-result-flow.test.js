const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
function fixture({ online = true, templateId = "koshien", policy = "admin" } = {}) {
  const state = { participants: ["Owner", "Member"], approvalPolicy: policy, event: {
    id: "evt", templateId, status: "resultWait", approvalPolicy: policy,
    resultFlow: { status: "none", approvals: {}, submittedAt: "", finalizedAt: "" },
  } };
  const context = { state, Date, renders: 0,
    koshienSharedApprovalView: { eventId: "", loadedFromDb: false },
    koshienSharedApprovalBusy: false,
    koshienSharedApprovalNotice: { eventId: "", message: "", kind: "" },
    currentAuthUser: () => null,
    isCurrentUserAdmin: () => true,
    escapeHtml: (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
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

test("online panel renders shared server progress read-only and rejects another event's data", () => {
  const c = fixture();
  const start = source.indexOf("function resultFlowPanel()");
  const end = source.indexOf("function resultFlowMessage()", start);
  vm.runInContext(source.slice(start, end), c);
  c.koshienSharedApprovalView = {
    eventId: "evt", loadedFromDb: true, submission_status: "submitted",
    approved_count: 2, required_count: 4,
    current_user_voted: false, current_user_eligible: true,
  };
  const html = c.resultFlowPanel();
  assert.match(html, /承認待ち/);
  assert.match(html, /2 \/ 4人/);
  assert.match(html, /あなた：未承認/);
  assert.doesNotMatch(html, /data-result-submit|data-result-approve|data-result-reopen/);
  c.state.event.status = "finalized";
  c.koshienSharedApprovalView.submission_status = "finalized";
  assert.match(c.resultFlowPanel(), /確定済み/);
  c.koshienSharedApprovalView.eventId = "other-event";
  assert.match(c.resultFlowPanel(), /オンライン共有に未対応/);
});

test("online panel offers submit only when not submitted and own vote only when eligible", () => {
  const c = fixture();
  const start = source.indexOf("function resultFlowPanel()");
  const end = source.indexOf("function resultFlowMessage()", start);
  vm.runInContext(source.slice(start, end), c);
  c.koshienSharedApprovalView = {
    eventId: "evt", loadedFromDb: true, event_status: "resultWait",
    submission_status: "none", revision: 0,
  };
  assert.match(c.resultFlowPanel(), /data-result-submit/);
  assert.doesNotMatch(c.resultFlowPanel(), /data-result-approve/);
  c.koshienSharedApprovalView = {
    ...c.koshienSharedApprovalView, submission_status: "submitted",
    current_user_eligible: true, current_user_voted: false,
  };
  assert.match(c.resultFlowPanel(), /data-result-approve/);
  assert.doesNotMatch(c.resultFlowPanel(), /data-result-submit/);
  c.koshienSharedApprovalView.current_user_voted = true;
  assert.doesNotMatch(c.resultFlowPanel(), /data-result-approve/);
  c.koshienSharedApprovalBusy = true;
  assert.match(c.resultFlowPanel(), /data-shared-approval-refresh disabled/);
});
