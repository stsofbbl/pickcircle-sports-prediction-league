const assert = require("assert");
const polish = require("../js/home-dashboard-polish.js");

assert.strictEqual(polish.stripSectionNumberText("1　今大会のあなた"), "今大会のあなた");
assert.strictEqual(polish.stripSectionNumberText("2 大会進捗"), "大会進捗");
assert.strictEqual(polish.stripSectionNumberText("3　バーチャル高校野球 ↗"), "バーチャル高校野球 ↗");
assert.strictEqual(polish.stripSectionNumberText("試合結果・組み合わせ"), "試合結果・組み合わせ");

console.log("home dashboard polish tests passed");