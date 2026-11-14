// Exercise the same import-map resolution used by the production wrapper.
import { scheduleDecision } from "https://raw.githubusercontent.com/stsofbbl/pickcircle-sports-prediction-league/d0736692446a4b6b0cb0ed6e5dcb72e4f0e4f8f6/supabase/functions/_shared/koshien-auto-sync-core.mjs";
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
