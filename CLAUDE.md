# CLAUDE.md

This file is the handoff guide for Claude Code, Codex, and any AI-assisted collaborator working on YOSO.

## Project Summary

YOSO is a static HTML/CSS/JavaScript app for a private sports prediction league.

It is not a gambling app. It must not handle real money, payment, transfers, bookmaker registration, or betting-provider integrations. It records friend-group predictions as points.

## Current Branches

- Main work branch: `codex/local-app-source`
- Public GitHub Pages branch: `gh-pages`
- Published URL: `https://stsofbbl.github.io/pickcircle-sports-prediction-league/`

## Important Product Rules

- Do not change the existing UI look, logo, soap watermark, or bottom navigation unless the user explicitly asks.
- Prediction input should show only the current user's YOSO before the deadline.
- Other members' predictions should be visible only after deadline/result-wait/finalized states.
- Rule presets must fit the real purpose of YOSO: private point-based sports predictions.
- Do not add real-money, payment, transfer, or gambling-provider flows.
- Keep the first-person voice in user-facing assistant summaries as `私` when speaking Japanese.

## Current Architecture

No build step. No package manager. No backend.

Files:

- `index.html`: static markup and major screen containers
- `styles.css`: visual system, layout, responsive rules
- `app.js`: state, rendering, scoring, auth, event workflows
- `assets/`: images and icons
- `docs/WORKFLOW.md`: human collaboration guide

## Near-Term Online Plan

The near-term practical target is friend-group use by the end of this month.

For that stage, assume Google Sheets sync rather than a full backend:

```text
GitHub Pages
+ Google Apps Script
+ Google Sheets
```

Treat Google Sheets as the trial shared data store. Keep the UI and state shape easy to migrate later.

If the app needs production-grade accounts, multi-device identity, strict permissions, and long-term scale, migrate to Supabase Auth + Supabase Postgres later.

State is stored in localStorage:

- `yoso-league-state-v1`: app state
- `yoso-auth-users-v1`: local auth users
- `yoso-auth-session-v1`: current local session

## Auth Notes

The current login/register feature is local-only. It is useful for prototype-level member switching and phone testing, but it is not server authentication.

Password plaintext is not stored. The current code derives a PBKDF2 hash with Web Crypto API and stores salt + derived hash locally.

If real shared accounts are required later, replace local auth with a managed provider such as Supabase Auth or Firebase Auth.

## World Cup 2026 Rules

World Cup 2026 is a dedicated preset, not a normal composite preset.

Phases:

- `phase1`: group league prediction
- `phase2`: knockout/futures/awards prediction
- `phase3`: final score prediction

Phase statuses:

- `locked`
- `open`
- `resultWait`
- `finalized`

Behavior:

- Only Admin can change phase status.
- Only the active `open` phase is editable by the current user.
- Result inputs are editable only by Admin in `resultWait`.
- Rankings sum only finalized phases.
- Phase 3 uses 5% stake from Phase 1 + Phase 2 provisional/base points, pool settlement, and exact-score bonus.

## Safe Change Rules

Before editing:

1. Run `git status --short`.
2. Read the nearby code before changing it.
3. Keep edits scoped.

Do not:

- Reformat the whole file.
- Rename design tokens casually.
- Change brand assets casually.
- Delete user work.
- Push directly to `main`.

Prefer:

- Small commits.
- Clear branch names.
- Plain language commit messages.
- Focused Playwright or browser checks for UI changes.

## Validation

Minimum checks after JS changes:

```powershell
& 'C:\Users\stsof\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' --check app.js
git diff --check
```

For rendered checks, the Codex in-app browser may fail on this Windows machine because `node_repl` can hit:

```text
windows sandbox failed: spawn setup refresh
```

If that happens, use local Edge + Playwright as a fallback and record the reason.

Known Edge executable:

```text
C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe
```

Useful published smoke target:

```text
https://stsofbbl.github.io/pickcircle-sports-prediction-league/
```

## Deploy To GitHub Pages

Latest app source is developed on `codex/local-app-source`.

To publish:

```bash
git switch gh-pages
git checkout codex/local-app-source -- index.html app.js styles.css manifest.json README.md assets
git commit -m "Deploy latest YOSO app"
git push origin gh-pages
git switch codex/local-app-source
```

After pushing, open:

```text
https://stsofbbl.github.io/pickcircle-sports-prediction-league/
```

GitHub Pages may take a short time to update.

## Suggested Next Work

- Replace local-only auth with real shared auth when the app needs true multi-device accounts.
- Improve ranking display for finalized World Cup phases.
- Replace temporary World Cup country seeds with confirmed tournament data when available.
- Add a small automated smoke test script if this repo grows beyond static files.
