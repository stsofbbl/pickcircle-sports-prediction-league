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

test("R2 match rows render a known starter and keep the official feeder undecided", () => {
  const source = fs.readFileSync(APP_PATH, "utf8");
  const start = source.indexOf("function koshienMatchListRow");
  const end = source.indexOf("\nfunction koshienMatchBottomSheet", start);
  const body = source.slice(start, end);
  const render = Function(
    "escapeHtml",
    "escapeAttr",
    "koshienRoundLabel",
    `${body}; return koshienMatchListRow;`,
  )((value) => String(value), (value) => String(value), (round) => round);

  const html = render({
    match_id: "R2-8",
    round: "R2",
    match_no: 8,
    team_a_id: "花咲徳栄",
    team_b_id: "",
    score_a: "",
    score_b: "",
    status: "scheduled",
  }, "");

  assert.match(html, /R2-8/);
  assert.match(html, /花咲徳栄 vs 高校未定/);
});

test("saving a match infers the winner, advances, and preserves list scroll", () => {
  const source = fs.readFileSync(APP_PATH, "utf8");

  assert.match(source, /inferMatchWinner\(match\)/);
  assert.match(source, /advanceOfficialWinner\(state\.event\.results\.matches,\s*match\)/);
  assert.match(source, /nextUnenteredMatchId\(state\.event\.results\.matches,\s*matchId\)/);
  assert.match(source, /koshienMatchEditorState\.listScrollTop/);
  assert.match(source, /data-koshien-match-list[\s\S]*scrollTop/);
});

test("canceling an R1 result clears its official R2 feeder before saving", () => {
  const source = fs.readFileSync(APP_PATH, "utf8");
  const start = source.indexOf("async function cancelKoshienMatchResult(matchId)");
  const end = source.indexOf("\nfunction setKoshienMatchMessage", start);
  const body = source.slice(start, end);

  assert.match(body, /clearOfficialAdvancement\(state\.event\.results\.matches,\s*match\)/);
  assert.ok(body.indexOf("clearOfficialAdvancement") < body.indexOf('match.winner_id = ""'));
});

test("match editor uses round-qualified candidates for each school selector", () => {
  const source = fs.readFileSync(APP_PATH, "utf8");
  const start = source.indexOf("function koshienMatchBottomSheet");
  const end = source.indexOf("\nfunction ensureKoshienStartRoundDraft", start);
  const body = source.slice(start, end);

  assert.match(body, /eligibleTeamsForMatch/);
  assert.match(body, /side:\s*"a"/);
  assert.match(body, /side:\s*"b"/);
});

test("opening or changing a match clears an earlier result-save message", () => {
  const source = fs.readFileSync(APP_PATH, "utf8");
  const section = (startMarker, endMarker) => {
    const start = source.indexOf(startMarker);
    const end = source.indexOf(endMarker, start);
    assert.ok(start >= 0 && end > start);
    return source.slice(start, end);
  };

  assert.match(section('[data-koshien-match-round]', '[data-koshien-match-open]'), /clearKoshienMatchMessage/);
  assert.match(section('[data-koshien-match-open]', 'const matchSheet'), /clearKoshienMatchMessage/);
  assert.match(section('[data-koshien-match-team]', '[data-koshien-match-score]'), /clearKoshienMatchMessage/);
  assert.match(section('[data-koshien-match-score]', '[data-koshien-match-save]'), /clearKoshienMatchMessage/);
  assert.match(section('[data-koshien-match-save]', '[data-koshien-match-cancel]'), /nextUnenteredMatchId[\s\S]*clearKoshienMatchMessage/);
});
