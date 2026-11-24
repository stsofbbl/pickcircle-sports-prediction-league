import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isJhbfDateKey, jhbfResultDates, jhbfResultSourceUrl, assertSameJhbfResultSource } from "../supabase/functions/_shared/jhbf-result-source.mjs";

test("JHBF date key must be a real calendar date within the requested season", () => {
  for (const value of ["2026-02-29", "2026-02-31", "2026-04-31", "2026-13-01", "2026-08-00", "2025-12-31", "2026-8-01", "2026-08-01T00:00:00Z"]) {
    assert.equal(isJhbfDateKey(value, 2026), false, value);
    assert.throws(() => jhbfResultSourceUrl("summer", 2026, value));
  }
  assert.equal(isJhbfDateKey("2024-02-29", 2024), true);
  assert.equal(isJhbfDateKey("2026-08-01", 2026), true);
});
test("two-day result lookup never crosses a calendar-year boundary", () => {
  assert.deepEqual(jhbfResultDates("2026-08-10", 2026), ["2026-08-10", "2026-08-09"]);
  assert.deepEqual(jhbfResultDates("2024-03-01", 2024), ["2024-03-01", "2024-02-29"]);
  assert.deepEqual(jhbfResultDates("2026-01-01", 2026), ["2026-01-01"]);
  assert.throws(() => jhbfResultDates("2026-02-31", 2026));
});
test("result source supports both legitimate hosts and competition paths", () => {
  const url = jhbfResultSourceUrl("summer", 2026, "2026-08-10");
  assert.equal(url.href, "https://www.jhbf.or.jp/sensyuken/2026/schedule/schedule_20260810.html");
  assert.doesNotThrow(() => assertSameJhbfResultSource(url, url));
  assert.doesNotThrow(() => assertSameJhbfResultSource(new URL(url.href.replace("www.", "")), url));
  assert.equal(jhbfResultSourceUrl("senbatsu", 2026, "2026-03-20").pathname, "/senbatsu/2026/schedule/schedule_20260320.html");
  assert.throws(() => jhbfResultSourceUrl("invalid", 2026, "2026-08-10"));
});
test("redirects to other dates, years, competitions or unsafe URL variants are rejected", () => {
  const expected = jhbfResultSourceUrl("summer", 2026, "2026-08-10");
  for (const candidate of [
    expected.href.replace("20260810", "20260811"),
    expected.href.replace("/2026/", "/2027/"),
    expected.href.replace("sensyuken", "senbatsu"),
    expected.href.replace("www.jhbf.or.jp", "example.invalid"),
    expected.href.replace("https:", "http:"),
    expected.href.replace("www.jhbf.or.jp", "user@www.jhbf.or.jp"),
    expected.href + "?date=20260811", expected.href + "#other",
  ]) assert.throws(() => assertSameJhbfResultSource(new URL(candidate), expected), candidate);
});
test("manual and development auto-sync result fetch loops validate every redirect before network request", () => {
  const manual = readFileSync(new URL("../supabase/functions/jhbf-results/index.ts", import.meta.url), "utf8");
  const worker = readFileSync(new URL("../supabase/functions/koshien-auto-sync/worker.ts", import.meta.url), "utf8");
  for (const source of [manual, worker]) {
    const loop = source.indexOf("for (let redirects");
    const guard = source.indexOf("assertSameJhbfResultSource(current, initialUrl)", loop);
    const network = source.indexOf("await fetch(current", loop);
    assert.ok(loop >= 0 && guard > loop && network > guard);
    assert.ok(source.includes("const " + (source === manual ? "requestedUrl" : "url") + " = jhbfResultSourceUrl("));
  }
  assert.ok(manual.indexOf("if (!isJhbfDateKey(baseDate, year))") < manual.indexOf('supabase.rpc("request_koshien_external_fetch"'));
});
