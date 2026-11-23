#!/usr/bin/env python3
"""Service-only auto-apply integration against the disposable local fixture."""
import pathlib
import subprocess
import sys
if sys.argv[1:] != ["yoso_approval_revision_test"]:
    raise SystemExit("Only disposable yoso_approval_revision_test is allowed")
root = pathlib.Path(__file__).resolve().parents[1]
paths = ["tests/sql/auto-result-fixture.sql",
         "supabase/prototypes/koshien-auto-result-write.sql",
         "tests/sql/auto-result-checks.sql"]
subprocess.run(["sudo", "-u", "postgres", "psql", "-h", "/var/run/postgresql",
                "-X", "-v", "ON_ERROR_STOP=1", "-d", sys.argv[1]],
               input="\n".join((root / p).read_text() for p in paths),
               text=True, check=True, timeout=30)
