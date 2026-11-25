"""Expand only explicitly allowlisted reviewed SQL into disposable DB tests."""
from pathlib import Path
import sys

ALLOWED = {
    "supabase/release-candidates/koshien-official-integrity/rollback-draft-open-permit.sql",
    "supabase/release-candidates/koshien-official-integrity/draft-open-permit.sql",
    "supabase/release-candidates/koshien-official-integrity/import-identity.sql",
    "supabase/release-candidates/koshien-official-integrity/schedule-year.sql",
    "supabase/release-candidates/koshien-official-integrity/rollback-import-identity.sql",
}
root = Path(__file__).resolve().parents[1]
source = (root / sys.argv[1]).read_text(encoding="utf-8")
seen = set()
for line in source.splitlines(keepends=True):
    if line.startswith("-- @include "):
        candidate = line.strip().removeprefix("-- @include ")
        if candidate not in ALLOWED or candidate in seen:
            raise SystemExit(f"Invalid candidate include: {candidate}")
        seen.add(candidate)
        print((root / candidate).read_text(encoding="utf-8"), end="\n")
    else:
        print(line, end="")
if not seen:
    raise SystemExit("No candidate included")
