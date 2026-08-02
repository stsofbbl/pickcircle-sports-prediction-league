const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

test("app icon URLs are rotated when the artwork changes", () => {
  assert.match(
    html,
    /rel="apple-touch-icon"[^>]+href="\.\/assets\/apple-touch-icon-matte-2026\.png"/,
  );
  assert.match(html, /rel="icon"[^>]+href="\.\/assets\/favicon-32\.png\?v=matte-20260802"/);
  assert.match(html, /rel="manifest" href="\.\/manifest\.json\?v=matte-20260802"/);

  assert.ok(
    fs.existsSync(path.join(root, "assets", "apple-touch-icon-matte-2026.png")),
    "the cache-busted Apple touch icon must exist",
  );
  assert.ok(
    manifest.icons.every((icon) => icon.src.endsWith("?v=matte-20260802")),
    "every manifest icon URL must change with the artwork",
  );
});
