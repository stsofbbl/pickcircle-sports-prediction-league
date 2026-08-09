const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const bridge = require("../js/koshien-start-time-bridge.js");
const homeDashboard = require("../js/home-dashboard.js");

test("embedded starts_at is copied into metadata before app normalization and renders in JST", () => {
  const startsAt = "2026-08-09T09:30:00+00:00";
  const snapshot = {
    results: {
      payload: {
        matches: [{
          match_id: "R1-15",
          round: "R1",
          match_no: 15,
          team_a_id: "中京",
          team_b_id: "霞ケ浦",
          status: "scheduled",
          starts_at: startsAt,
          metadata: {},
        }],
      },
    },
  };

  bridge.preserveEmbeddedStartTimes(snapshot);

  assert.equal(snapshot.results.payload.matches[0].metadata.starts_at, startsAt);
  assert.equal(homeDashboard.teamStatus({
    matches: snapshot.results.payload.matches,
    team: "霞ケ浦",
    now: Date.parse("2026-08-09T01:00:00+00:00"),
  }).text, "本日 18:30");
});

test("DB starts_at fallback is bridged into metadata when payload has no embedded time", () => {
  const startsAt = "2026-08-09T09:30:00+00:00";
  const snapshot = {
    results: {
      payload: {
        matches: [{
          match_id: "R1-15",
          round: "R1",
          match_no: 15,
          team_a_id: "中京",
          team_b_id: "霞ケ浦",
          status: "scheduled",
          metadata: {},
        }],
      },
    },
  };

  bridge.mergeStartTimesIntoSnapshot(snapshot, [{
    round_key: "R1",
    match_no: 15,
    starts_at: startsAt,
  }]);

  assert.equal(snapshot.results.payload.matches[0].metadata.starts_at, startsAt);
});

test("bridge loader is wired into the browser extension bootstrap", () => {
  const loader = fs.readFileSync(path.join(__dirname, "..", "js", "jhbf-admin-visibility.js"), "utf8");
  assert.match(loader, /koshien-start-time-bridge\.js\?v=20260809-1/);
  assert.match(loader, /loadKoshienStartTimeBridge\(\);\s*\n\s*loadHomeDashboard\(\);/);
});
