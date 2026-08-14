const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const draft = require("../js/koshien-phase2-draft.js");
const home = require("../js/koshien-phase2-home.js");

const root = path.resolve(__dirname, "..");
const eventId = "2930e8b6-0fe7-45c4-bcf6-edeb8b1407f0";
const players = ["gin", "ino", "den", "gosenn"].map((playerId) => ({
  playerId,
  profileId: `profile-${playerId}`,
  displayName: { gin: "ぎん", ino: "いの", den: "den", gosenn: "50銭" }[playerId],
}));
const officialPicks = [
  ["gin", "613a1b38-fd9c-491c-a5fa-accef2d8efae", "横浜"],
  ["ino", "070a2cb8-136f-47b6-8e4d-e83667cd6efe", "智辯和歌山"],
  ["den", "8c337c9d-b9d9-4800-8a4f-1c6e60c38d3c", "履正社"],
  ["gosenn", "5c3e7cb4-a041-42e8-9f68-42a52dab0b35", "花巻東"],
  ["gosenn", "8ccbfc92-1142-4f9c-8b7f-7bc8fbf9ef80", "三重"],
  ["den", "0b645447-54e8-4213-8ebd-1f4f05e2a548", "健大高崎"],
  ["ino", "292de464-4aa7-498a-b6cc-5245aa9e401b", "英明"],
  ["gin", "9f370b4e-6694-4b8d-bc1a-af9ac8ec0fb2", "天理"],
  ["gin", "baa54a67-0f78-41ad-b267-88efc8d2ec1f", "佐野日大"],
  ["ino", "c3d699b6-f1a8-4dea-859b-1a990db5caf4", "仙台育英"],
  ["den", "d8e87a0c-1edc-4717-a885-30ebb4ea713c", "有明"],
  ["gosenn", "85d303e6-684d-4487-a6f1-8667b3393934", "拓大紅陵"],
  ["gosenn", "54ecca41-4992-4b3a-bca9-666030b5eac2", "敦賀気比"],
  ["den", "64cc20de-1fa2-4a19-8bf8-b0ea6ea9354c", "東日大昌平"],
  ["ino", "3e7df73e-b221-437e-b46c-90f500956ec4", "高川学園"],
  ["gin", "f554fb57-61a0-4af3-8a0b-198ff56ebded", "霞ケ浦"],
];

function completedView(viewerPlayerId) {
  return {
    available: true,
    loadedFromDb: true,
    formalDraftExists: true,
    completed: true,
    eventId,
    viewerPlayerId,
    players,
    eligibleTeams: officialPicks.map(([, teamId, name]) => ({ teamId, name, finish: "best16" })),
    picks: officialPicks.map(([playerId, teamId], index) => ({
      playerId,
      teamId,
      pickNo: index + 1,
      draftRound: Math.floor(index / 4) + 1,
    })),
  };
}

test("the four authenticated viewers receive their exact official four-team draft results", () => {
  const expected = {
    gin: ["横浜", "天理", "佐野日大", "霞ケ浦"],
    ino: ["智辯和歌山", "英明", "仙台育英", "高川学園"],
    den: ["履正社", "健大高崎", "有明", "東日大昌平"],
    gosenn: ["花巻東", "三重", "拓大紅陵", "敦賀気比"],
  };

  Object.entries(expected).forEach(([viewerPlayerId, teamNames]) => {
    const summary = home.buildViewerPhase2Summary({
      draftView: completedView(viewerPlayerId),
      officialScores: [{ player_id: viewerPlayerId, phase2_score: 0 }],
      officialPoints: draft.OFFICIAL_PHASE2_POINTS,
      calculateFormalPhase2Scores: draft.calculateFormalPhase2Scores,
    });
    assert.deepEqual(summary.selectedTeams.map((team) => team.teamName), teamNames);
    assert.deepEqual(summary.selectedTeams.map((team) => team.draftRound), [1, 2, 3, 4]);
    assert.deepEqual(summary.selectedTeams.map((team) => team.finishLabel), ["ベスト16", "ベスト16", "ベスト16", "ベスト16"]);
    assert.deepEqual(summary.selectedTeams.map((team) => team.score), [0, 0, 0, 0]);
    assert.equal(summary.totalScore, 0);
    summary.selectedTeams.forEach((team) => assert.equal(
      team.crestSrc,
      `./assets/koshien-school-crests/${team.teamId}.png`,
    ));
  });
});

test("school points come from the existing formal scorer and the total comes from official phase2_score", () => {
  let scorerCalls = 0;
  const summary = home.buildViewerPhase2Summary({
    draftView: completedView("gin"),
    officialScores: [{ player_id: "gin", phase2_score: 777 }],
    officialPoints: draft.OFFICIAL_PHASE2_POINTS,
    calculateFormalPhase2Scores: ({ players: scorerPlayers }) => {
      scorerCalls += 1;
      return {
        rows: scorerPlayers.map((player) => ({
          playerId: player.playerId,
          score: player.playerId === "gin" ? 148 : 0,
          teams: completedView(player.playerId).picks
            .filter((pick) => pick.playerId === player.playerId)
            .map((pick) => ({ teamId: pick.teamId, finish: "best8", score: 37 })),
        })),
      };
    },
  });
  assert.equal(scorerCalls, 1);
  assert.deepEqual(summary.selectedTeams.map((team) => team.score), [37, 37, 37, 37]);
  assert.equal(summary.totalScore, 777);
  assert.deepEqual(summary.pointLegend.map((item) => item.score), [0, 20, 40, 60, 100]);
});

test("the home summary stays hidden until completed DB state and an official score are both present", () => {
  const base = completedView("gin");
  const options = {
    officialScores: [{ player_id: "gin", phase2_score: 0 }],
    officialPoints: draft.OFFICIAL_PHASE2_POINTS,
    calculateFormalPhase2Scores: draft.calculateFormalPhase2Scores,
  };
  assert.equal(home.buildViewerPhase2Summary({ ...options, draftView: { ...base, loadedFromDb: false } }), null);
  assert.equal(home.buildViewerPhase2Summary({ ...options, draftView: { ...base, completed: false } }), null);
  assert.equal(home.buildViewerPhase2Summary({ ...options, draftView: base, officialScores: [] }), null);
});

test("all 16 manifest entries have a team-ID PNG and official source metadata", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets/koshien-best16-crest-manifest.json"), "utf8"));
  assert.equal(manifest.eventId, eventId);
  assert.equal(manifest.teams.length, 16);
  assert.equal(new Set(manifest.teams.map((team) => team.teamId)).size, 16);
  assert.deepEqual(
    [...manifest.teams.map((team) => team.teamId)].sort(),
    [...officialPicks.map(([, teamId]) => teamId)].sort(),
  );
  assert.deepEqual(
    Object.fromEntries(manifest.teams.map((team) => [team.teamId, team.name])),
    Object.fromEntries(officialPicks.map(([, teamId, name]) => [teamId, name])),
  );
  manifest.teams.forEach((team) => {
    assert.match(team.schoolPage, /^https:\/\//);
    assert.match(team.sourceAsset, /^https:\/\//);
    const png = fs.readFileSync(path.join(root, "assets/koshien-school-crests", `${team.teamId}.png`));
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(png.readUInt32BE(16), 256);
    assert.equal(png.readUInt32BE(20), 256);
    assert.equal(crypto.createHash("sha256").update(png).digest("hex"), manifest.assetSha256ByTeamId[team.teamId]);
  });
});

test("the production page loads the home helper and includes fallback and mobile presentation", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const dashboard = fs.readFileSync(path.join(root, "js/home-dashboard.js"), "utf8");
  assert.ok(html.indexOf("./js/koshien-phase2-draft.js") < html.indexOf("./js/koshien-phase2-home.js"));
  assert.ok(html.indexOf("./js/koshien-phase2-home.js") < html.indexOf("./app.js"));
  assert.match(dashboard, /buildViewerPhase2Summary/);
  assert.match(dashboard, /official_scores/);
  assert.match(dashboard, /OFFICIAL_PHASE2_POINTS/);
  assert.match(dashboard, /calculateFormalPhase2Scores/);
  assert.match(dashboard, /addEventListener\("error"[\s\S]*img\[data-phase2-crest\][\s\S]*image\.remove\(\)/);
  assert.match(dashboard, /@media \(max-width: 619px\)[\s\S]*\.home-phase2-row/);
});
