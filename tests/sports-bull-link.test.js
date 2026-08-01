const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");

test("Koshien tournament cards and phase 1 input expose the Sports BULL schedule link", () => {
  assert.match(app, /const sportsBullKoshienUrl = "https:\/\/vk\.sportsbull\.jp\/sp\/koshien\/"/);
  assert.match(app, /target="_blank" rel="noopener noreferrer">日程・組み合わせ/);
  assert.equal((app.match(/sportsBullScheduleLinkMarkup\(\{ fullRow: true \}\)/g) || []).length, 2);
  assert.match(app, /function participantKoshienBlock[\s\S]*?\$\{sportsBullScheduleLinkMarkup\(\)\}[\s\S]*?koshien-pick-grid/);
});

test("external schedule link uses theme-specific readable blue text without changing the button shell", () => {
  assert.match(css, /--external-link:\s*#38bdf8/);
  assert.match(css, /body\[data-theme="day"\][\s\S]*?--external-link:\s*#0369a1/);
  assert.match(css, /\.external-schedule-link\s*\{[\s\S]*?color:\s*var\(--external-link\)/);
  assert.match(css, /\.tournament-actions \.external-schedule-link\.is-full-row\s*\{[\s\S]*?grid-column:\s*1 \/ -1/);
});
