# koshien-auto-sync deployment

## Reviewed release candidate (not deployed)

The wrapper imports the reviewed worker at `c6ad7ceff3a53f3855c9dd89e08cff45a93f069f`. Its import map retains the tested core override at `2510ca0bc737796d6345420ca806d4f81e72cda2`. CI checks the exact wrapper and immutable dependency blobs. Deploy only after required DB guards are in place and explicit approval is recorded.

Deploy index.ts and deno.json as root files with the existing import_map_path=deno.json and verify_jwt=false configuration. The worker authenticates the automation token; do not expose or print the production token.

## Exact rollback

Observed production v5 source/config equals the files at `6db64bf4417aa0a8f34634354eb42e9ea636c6d2` under this directory. Its worker is pinned to `d0736692446a4b6b0cb0ed6e5dcb72e4f0e4f8f6` and its core override to `2510ca0bc737796d6345420ca806d4f81e72cda2`. Restore both files together if separately approved; re-fetch live source/config first. Do not replace deno.json with an empty import map: that restores older v4 behavior instead of the actual v5 baseline.

See ../../release-candidates/koshien-official-integrity/release-manifest.json for pinned inputs.
