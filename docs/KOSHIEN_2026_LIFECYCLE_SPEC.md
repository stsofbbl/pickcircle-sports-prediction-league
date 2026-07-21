# YOSO 夏の甲子園2026 大会進行・後半フェーズ実装仕様

更新日: 2026-07-22

## Problem Statement

フェーズ1、試合結果入力、フェーズ2ドラフト基盤は存在するが、確定版ルールに含まれるリベンジカード、ゾンビモード、フェーズ3が正式なオンライン機能として接続されていない。

現状のままでは、参加者が「今できる操作」を判断できず、後半予想の資格判定、締切、本人保存、再読込、得点計算、ランキング反映を一連で保証できない。また、GitHub上のルール文書には旧リベンジ得点が残っているため、仕様と実装の基準が一致していない。

## Solution

確定版ルールを唯一のルール正本とし、夏の甲子園2026を大会進行に沿った5つの参加者機能として扱う。

1. フェーズ1
2. リベンジカード
3. フェーズ2ドラフト
4. ゾンビモード
5. フェーズ3

管理者が公式結果を保存すると、システムが高校の最終結果、各機能の資格、得点内訳、総合順位をID基準で再計算する。参加者のホームには、現在の大会状況と本人の資格から導いた「次にやること」を1件だけ大きく表示する。

## User Stories

1. As a participant, I want the home screen to show my single next action, so that I do not need to understand internal phase states.
2. As a participant, I want completed, unavailable, upcoming, and missed actions to have different explanations, so that I know why I can or cannot act.
3. As a participant, I want each later prediction to be restored after reload and on another device, so that my submission is not tied to one browser.
4. As a participant, I want the server time and deadline to control submissions, so that all four players are treated consistently.
5. As a participant, I want no automatic school selection when I miss a deadline, so that the system never invents my prediction.
6. As an eligible revenge participant, I want to see only the schools I may select, so that I cannot accidentally submit an invalid school.
7. As an ineligible revenge participant, I want to see that at least one of my phase 1 schools reached the Best 16, so that the ineligibility is understandable.
8. As an eligible revenge participant, I want the fallback Best 16 list only when none of my direct defeaters remains, so that the formal priority rule is preserved.
9. As a participant, I want the revenge score to exclude the already-reached Best 16 value, so that only progress after selection is scored.
10. As a participant, I want phase 2 draft order to be fixed from the Best 16 phase 1 provisional ranking, so that later results cannot reorder the draft.
11. As a tied participant, I want the tie draw to be generated once and shown to everyone, so that the admin cannot choose the order.
12. As a participant, I want the phase 2 draft to accept a school only on my turn, so that duplicate or out-of-order picks cannot occur.
13. As a participant, I want the 16th successful pick to complete the draft automatically, so that all 16 schools are assigned exactly once.
14. As a participant, I want formal phase 2 picks to drive scores and zombie eligibility by player and team IDs, so that old local display-name data cannot affect official results.
15. As an eligible zombie participant, I want to select one semifinal loser candidate from the other players' Best 4 schools, so that the formal interference rule is enforced.
16. As an ineligible zombie participant, I want to see which of my phase 2 schools remains in the Best 4, so that the ineligibility is understandable.
17. As a participant, I want zombie mode to be skipped cleanly when the event setting is OFF, so that phase 2 points remain unchanged.
18. As a participant, I want one correct zombie prediction to reduce only the target school's semifinal-loss phase 2 score from 40 to 20, so that unrelated scores remain intact.
19. As a participant, I want two or more correct zombie predictions on the same school to reduce only that school's phase 2 score from 40 to 0, so that the effect is deterministic.
20. As a zombie participant, I want no points added to my own score, so that zombie mode remains interference rather than rescue scoring.
21. As a participant, I want the two finalists fixed on the phase 3 screen, so that I only enter the two predicted scores.
22. As a participant, I want tied predicted scores rejected, so that every prediction has a winner.
23. As a participant, I want every exact prediction to receive 50 points without sharing, so that duplicate exact predictions are handled by the formal rule.
24. As a participant, I want the nearest prediction evaluation to run only when nobody is exact, so that 30-point awards never coexist with an exact winner.
25. As a participant, I want all fully tied nearest predictions to receive 30 points without sharing, so that the final rule is transparent.
26. As a participant, I want a score breakdown for phase 1, revenge, phase 2, zombie adjustment, and phase 3, so that I can verify the total.
27. As a participant, I want equal final totals to display the same rank, so that an unapproved tiebreak is not invented.
28. As an admin, I want to preview the result-derived qualifiers and eligibility before opening a phase, so that an incorrect result does not lock a bad snapshot.
29. As an admin, I want to set and explicitly open or lock each later phase, so that the app follows the real tournament schedule.
30. As an admin, I want result saves to recalculate scores by replacement rather than increment, so that repeated saves never duplicate points.
31. As an admin, I want corrections that would invalidate an already-open downstream snapshot to be blocked, so that draft and eligibility history cannot silently change.
32. As an admin, I want score-only corrections that preserve winners to recalculate safely, so that harmless corrections do not require a full reset.
33. As an admin, I want only league participants to read event state and only the authenticated participant to submit their own action, so that client-supplied identities are not trusted.
34. As an admin, I want all official state changes to be auditable by timestamps, actor IDs, and source result versions, so that disputes can be investigated.
35. As a developer, I want one aggregate event-state read boundary, so that home, prediction screens, scoring, and tests consume the same official state.

## Implementation Decisions

### 1. Rule authority

- `KOSHIEN_2026_RULES.md` remains the only game-rule source of truth.
- The uploaded confirmed rules replace old rule fragments and simulation notes.
- The repository rule document must correct revenge scoring to `max(0, final arrival points - 1.5) × capped sqrt odds`.
- Correct revenge base points are Best 16 `0`, Best 8 `0.5`, Best 4 `1`, runner-up `2`, champion `3.5`.
- Phase 2 points are `0 / 20 / 40 / 60 / 100`.
- Simulation documents are evidence about balance, not executable rules.

### 2. Event progression

The participant-facing progression is:

| Trigger | Open participant action | System/admin responsibility |
| --- | --- | --- |
| Before tournament | Phase 1 | Register 49 schools, bracket, fixed odds, deadline |
| Tournament start | None | Lock phase 1 |
| Best 16 confirmed | Revenge and phase 2 open together | Freeze Best 16, provisional scores, eligibility, tie draw, draft order |
| First third-round game starts | None | Reject late revenge and phase 2 writes; admin locks after confirmation |
| Best 4 confirmed | Zombie, only if enabled and eligible | Freeze Best 4 and zombie eligibility |
| First semifinal starts | None | Reject late zombie writes |
| Finalists confirmed | Phase 3 | Freeze the two finalist IDs |
| Final starts | None | Reject late phase 3 writes |
| Final result saved | None | Recompute all breakdowns and final ranking |

Exact timestamps remain event data set by the admin. A write is valid only while server time is `starts_at <= now < deadline_at`; the exact deadline instant is closed. No scheduled background job is required because every write RPC enforces this condition.

### 3. Status ownership

- Phase 1 continues to use the event prediction deadline.
- Phase 2 continues to use the established formal draft record and its `status`, `starts_at`, `deadline_at`, `locked_at`, and `version` semantics.
- Revenge, zombie, and phase 3 each receive a feature-owned round record with `status`, `opens_at`, `deadline_at`, `locked_at`, `source_results_version`, and `version`.
- Allowed common states are `not_ready`, `ready`, `open`, `locked`, and `completed`. Phase 2 may retain `drafting` as its feature-specific open state.
- Reverse transitions are not exposed in the participant UI.

### 4. Snapshot and correction policy

- Best 16 and Best 4 eligibility is calculated from completed official match rows, never from a browser prediction payload.
- Opening a later phase stores a snapshot of eligible player IDs and team IDs plus the result version used.
- Saving the same official results again is idempotent.
- A result edit that changes a winner, loser, or qualifier after a dependent phase has opened is rejected with a clear admin message.
- A score correction that preserves the winner may proceed and triggers full score recomputation.
- Resetting an opened downstream phase is out of scope for this spec and requires a separately reviewed admin operation.

### 5. Revenge data and submission

- Persist eligibility per `event_id + player_id` with `eligible_team_ids`, whether fallback selection is allowed, and the source result version.
- Add a unique constraint for one revenge pick per `event_id + player_id`.
- The submission RPC accepts only `event_id`, `target_team_id`, `expected_version`, and `request_id`.
- The RPC resolves `player_id` from `auth.uid()`, checks the round state and server deadline, checks eligibility and allowed teams, then upserts once.
- A participant may edit the pick while the round is open. The same request ID and payload is idempotent; a reused request ID with a different payload is rejected.
- No captain multiplier applies.

### 6. Phase 2 connection

- The existing formal draft remains the only official phase 2 ownership source.
- Display-name keyed `prediction.phase2DraftPicks` remains legacy UI state and must never contribute to official scoring or zombie eligibility.
- Phase 2 score projection joins formal draft picks, teams, players, and official finishes by IDs.
- The existing atomic single-pick RPC, fixed order, deduplication, and request-id rules remain in force.
- No automatic pick is made after a missed turn. For the four-player MVP, participants must finish the draft before its deadline. The admin may extend an expired deadline only while no downstream phase has started; every extension is audited.

### 7. Zombie data and submission

- Zombie mode is controlled by the event rule flag. OFF means no eligibility, no input, and zero adjustment.
- At Best 4, persist eligibility per `event_id + player_id` and the allowed target team IDs.
- An allowed target must be a Best 4 school formally owned in phase 2 by another player.
- Add a unique constraint for one zombie prediction per `event_id + player_id`.
- The submission RPC uses the same authentication, version, deadline, and request-id rules as revenge.
- Scoring stores phase 2 base points and a separate non-positive zombie adjustment on the affected owner. The zombie participant receives zero.

### 8. Phase 3 data and submission

- The phase 3 round stores fixed `team_a_id` and `team_b_id` finalist identities.
- The UI shows those teams in fixed order and accepts only `team_a_score` and `team_b_score`.
- Both scores must be integers greater than or equal to zero and must not be equal.
- The submission RPC accepts `event_id`, the two scores, `expected_version`, and `request_id`; finalist IDs are server-owned and not trusted from the client.
- Existing champion/runner-up named columns are not used as the new domain contract. A safe migration must add fixed-finalist score semantics and stop if existing rows cannot be converted unambiguously.

### 9. Scoring and ranking

- All official scoring is a pure recomputation from source rows. No operation increments a stored total.
- Phase 1 uses each school's fixed odds snapshot, official finish, and captain flag.
- Revenge uses the selected school's fixed odds snapshot and `max(0, arrival points - 1.5)`.
- Phase 2 uses formal ownership and fixed points.
- Zombie adjustment is `0`, `-20`, or `-40` only for a target that lost in a semifinal.
- Phase 3 first awards every exact prediction 50. Only if the exact set is empty does it compare the tuple below lexicographically:
  1. absolute team-score error total, ascending
  2. actual winner correct, true first
  3. margin error, ascending
  4. total-score error, ascending
- Every participant tied on all nearest criteria receives 30.
- Total score equals phase 1 + revenge + phase 2 base + zombie adjustment + phase 3.
- Final equal totals use competition ranking with the same displayed rank.
- Scores retain full calculation precision in the domain and database. The UI displays at most two decimal places without changing the stored value.

### 10. Aggregate read boundary

Expose one participant-safe read operation that returns:

- official event and result version
- current tournament milestone
- authenticated viewer and role
- phase states and deadlines
- viewer eligibility, allowed team IDs, and submitted values
- formal phase 2 draft state and ownership
- official score rows and human-readable breakdowns
- ranking rows
- one derived `next_action` object with action key, state, title, reason, deadline, and destination

The client does not infer eligibility, ownership, or public visibility from names or local arrays.

### 11. UI behavior

- Keep the existing YOSO visual language. Do not redesign the whole application during this feature.
- Home shows tournament progress and one primary next-action panel.
- The five functions are logically separate screens or panels. Bottom navigation does not gain five new permanent items; the next-action panel and a compact progress control open the correct panel.
- Eligible open state: explanation, deadline, valid choices, current selection, confirm action.
- Ineligible state: reason and read-only progress.
- Upcoming state: opening condition, no disabled fake controls.
- Locked/completed state: submitted value and outcome.
- Saving is pessimistic: controls disable during the request, and the UI confirms only after the DB response.
- Error recovery reloads aggregate official state before allowing another submission.

### 12. Authorization

- Anonymous users cannot read or write formal later-phase state.
- League participants may read the event state appropriate to the rule visibility.
- A participant can submit only as the player linked to `auth.uid()`.
- Admin-only operations are phase preparation, preview, open, lock, deadline extension, official result entry, and finalization.
- Participant table writes are denied; reviewed RPCs are the only write boundary.
- Security-definer RPCs use a fixed search path, derive identity server-side, and revoke execution from `PUBLIC` and `anon`.

### 13. Operational defaults accepted for the MVP

- Revenge and phase 2 open after the same Best 16 confirmation.
- Their deadlines are before the first third-round game and are set explicitly by the admin.
- Zombie deadline is before the first semifinal.
- Phase 3 deadline is before the final.
- Missing submissions receive no automatic selection and no points/effect.
- Admin controls opening and locking.
- Final ties remain tied.

## Testing Decisions

- Prefer the highest stable seam: given official event state, authenticated viewer, and server time, return the aggregate participant view, score breakdowns, ranking, and next action.
- Pure domain tests cover finish normalization, phase 1, revenge, phase 2, zombie adjustment, phase 3 nearest comparison, total score, tied ranks, eligibility, and next-action derivation.
- Persistence tests cover RPC payloads, authenticated identity resolution, deadline enforcement, request-id idempotence, stale versions, unique constraints, and reload restoration.
- Migration tests statically verify constraints, grants, RLS, fixed search paths, result-version checks, and non-destructive handling of existing rows.
- UI tests assert external behavior: correct choices, disabled saving state, DB-success confirmation, ineligible reasons, fixed finalist display, and recovery after conflict.
- The integrated acceptance seam is one complete four-player tournament from phase 1 submission through final ranking, followed by reload on another participant account.
- Re-running score calculation or re-saving the same result must produce byte-equivalent totals and must not add points.
- Prior art is the existing Koshien result domain module, phase 2 draft domain module, data-service tests, static SQL migration tests, and source-level UI safety tests.

## Out of Scope

- Four-player phase 2 rules generalized to other participant counts
- Automatic selection or automatic draft picks after a missed deadline
- Per-pick timers, push notifications, email notifications, or realtime presence
- Participant or admin undo of an already-open downstream phase
- Production database migration, deployment, or data mutation
- Final-score tiebreak beyond the confirmed nearest-prediction rules
- Overall-ranking tiebreak beyond shared rank
- Odds provider selection or odds ingestion automation
- Broad visual redesign of YOSO
- Real money, payments, settlement, transfers, bookmaker signup, or betting-provider integration

## Further Notes

- The existing schema contains placeholder tables for revenge, zombie, and final-score predictions. Their presence does not mean the features are implemented.
- The current score model can represent zombie impact as a negative adjustment, but UI wording must make clear that the zombie participant receives no points.
- The existing repository rule document's revenge table is materially wrong and must be corrected before scoring implementation begins.
- The old simulation summary contains a Best 8 zombie trigger and other superseded fragments. It must not be used as an implementation source.
- Publish or commit this specification only after explicit GitHub write permission.
