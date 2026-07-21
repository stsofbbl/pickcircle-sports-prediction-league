# Issue Tracker: GitHub

Issues and specs for this repo live as GitHub Issues on `stsofbbl/pickcircle-sports-prediction-league`.

Use the `gh` CLI only when the user explicitly asks to create, edit, label, comment on, or close real GitHub issues.

## Conventions

- Create an issue: `gh issue create --title "..." --body "..."`
- Read an issue: `gh issue view <number> --comments`
- List issues: `gh issue list --state open --json number,title,body,labels,comments`
- Comment on an issue: `gh issue comment <number> --body "..."`
- Apply or remove labels: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- Close: `gh issue close <number> --comment "..."`

Infer the repo from `git remote -v`.

## Pull Requests As A Request Surface

PRs as a request surface: no.

Keep feature requests and specs in issues unless the user says otherwise.

## When A Skill Says "Publish To The Issue Tracker"

Create a GitHub issue only after explicit user approval.

If the user has not approved an external write, draft the issue body locally in the response or in a repo file they requested.

## When A Skill Says "Fetch The Relevant Ticket"

Use `gh issue view <number> --comments` when the issue number is known and external GitHub access is approved or already available.
