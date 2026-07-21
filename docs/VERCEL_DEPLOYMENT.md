# Vercel preview deployment

YOSO is a static HTML, CSS, and JavaScript application. It does not require an install or build step.

## Git project settings

- Branch: `codex/vercel-release-candidate`
- Root Directory: repository root (`.`)
- Framework Preset: Other
- Install Command: none
- Build Command: none
- Output Directory: repository root (`.`)

`vercel.json` fixes the framework preset to Other and maps the ignored local
`supabase-config.js` path to a tracked no-op JavaScript file. The public,
browser-safe Supabase defaults continue to load from
`js/supabase-public-config.js`; no secret configuration is deployed.

## Routing

The application uses fragment routes such as `/#home` and `/#settings`.
Fragment navigation is handled entirely by the browser, so an SPA catch-all
rewrite is not required. Query parameters on `/` or `/index.html` are preserved
by Vercel.

All HTML, JavaScript, CSS, manifest, and image references use relative paths.
Vercel should therefore deploy this repository at the domain root, without a
GitHub Pages base path.

## Authentication redirects

Before production use, add the assigned Vercel URL to the approved Supabase
Auth redirect URLs. Do not place privileged keys in Vercel variables or in the
repository. Client-side code may use only the already approved public anon key.

This document does not authorize a deployment or any Supabase configuration
change.
