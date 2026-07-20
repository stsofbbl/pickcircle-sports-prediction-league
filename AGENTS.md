# AGENTS.md

This file defines repository-wide instructions for Codex and other coding agents.

## Work Scope

- Focus on the scope requested by the user.
- Do not mix unrelated changes, broad refactors, or metadata churn into the task.
- Check `git status` and read the relevant files before changing them.
- Preserve existing uncommitted work. Do not delete, overwrite, or revert user changes.
- Keep investigation, documentation, and verification proportional to the task.

## Investigation And Implementation

- Do not fix an unverified bug from assumptions. Reproduce it and identify the cause first.
- Work in small, reviewable, and reversible changes.
- Follow the existing structure, naming, style, and ownership boundaries.
- Add focused tests when changing important logic, calculations, persistence, or state transitions.
- Read existing documentation before deciding behavior when the specification is unclear.
- Before changing project-specific or domain-specific behavior, read the relevant `CONTEXT.md` or documents under `docs/`.
- Do not treat one project's domain rules as repository-wide rules for unrelated work.

## Documentation Ownership

- `AGENTS.md` contains repository-wide AI agent working rules.
- `CONTEXT.md` contains the short YOSO product and domain context.
- `docs/KOSHIEN_2026_RULES.md` is the single source of truth for Summer Koshien 2026 rules.
- `README.md` is the project entry point and documentation map.
- Tool-specific handoff files should point to these documents instead of duplicating their contents.

## Skills

Matt Pocock's engineering skills are installed locally under `.agents/skills`.

- Use `grill-with-docs` when requirements need clarification or stress-testing against documents.
- Use `diagnosing-bugs` for unverified defects, regressions, or performance problems.
- Use `tdd` for important logic when a focused test seam exists.
- Use `to-spec` when implementation should be preceded by a written specification.
- Use `implement` when implementing behavior from an established specification.
- Use `code-review` to review the final diff before committing or requesting commit approval.
- Use only the skills that fit the task. Do not invoke skills mechanically or install them globally.

Skill-specific recommendations do not override repository safety rules or explicit user instructions.

## Git And External Operations

- Commit, push, merge, deploy, release, publish, or modify an external service only with explicit user permission.
- Do not delete branches, force-push, rewrite history, or discard work without explicit permission.
- Confirm the target, scope, and likely impact before changing production Supabase, GitHub, or other external APIs and services.
- Stage only the files intended for the requested change.
- Do not include unrelated working-tree changes in commits or deployments.

## Security

- Never expose `service_role` keys, secret keys, DB passwords, JWT secrets, private tokens, or private configuration.
- Distinguish public client configuration, such as an approved anon key, from privileged credentials.
- Do not place secrets in logs, documentation, README files, commits, frontend bundles, screenshots, or responses.
- Do not inspect or use secret-bearing files unless the task explicitly requires it and the user has authorized it.
- Report suspected secret exposure without reproducing the secret value.

## Verification

- Run checks relevant to the files and behavior changed.
- Prefer focused tests for small changes and broader checks only when the change has a broader impact.
- Review `git diff` and run `git diff --check` before completion when files were modified.
- If a relevant check cannot be run, report that clearly instead of claiming success.

## Completion Report

Keep the final report concise and include only:

1. 実施内容
2. 変更ファイル
3. 検証結果
4. 残課題
5. 次にやるべきこと
