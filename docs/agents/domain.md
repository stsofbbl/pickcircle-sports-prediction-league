# Domain Docs

How engineering skills should consume this repo's domain documentation.

## Before Exploring

Read these when relevant:

- `CONTEXT.md` at the repo root when the task concerns the domain documented there
- `docs/adr/` if it exists and the ADR touches the area being changed
- Existing specifications, rule documents, and plans under `docs/` that relate to the task

If a file does not exist, proceed silently. Create new domain terms or ADRs only when the user asks or when a skill explicitly resolves a real term or durable decision.

## Scope

The root `CONTEXT.md` currently documents the YOSO and Koshien domain. Read it only for work in that domain.

For other applications, simulations, research, or documentation in this repository, use the nearest relevant context or specification. Add a more local `CONTEXT.md` only when that area develops durable domain terminology that should not apply elsewhere.

## Vocabulary Rules

Use terms from the relevant `CONTEXT.md` for issue titles, specs, test names, review comments, and implementation notes.

Do not apply one project's vocabulary or constraints to unrelated work in the repository.

If a term conflicts with an established domain rule, stop and ask instead of rewriting the rule.

## Rule Documents

Do not overwrite confirmed rule docs. Prefer adding clarifying notes or ADRs that point back to the canonical rule source.
