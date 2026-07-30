const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const APP_PATH = path.join(__dirname, "..", "app.js");

test("a completed match is persisted locally before any online-save guard or request", () => {
  const source = fs.readFileSync(APP_PATH, "utf8");
  const start = source.indexOf("async function saveKoshienMatchResult(matchId)");
  const end = source.indexOf("\nfunction setKoshienMatchMessage", start);
  const body = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.ok(body.indexOf("Object.assign(match, completed.match)") < body.indexOf("saveLocalStateOnly()"));
  assert.ok(body.indexOf("saveLocalStateOnly()") < body.indexOf("shouldAutoSaveKoshien"));
  assert.ok(body.indexOf("saveLocalStateOnly()") < body.indexOf("saveKoshienOnlineNow"));
});

test("match results use a compact round list and BottomSheet editor", () => {
  const source = fs.readFileSync(APP_PATH, "utf8");
  const start = source.indexOf("function koshienMatchResultEditor");
  const end = source.indexOf("\nfunction ensureKoshienStartRoundDraft", start);
  const body = source.slice(start, end);

  assert.match(body, /data-koshien-match-list/);
  assert.match(body, /\$\{completedCount\}\/\$\{round\.matches\.length\}完了/);
  assert.match(body, /data-koshien-match-open/);
  assert.match(body, /<dialog[\s\S]*data-koshien-match-sheet/);
  assert.match(body, /data-koshien-match-team/);
  assert.match(body, /data-koshien-match-score/);
  assert.doesNotMatch(body, /<select[^>]*data-koshien-match-winner=/);
});

test("saving a match infers the winner, advances, and preserves list scroll", () => {
  const source = fs.readFileSync(APP_PATH, "utf8");

  assert.match(source, /inferMatchWinner\(match\)/);
  assert.match(source, /nextUnenteredMatchId\(state\.event\.results\.matches,\s*matchId\)/);
  assert.match(source, /koshienMatchEditorState\.listScrollTop/);
  assert.match(source, /data-koshien-match-list[\s\S]*scrollTop/);
});
