const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
const service = fs.readFileSync(path.join(root, "js", "data-service.js"), "utf8");

test("my page labels replace the former home display without changing the route", () => {
  assert.match(html, /href="#home" data-nav-page="home"[\s\S]*マイページ/);
  assert.match(html, /id="home" data-page="home" aria-label="マイページ"/);
  assert.match(html, /<h2>マイページ<\/h2>/);
});

test("the dashboard no longer renders independent storage, URL, score, or rule-guide blocks", () => {
  const start = app.indexOf("function renderHomeReadinessPanel");
  const end = app.indexOf("const koshienRuleGuideSheets", start);
  const dashboard = app.slice(start, end);
  assert.doesNotMatch(dashboard, /保存先|公開URL|自分のpt|koshienRuleGuideMarkup/);
  assert.doesNotMatch(html, /id="eventRuleGuide"/);
});

test("Koshien tournament cards provide the existing rule guide from a compact mobile-safe panel", () => {
  const start = app.indexOf("function tournamentCardMarkup");
  const end = app.indexOf("function statusPreviewCardMarkup", start);
  assert.match(app.slice(start, end), /summaryLabel: "ルールを見る"/);
  const resultStart = app.indexOf("function resultWaitCardMarkup");
  const resultEnd = app.indexOf("function eventActionHandler", resultStart);
  assert.match(app.slice(resultStart, resultEnd), /summaryLabel: "ルールを見る"/);
  assert.match(app, /function koshienRuleGuideMarkup\(\{ event = state\.event, compact = false, summaryLabel = "ルールガイド" \} = \{\}\)/);
  assert.match(css, /\.tournament-card \.rule-guide-panel/);
});

test("club entry paths are visible on both the my page and settings while they are safely marked as preparing", () => {
  assert.equal((html.match(/クラブを作る/g) || []).length, 2);
  assert.equal((html.match(/クラブに参加する/g) || []).length, 2);
  assert.equal((html.match(/クラブの作成・参加機能を準備しています。/g) || []).length, 2);
  assert.match(css, /@media \(max-width: 560px\)[\s\S]*\.club-pathway-panel/);
});

test("the exact four-player database error is presented in Japanese", () => {
  assert.match(service, /exactly four submitted players are required/i);
  assert.match(service, /予想を提出済みの参加者が4人必要です/);
});
