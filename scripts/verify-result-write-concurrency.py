#!/usr/bin/env python3
"""Two-session tests for the actual result-save prototype in a local disposable DB."""
import json
import pathlib
import selectors
import subprocess
import sys
import time

if sys.argv[1:] != ["yoso_approval_revision_test"]:
    raise SystemExit("Only disposable yoso_approval_revision_test is allowed")
root = pathlib.Path(__file__).resolve().parents[1]
PSQL = ["sudo", "-u", "postgres", "psql", "-h", "/var/run/postgresql",
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", sys.argv[1]]
AUTH = ("SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';"
        "SET ROLE authenticated;")


def sql(query):
    result = subprocess.run(PSQL, input=query, text=True, capture_output=True, timeout=10)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()


def line(proc):
    with selectors.DefaultSelector() as selector:
        selector.register(proc.stdout, selectors.EVENT_READ)
        assert selector.select(timeout=10), "session did not return a result"
    value = proc.stdout.readline().strip()
    assert value, "unexpected end of session output"
    return value


def send(proc, query):
    proc.stdin.write(query + "\n")
    proc.stdin.flush()


def save(label, score, event="save"):
    rows = [] if event != "save" else [{
        "event_id": event, "round_key": "R1", "match_no": 1,
        "team1_id": "10000000-0000-0000-0000-000000000001",
        "team2_id": "10000000-0000-0000-0000-000000000002",
        "team1_score": score, "team2_score": 1,
        "winner_team_id": "10000000-0000-0000-0000-000000000001",
        "loser_team_id": "10000000-0000-0000-0000-000000000002",
        "status": "completed"}]
    # All interpolated values are fixed test constants, never external/user inputs.
    return ("SELECT public.save_koshien_result_snapshot("
            f"'{event}','{json.dumps(rows)}','[]','{json.dumps({'writer': label})}');")


def cancel():
    return "SELECT public.cancel_koshien_match_result('save','R1',1,'{\"writer\":\"second\"}','[]');"


def race(finish, first_score, second_score, expected_revision, first_cancel=False, second_cancel=False):
    sessions = []
    try:
        a = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, bufsize=1)
        sessions.append(a)
        send(a, "SELECT pg_backend_pid();")
        a_pid = int(line(a))
        send(a, "BEGIN;" + AUTH + (cancel() if first_cancel else save("first", first_score)))
        first_result = json.loads(line(a))
        assert first_result.get("status") == "scheduled" if first_cancel else first_result["matches"] == 1
        b = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
        sessions.append(b)
        send(b, "SET application_name='yoso_result_save_b';"
             "SET statement_timeout='15s';" + AUTH + (cancel() if second_cancel else save("second", second_score)))
        # Observe a real lock wait, not a sleep-based assumption.
        deadline = time.monotonic() + 8
        while sql("SELECT count(*) FROM pg_stat_activity "
                  "WHERE application_name='yoso_result_save_b' "
                  f"AND {a_pid}=ANY(pg_blocking_pids(pid));") != "1":
            assert b.poll() is None, "second save failed instead of blocking"
            assert time.monotonic() < deadline, "second save did not wait for first"
            time.sleep(0.05)
        # Another event can save while both writers for this event are active.
        other = sql("SET lock_timeout='1s';" + AUTH + save("independent", 0, "independent"))
        assert json.loads(other)["results"] == 1
        send(a, finish + ";")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode == 0, a.stderr.read()
        output, errors = b.communicate(timeout=10)
        assert b.returncode == 0, errors
        second_result = json.loads(output)
        assert second_result.get("status") == "scheduled" if second_cancel else second_result["matches"] == 1
        actual = sql("SELECT jsonb_build_array(r.revision,m.team1_score,x.payload->>'writer') "
                     "FROM yoso_approval_private.revisions r "
                     "JOIN public.matches m ON m.event_id=r.event_id "
                     "JOIN public.results x ON x.event_id=r.event_id WHERE r.event_id='save';")
        assert json.loads(actual) == [expected_revision, None if second_cancel else second_score, "second"], actual
        print(f"PASS: first_cancel={first_cancel}, second_cancel={second_cancel}, {finish}: lock wait and revision/results consistent")
    finally:
        for proc in sessions:
            if proc.poll() is None:
                proc.kill()
                proc.wait()


# Previous transactional fixture rolled back. Install it for concurrent visibility.
setup = (root / "tests/sql/result-write-fixture.sql").read_text()
setup += "\n" + (root / "supabase/prototypes/koshien-result-write.sql").read_text()
setup += "\n" + (root / "tests/sql/result-cancel-fixture.sql").read_text()
setup += "\n" + (root / "supabase/prototypes/koshien-result-cancel.sql").read_text()
setup += "\nINSERT INTO public.events VALUES ('independent','koshien'," \
         "'00000000-0000-0000-0000-000000000010',now());\nCOMMIT;"
sql(setup)
try:
    sql((root / "tests/sql/result-cancel-checks.sql").read_text())
    print("PASS: cancellation authorization, downstream guards, revision and audit checks")
    race("COMMIT", 3, 4, 2)
    # A's increment and match write roll back; only B's increment survives.
    race("ROLLBACK", 8, 7, 3)
    race("COMMIT", 8, 0, 5, second_cancel=True)
    assert sql("SELECT previous_match->>'team1_score' FROM public.koshien_result_cancellations;") == "8"
    sql(AUTH + save("seed", 9))
    race("COMMIT", 0, 10, 8, first_cancel=True)
    assert sql("SELECT count(*) FROM public.koshien_result_cancellations;") == "2"
    assert sql("SELECT revision FROM yoso_approval_private.revisions "
               "WHERE event_id='independent';") == "4"
finally:
    # Roles are cluster-scoped; DB deletion alone would not remove them.
    sql("DROP OWNED BY authenticated,anon; DROP ROLE authenticated,anon;")
print("PASS: four save/cancel RPC concurrency scenarios")
