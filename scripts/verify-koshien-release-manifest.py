"""Verify immutable reviewed release inputs locally. Never connects to production."""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "supabase/release-candidates/koshien-official-integrity/release-manifest.json"

def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()

def require(condition, message):
    if not condition:
        raise SystemExit(message)

def check_file(spec, pinned=False):
    path = spec["path"]
    require(path.startswith("supabase/") and ".." not in Path(path).parts, "invalid release path")
    require(re.fullmatch(r"[0-9a-f]{40}", spec["blob"]), "invalid blob")
    if pinned:
        ref = spec["ref"]
        require(re.fullmatch(r"[0-9a-f]{40}", ref), "invalid pinned commit")
        actual = git("rev-parse", f"{ref}:{path}")
    else:
        actual = git("hash-object", "--", path)
        reviewed = git("rev-parse", f"{manifest['source_commit']}:{path}")
        require(reviewed == spec["blob"], f"reviewed source drift: {path}")
    require(actual == spec["blob"], f"release source drift: {path}")

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
require(manifest["format"] == 1 and manifest["pr"] == 58, "wrong release manifest")
for key in ("base_commit", "source_commit"):
    require(re.fullmatch(r"[0-9a-f]{40}", manifest[key]), "invalid commit")
    git("cat-file", "-e", manifest[key] + "^{commit}")
require([x["path"] for x in manifest["db_apply_order"]] == ["supabase/migrations/20261124100000_guard_koshien_draft_open.sql","supabase/migrations/20261124110000_keep_open_koshien_rounds_confirmed.sql","supabase/migrations/20261124120000_keep_confirmed_koshien_start_rounds.sql","supabase/release-candidates/koshien-official-integrity/draft-open-permit.sql","supabase/release-candidates/koshien-official-integrity/import-identity.sql","supabase/release-candidates/koshien-official-integrity/schedule-year.sql"], "unexpected DB release order")
count = 0
for group in ("db_apply_order", "db_rollback_candidates", "read_only_checks"):
    for spec in manifest[group]:
        check_file(spec)
        count += 1
require([e["slug"] for e in manifest["edge_functions"]] == ["jhbf-schedule", "jhbf-results", "koshien-auto-sync"], "wrong Edge function order")
require([e["verify_jwt"] for e in manifest["edge_functions"]] == [True, True, False], "unexpected JWT config")
for edge in manifest["edge_functions"]:
    for spec in edge["candidate"]:
        check_file(spec)
        count += 1
    for group in ("rollback", "immutable_dependencies", "rollback_dependencies"):
        for spec in edge.get(group, []):
            check_file(spec, pinned=True)
            count += 1
    if edge["slug"] == "jhbf-schedule":
        parser = next(x for x in edge["rollback"] if x["path"].endswith("jhbf-schedule-parser.mjs"))
        require(parser["ref"] == "057b17c0e5bd5b050fd648b638775329980b48ff", "wrong live parser rollback pin")
        require(parser["blob"] != next(x["blob"] for x in edge["candidate"] if x["path"] == parser["path"]), "rollback parser must match observed live source")
print(f"PASS: {count} pinned release/rollback file references; no production access")
