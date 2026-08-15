import assert from "node:assert/strict";
import { parseJhbfRedrawTeams, pendingRedrawRound } from "../supabase/functions/_shared/koshien-bracket-sync-core.mjs";

const html = `
<h5>準々決勝の組み合わせ(上が1塁側)</h5><table>
<tr><td class="teamName">天理 (奈良)</td></tr>
<tr><td>第13日 第1試合</td></tr>
<tr><td class="teamName">三重 (三重)</td></tr>
<tr><td class="teamName"></td></tr>
<tr><td>第13日 第2試合</td></tr>
<tr><td class="teamName"></td></tr>
<tr><td class="teamName">横浜 (神奈川)</td></tr>
<tr><td>第13日 第3試合</td></tr>
<tr><td class="teamName"></td></tr>
<tr><td class="teamName"></td></tr>
<tr><td>第13日 第4試合</td></tr>
<tr><td class="teamName"></td></tr>
</table><h5>準決勝以降の組み合わせ</h5>`;

const parsed = parseJhbfRedrawTeams(html);
assert.deepEqual(parsed.qfMatches, [{ matchNo: 1, team1Name: "天理", team2Name: "三重" }]);

const r3 = Array.from({ length: 8 }, (_, index) => ({
  round_key: "R3",
  match_no: index + 1,
  status: index < 4 ? "completed" : "scheduled",
  winner_team_id: index < 4 ? `winner-${index + 1}` : null,
}));
assert.equal(pendingRedrawRound(r3), "QF");
console.log("partial redraw sync tests passed");
