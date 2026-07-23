const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const guardSource = fs.readFileSync(path.join(__dirname, "../js/jhbf-admin-visibility.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");

test("JHBF result controls are removed from non-admin manager screens", () => {
  assert.match(indexSource, /js\/jhbf-admin-visibility\.js/);
  assert.match(guardSource, /canCurrentUserManageLeague/);
  assert.match(guardSource, /isCurrentUserAdmin/);
  assert.match(guardSource, /\.koshien-jhbf-import/);
  assert.match(guardSource, /panel\.remove\(\)/);
});
