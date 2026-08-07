const assert = require("assert");
const polish = require("../js/home-dashboard-polish.js");

assert.strictEqual(polish.stripSectionNumberText("1　今大会のあなた"), "今大会のあなた");
assert.strictEqual(polish.stripSectionNumberText("2 大会進捗"), "大会進捗");
assert.strictEqual(polish.stripSectionNumberText("3　バーチャル高校野球 ↗"), "バーチャル高校野球 ↗");
assert.strictEqual(polish.stripSectionNumberText("試合結果・組み合わせ"), "試合結果・組み合わせ");

(async () => {
  let calls = 0;
  const root = {
    document: { hidden: false },
    location: { hash: "#home" },
    loadKoshienOnlineState: async (options) => {
      calls += 1;
      assert.deepStrictEqual(options, { force: true });
    },
  };
  assert.strictEqual(await polish.refreshOnlineHome(root, { force: true }), true);
  assert.strictEqual(calls, 1);

  assert.strictEqual(await polish.refreshOnlineHome({
    document: { hidden: true },
    location: { hash: "#home" },
    loadKoshienOnlineState: async () => { throw new Error("must not run"); },
  }, { force: true }), false);

  assert.strictEqual(await polish.refreshOnlineHome({
    document: { hidden: false },
    location: { hash: "#ranking" },
    loadKoshienOnlineState: async () => { throw new Error("must not run"); },
  }, { force: true }), false);

  console.log("home dashboard polish tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});