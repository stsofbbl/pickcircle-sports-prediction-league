import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

test("only the long-running development branch disables automatic Vercel deployment", () => {
  assert.deepEqual(config.git?.deploymentEnabled, {
    "codex/yoso2-online-result-flow": false,
  });
  assert.equal(
    Object.hasOwn(config.git.deploymentEnabled, "codex/vercel-release-candidate"),
    false,
    "production branch must remain eligible for deployment",
  );
  assert.notEqual(config.git.deploymentEnabled, false);
});

test("existing Supabase placeholder rewrite remains intact", () => {
  assert.deepEqual(config.rewrites, [{
    source: "/supabase-config.js",
    destination: "/js/supabase-config-placeholder.js",
  }]);
});
