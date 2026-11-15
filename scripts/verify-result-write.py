#!/usr/bin/env python3
"""Run the real save RPC prototype with minimal dependencies, never on Supabase."""
import pathlib
import subprocess
import sys

if sys.argv[1:] != ["yoso_approval_revision_test"]:
    raise SystemExit("Only disposable yoso_approval_revision_test is allowed")
root = pathlib.Path(__file__).resolve().parents[1]
paths = ["tests/sql/result-write-fixture.sql",
         "supabase/prototypes/koshien-result-write.sql",
         "tests/sql/result-write-checks.sql"]
query = "\n".join((root / path).read_text() for path in paths)
subprocess.run(["sudo", "-u", "postgres", "psql", "-h", "/var/run/postgresql",
                "-X", "-v", "ON_ERROR_STOP=1", "-d", sys.argv[1]],
               input=query, text=True, check=True, timeout=30)
