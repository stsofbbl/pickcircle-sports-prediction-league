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
