#!/usr/bin/env python3
"""Test only in a disposable local PostgreSQL database; no Supabase credentials."""
import pathlib
import selectors
import subprocess
import sys

if len(sys.argv) != 2 or sys.argv[1] != "yoso_approval_revision_test":
    raise SystemExit("Only disposable yoso_approval_revision_test is allowed")
PSQL = ["sudo", "-u", "postgres", "psql", "-X", "-qAt",
        "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", sys.argv[1]]
passed = 0


def sql(query, expected=None, error=None):
    global passed
    result = subprocess.run(PSQL, input=query, text=True, capture_output=True, timeout=10)
    if error:
        assert result.returncode != 0 and error in result.stderr, result
    else:
        assert result.returncode == 0, result.stderr
        if expected is not None:
            assert result.stdout.strip() == expected, result.stdout
    if expected is not None or error:
        passed += 1


sql("CREATE TABLE public.events(id text PRIMARY KEY, preset_type text NOT NULL);"
    "INSERT INTO public.events VALUES ('a','koshien'),('b','koshien'),('c','other');")
source = pathlib.Path(__file__).resolve().parents[1] / "supabase/prototypes/koshien-approval-revision.sql"
sql(source.read_text())
sql("SELECT yoso_approval_private.lock_revision('a');", "0")
sql("SELECT yoso_approval_private.advance_revision('a',0);", "1")
sql("SELECT yoso_approval_private.advance_revision('a',0);", error="40001")
sql("SELECT yoso_approval_private.advance_revision('a',NULL);", error="22023")
sql("SELECT yoso_approval_private.advance_revision('a',-1);", error="22023")
sql("SELECT yoso_approval_private.lock_revision('missing');", error="P0002")
sql("SELECT yoso_approval_private.lock_revision('c');", error="P0002")
sql("SELECT count(*) FROM yoso_approval_private.revisions WHERE event_id IN ('missing','c');", "0")
sql("BEGIN; SELECT yoso_approval_private.advance_revision('a',1); ROLLBACK;", "2")
sql("SELECT yoso_approval_private.lock_revision('a');", "1")
# Two changes advance twice even if the caller restores original result content.
sql("SELECT yoso_approval_private.advance_revision('a',1);"
    "SELECT yoso_approval_private.advance_revision('a',2);", "2\n3")
sql("SELECT yoso_approval_private.advance_revision('a',1);", error="40001")

# No PUBLIC schema/function/table access. The test role rolls back on error.
sql("BEGIN; CREATE ROLE yoso_approval_untrusted NOLOGIN;"
    "SET LOCAL ROLE yoso_approval_untrusted;"
    "SELECT yoso_approval_private.lock_revision('a');", error="42501")
sql("BEGIN; CREATE ROLE yoso_approval_untrusted NOLOGIN;"
    "GRANT USAGE ON SCHEMA yoso_approval_private TO yoso_approval_untrusted;"
    "SET LOCAL ROLE yoso_approval_untrusted;"
    "SELECT yoso_approval_private.advance_revision('a',3);", error="42501")
sql("BEGIN; CREATE ROLE yoso_approval_untrusted NOLOGIN;"
    "GRANT USAGE ON SCHEMA yoso_approval_private TO yoso_approval_untrusted;"
    "SET LOCAL ROLE yoso_approval_untrusted;"
    "UPDATE yoso_approval_private.revisions SET revision=0;", error="42501")

# Wait for actual query output before session B starts; no timed sleep for ordering.
session = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE, text=True, bufsize=1)
try:
    session.stdin.write("BEGIN; SELECT yoso_approval_private.advance_revision('a',3);\n")
    session.stdin.flush()
    with selectors.DefaultSelector() as selector:
        selector.register(session.stdout, selectors.EVENT_READ)
        assert selector.select(timeout=10), "session A did not acquire lock"
    assert session.stdout.readline().strip() == "4"
    sql("SET lock_timeout='500ms'; SELECT yoso_approval_private.advance_revision('b',0);", "1")
    sql("SET lock_timeout='500ms'; SELECT id FROM public.events WHERE id='a' FOR UPDATE;", error="55P03")
    sql("SET lock_timeout='500ms'; SELECT yoso_approval_private.advance_revision('a',3);", error="55P03")
    session.stdin.write("COMMIT;\n")
    session.stdin.flush()
    session.stdin.close()
    session.wait(timeout=10)
    assert session.returncode == 0, session.stderr.read()
finally:
    if session.poll() is None:
        session.kill()
        session.wait()
sql("SELECT yoso_approval_private.advance_revision('a',3);", error="40001")
sql("SELECT yoso_approval_private.advance_revision('a',4);", "5")
sql("SELECT revision FROM yoso_approval_private.revisions WHERE event_id='b';", "1")
sql("SELECT count(*) FROM pg_roles WHERE rolname='yoso_approval_untrusted';", "0")
print(f"PASS: {passed} approval revision assertions, including two-session locking")
