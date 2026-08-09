const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const koshienResults = require("../js/koshien-results.js");
const homeDashboard = require("../js/home-dashboard.js");

function loadNormalizeKoshienMatch() {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const start = appSource.indexOf("function normalizeKoshienMatch(");
  const end = appSource.indexOf("\nfunction koshienMatchById", start);
  assert.notEqual(start, -1, "normalizeKoshienMatch must exist");
  assert.notEqual(end, -1, "normalizeKoshienMatch boundary must exist");

  const context = {};
  vm.runInNewContext(
    `${appSource.slice(start, end)}\nglobalThis.normalizeKoshienMatch = normalizeKoshienMatch;`,
    context,
  );
  return context.normalizeKoshienMatch;
}

test("R1-15 starts_at survives the online snapshot projection and renders as today's JST time", () => {
  const startsAt = "2026-08-09T09:30:00+00:00";
  const merged = koshienResults.mergeStructuredMatchesIntoResults({
    matches: [{
      match_id: "R1-15",
      round: "R1",
      match_no: 15,
      team_a_id: "中京",
      team_b_id: "霞ケ浦",
      status: "scheduled",
      starts_at: startsAt,
    }],
  }, [{
    id: "db-match-r1-15",
    round_key: "R1",
    match_no: 15,
    team1_id: "team-chukyo",
    team2_id: "team-kasumigaura",
    status: "scheduled",
    metadata: {},
  }], [
    { id: "team-chukyo", name: "中京" },
    { id: "team-kasumigaura", name: "霞ケ浦" },
  ]);

  assert.equal(merged.matches[0].starts_at, startsAt);

  const normalizeKoshienMatch = loadNormalizeKoshienMatch();
  const normalized = normalizeKoshienMatch(merged.matches[0], "R1", 15, ["中京", "霞ケ浦"]);

  assert.equal(normalized.starts_at, startsAt);
  assert.equal(homeDashboard.teamStatus({
    matches: [normalized],
    team: "霞ケ浦",
    now: Date.parse("2026-08-09T01:00:00+00:00"),
  }).text, "本日 18:30");
});
