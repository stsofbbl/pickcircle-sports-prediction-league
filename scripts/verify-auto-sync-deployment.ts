// Exercise the same import-map resolution used by the production wrapper.
import { scheduleDecision } from "https://raw.githubusercontent.com/stsofbbl/pickcircle-sports-prediction-league/c6ad7ceff3a53f3855c9dd89e08cff45a93f069f/supabase/functions/_shared/koshien-auto-sync-core.mjs";
const now = new Date("2026-08-08T12:00:00+09:00");
const matches = [{ round_key: "R1", status: "completed", starts_at: "2026-08-08T08:00:00+09:00" }];
const stopped = scheduleDecision(matches, {}, now);
if (stopped.due || stopped.reason !== "schedule_completed") {
  throw new Error("Deployment import map did not load the completion guard");
}
matches[0].status = "scheduled";
const resumed = scheduleDecision(matches, {}, now);
if (!resumed.due || resumed.reason !== "matchday_morning") {
  throw new Error("Reopened match did not resume schedule checks");
}
console.log("Deployment module resolution: completed stops; reopened resumes");

// Assert the result source guard is reachable at the same immutable worker pin.
import { jhbfResultSourceUrl, assertSameJhbfResultSource } from "https://raw.githubusercontent.com/stsofbbl/pickcircle-sports-prediction-league/c6ad7ceff3a53f3855c9dd89e08cff45a93f069f/supabase/functions/_shared/jhbf-result-source.mjs";
const expected = jhbfResultSourceUrl("summer", 2026, "2026-08-10");
assertSameJhbfResultSource(new URL(expected.href.replace("www.", "")), expected);
let rejected = false;
try { assertSameJhbfResultSource(new URL(expected.href.replace("20260810", "20260811")), expected); } catch { rejected = true; }
if (!rejected) throw new Error("Pinned deployment accepts another result date");
console.log("Deployment source guard: correct date accepted; other date rejected");
