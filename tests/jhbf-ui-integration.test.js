const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const moduleSource = fs.readFileSync(path.join(__dirname, "../js/jhbf-result-import.js"), "utf8");
const configSource = fs.readFileSync(path.join(__dirname, "../js/supabase-public-config.js"), "utf8");

test("admin manager loads the semi-automatic JHBF result module", () => {
  assert.match(configSource, /js\/jhbf-result-import\.js/);
  assert.match(moduleSource, /最新結果を取得/);
  assert.match(moduleSource, /選択した結果を反映/);
  assert.match(moduleSource, /手動入力も引き続き利用できます/);
});

test("browser integration invokes only fixed Edge Function and audited RPCs", () => {
  assert.match(moduleSource, /functions\.invoke\("jhbf-results"/);
  assert.match(moduleSource, /get_koshien_external_import_context/);
  assert.match(moduleSource, /save_koshien_external_team_alias/);
  assert.match(moduleSource, /record_koshien_external_imports/);
  assert.doesNotMatch(moduleSource, /fetch\s*\(\s*["'`]https:\/\/www\.jhbf/);
});
