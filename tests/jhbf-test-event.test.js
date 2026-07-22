const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260723060000_add_jhbf_minimal_import_test_event.sql"),
  "utf8",
);
const protectionMigration = fs.readFileSync(
  path.join(__dirname, "../supabase/migrations/20260723061000_protect_jhbf_test_event_marker.sql"),
  "utf8",
);
const uiSource = fs.readFileSync(path.join(__dirname, "../js/jhbf-test-event.js"), "utf8");
const configSource = fs.readFileSync(path.join(__dirname, "../js/supabase-public-config.js"), "utf8");
const moduleApi = require("../js/jhbf-test-event.js");

test("defines one isolated historical game with exact JHBF names and source date", () => {
  assert.match(migration, /【TEST】高野連結果取込確認/);
  assert.match(migration, /jhbf_minimal_import/);
  assert.match(migration, /'聖光学院'/);
  assert.match(migration, /'山梨学院'/);
  assert.match(migration, /'2025-08-12'/);
  assert.match(migration, /'R2-1'/);
  assert.match(migration, /'round', 'R2'/);
  assert.match(migration, /'match_no', 1/);
  assert.match(migration, /'externalKey', 'jhbf:summer:2025:2025-08-12:1'/);
  assert.equal(moduleApi.TEST_SOURCE.teamA, "聖光学院");
  assert.equal(moduleApi.TEST_SOURCE.teamB, "山梨学院");
  assert.equal(moduleApi.TEST_SOURCE.scoreA, 2);
  assert.equal(moduleApi.TEST_SOURCE.scoreB, 6);
});

test("test event detection requires both the explicit name and marker", () => {
  assert.equal(moduleApi.isJhbfImportTestEvent({
    name: moduleApi.TEST_EVENT_NAME,
    config: { testHarness: { kind: moduleApi.TEST_KIND } },
  }), true);
  assert.equal(moduleApi.isJhbfImportTestEvent({
    name: moduleApi.TEST_EVENT_NAME,
    config: {},
  }), false);
  assert.equal(moduleApi.isJhbfImportTestEvent({
    name: "夏の甲子園2026 YOSO",
    config: { testHarness: { kind: moduleApi.TEST_KIND } },
  }), false);
});

test("create reset and delete RPCs are admin-only caller-permission functions", () => {
  for (const fn of [
    "create_jhbf_import_test_event",
    "reset_jhbf_import_test_event",
    "delete_jhbf_import_test_event",
  ]) {
    assert.match(migration, new RegExp(`create or replace function public\\.${fn}`));
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}\\(text\\) to authenticated`));
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\(text\\) from public, anon`));
  }
  assert.match(migration, /public\.is_league_admin/);
  assert.doesNotMatch(migration, /security definer/i);
  assert.doesNotMatch(migration, /service_role/i);
});

test("reset and delete are restricted to the deterministic marked test event", () => {
  assert.match(migration, /only the marked JHBF import test event can be reset/);
  assert.match(migration, /only the marked JHBF import test event can be deleted/);
  assert.match(migration, /v_event\.name <> '【TEST】高野連結果取込確認'/);
  assert.match(migration, /v_event\.rules->'testHarness'->>'kind' is distinct from 'jhbf_minimal_import'/);
  assert.match(migration, /v_event\.id <> 'jhbf-import-test-' \|\| replace\(v_event\.league_id::text, '-', ''\)/);
  assert.match(migration, /delete from public\.events/);
});

test("normal event saves preserve the fixed test marker and identity", () => {
  assert.match(protectionMigration, /create or replace function public\.protect_jhbf_import_test_event_marker/);
  assert.match(protectionMigration, /before update on public\.events/);
  assert.match(protectionMigration, /new\.name := old\.name/);
  assert.match(protectionMigration, /new\.league_id := old\.league_id/);
  assert.match(protectionMigration, /jsonb_set\(coalesce\(new\.rules/);
  assert.match(protectionMigration, /revoke all on function public\.protect_jhbf_import_test_event_marker\(\) from public, anon, authenticated/);
});

test("admin UI exposes only harness controls and reuses the existing importer", () => {
  assert.match(configSource, /js\/jhbf-test-event\.js/);
  assert.match(uiSource, /テスト大会を作成/);
  assert.match(uiSource, /過去結果を取得/);
  assert.match(uiSource, /テスト大会を初期化/);
  assert.match(uiSource, /テスト大会を削除/);
  assert.match(uiSource, /create_jhbf_import_test_event/);
  assert.match(uiSource, /reset_jhbf_import_test_event/);
  assert.match(uiSource, /delete_jhbf_import_test_event/);
  assert.match(uiSource, /loadKoshienOnlineState\(\{ force: true \}\)/);
  assert.match(uiSource, /data-jhbf-fetch/);
  assert.match(uiSource, /\[data-manage-event-name\], \[data-manage-event-deadline\], \[data-event-status\]/);
  assert.doesNotMatch(uiSource, /functions\.invoke/);
  assert.doesNotMatch(uiSource, /fetch\s*\(/);
});
