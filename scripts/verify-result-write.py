#!/usr/bin/env python3
"""Run the real save RPC prototype with minimal dependencies, never on Supabase."""
import pathlib
import subprocess
import sys

if sys.argv[1:] != ["yoso_approval_revision_test"]:
    raise SystemExit("Only disposable yoso_approval_revision_test is allowed")
root = pathlib.Path(__file__).resolve().parents[1]
for checks in ("result-write-checks.sql", "result-direct-dml-checks.sql", "result-write-permit-checks.sql", "event-identity-checks.sql", "event-approval-state-checks.sql"):
    paths = ["tests/sql/result-write-fixture.sql",
             "supabase/prototypes/koshien-result-write.sql",
             f"tests/sql/{checks}"]
    if checks in ("result-write-permit-checks.sql", "event-identity-checks.sql", "event-approval-state-checks.sql"):
        paths.insert(2, "supabase/prototypes/koshien-result-write-permit.sql")
    if checks in ("event-identity-checks.sql", "event-approval-state-checks.sql"):
        paths[3:3] = ["tests/sql/event-identity-fixture.sql",
                      "supabase/prototypes/koshien-event-identity.sql"]
    if checks == "event-approval-state-checks.sql":
        paths[-1:-1] = ["tests/sql/event-approval-state-fixture.sql",
                        "supabase/prototypes/koshien-event-approval-state.sql"]
    query = "\n".join((root / path).read_text() for path in paths)
    subprocess.run(["sudo", "-u", "postgres", "psql", "-h", "/var/run/postgresql",
                    "-X", "-v", "ON_ERROR_STOP=1", "-d", sys.argv[1]],
                   input=query, text=True, check=True, timeout=30)
