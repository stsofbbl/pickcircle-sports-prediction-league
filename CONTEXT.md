# YOSO Context

YOSO is a points-only private sports prediction league app for friends. It must not handle real money, payments, transfers, bookmaker registration, or betting-provider integrations.

## Glossary

**YOSO**: A prediction submitted by a participant. In product language, use "prediction" or "YOSO", not real-money betting language.

**Participant**: A friend playing in the league.

**Admin**: The user allowed to manage events, phase states, and official results.

**Event**: A competition or tournament configured in the app, such as `YOSO 夏の甲子園2026`.

**Phase**: A rule-defined part of an event. Koshien 2026 uses phase 1 picks, phase 2 draft, and phase 3 final score prediction.

**Koshien**: The Summer Koshien 2026 preset. Treat it as a points-based prediction game, not a gambling product.

The formal Koshien 2026 rules are defined only in [`docs/KOSHIEN_2026_RULES.md`](docs/KOSHIEN_2026_RULES.md). This context file defines vocabulary, not scoring or tournament rules.

**Result Entry**: Admin flow for entering official match scores and winners, then recalculating finish keys, scores, ranking, and breakdowns.

**Finish Key**: The normalized Koshien final outcome key for a school, such as `initial_loss`, `best8`, `runner_up`, or `champion`.

**Score Breakdown**: The user-visible explanation of how points were calculated per school and phase.

**Supabase Online Path**: Optional shared persistence through Supabase Auth and Postgres. Browser code may use only the anon public key.

## Product Guardrails

- Keep the app framed as predictions, points, rankings, and private league play.
- Do not add real-money settlement, odds-provider signup, payments, transfers, or gambling calls to action.
- Do not expose Supabase `service_role`, secret keys, DB passwords, JWT secrets, or private local config.
- Preserve existing confirmed Koshien rules unless the user explicitly changes them.
