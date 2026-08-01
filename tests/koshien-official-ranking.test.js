const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const koshien = require("../js/koshien-results.js");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");
const migrationPath = path.join(
  __dirname,
  "../supabase/migrations/20260802070000_recompute_all_koshien_scores_on_result_save.sql",
);

test("official ranking contains every active member and uses zero when a score row is missing", () => {
  const rows = koshien.buildOfficialScoreRows({
    members: [
      { user_id: "profile-1", display_name: "参加者1" },
      { user_id: "profile-2", display_name: "参加者2" },
      { user_id: "profile-3", display_name: "参加者3" },
      { user_id: "profile-4", display_name: "参加者4" },
    ],
    players: [
      { id: "player-1", profile_id: "profile-1", display_name: "参加者1" },
      { id: "player-2", profile_id: "profile-2", display_name: "参加者2" },
      { id: "player-3", profile_id: "profile-3", display_name: "参加者3" },
      { id: "player-4", profile_id: "profile-4", display_name: "参加者4" },
    ],
    scores: [
      {
        player_id: "player-1",
        phase1_score: 12,
        phase2_score: 20,
        phase3_score: 30,
        revenge_score: 4,
        zombie_score: -20,
        total_score: 46,
        breakdown: { scoring_basis: "current_stage" },
      },
      { player_id: "player-2", phase1_score: 10, total_score: 10 },
      { player_id: "player-3", phase1_score: 10, total_score: 10 },
    ],
  });

  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], {
    name: "参加者1",
    playerId: "player-1",
    profileId: "profile-1",
    score: 46,
    breakdown: {
      scoring_basis: "current_stage",
      phase1: 12,
      phase2: 20,
      phase3: 30,
      revenge: 4,
      zombie: -20,
    },
  });
  assert.equal(rows[3].score, 0);
  assert.deepEqual(rows[3].breakdown, {
    phase1: 0,
    phase2: 0,
    phase3: 0,
    revenge: 0,
    zombie: 0,
  });
  assert.deepEqual(koshien.rankScoreRows(rows).map((row) => row.rank), [1, 2, 2, 4]);
});

test("result snapshot migration recomputes scores for every player without using client point values", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(sql, /create or replace function public\.save_koshien_result_snapshot\(/i);
  assert.match(sql, /insert into public\.matches[\s\S]*insert into public\.scores/i);
  assert.match(sql, /from public\.players p\s+where p\.league_id = v_league_id/i);
  assert.match(sql, /on conflict \(event_id, player_id\) do update set\s+updated_at = now\(\)/i);
  assert.match(sql, /'recomputed_scores', v_score_count/i);
  assert.doesNotMatch(
    sql,
    /from jsonb_to_recordset\(p_score_rows\) as x\(\s*event_id text, player_id uuid, phase1_score numeric/i,
  );
});

test("phase 1 and phase 3 predictions become public only through existing deadlines and locked states", () => {
  const sql = fs.readFileSync(migrationPath, "utf8");

  assert.match(app, /function koshienPhase1PredictionsPublic\(event = state\.event\)/);
  assert.match(app, /event\.deadline[\s\S]*Date\.now\(\) >= Date\.parse\(event\.deadline\)/);
  assert.match(app, /koshienLaterPhaseView\.phase3\?\.predictions \|\| \[\]/);
  assert.match(sql, /'predictions', case\s+when exists \([\s\S]*phase_key = 'phase3'[\s\S]*status in \('locked', 'completed'\)/i);
  assert.match(sql, /from public\.final_score_predictions fsp\s+join public\.players p on p\.id = fsp\.player_id/i);
});
