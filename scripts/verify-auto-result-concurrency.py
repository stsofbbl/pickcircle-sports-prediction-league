#!/usr/bin/env python3
"""Race service-only auto-apply against authenticated save/cancel; local DB only."""
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
USER = ("SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';"
        "SET ROLE authenticated;")
TEAM1 = "30000000-0000-0000-0000-000000000001"
TEAM2 = "30000000-0000-0000-0000-000000000002"
ROW = dict(roundKey="R1", matchNo=1, matchId="40000000-0000-0000-0000-000000000001",
           team1Id=TEAM1, team2Id=TEAM2, team1Score=3, team2Score=1,
           winnerTeamId=TEAM1, loserTeamId=TEAM2,
           externalKey="jhbf:summer:2026:2026-08-01:1",
           sourceUrl="https://www.jhbf.or.jp/sensyuken/2026/schedule/schedule_20260801.html")
ROW["normalizedPayload"] = dict(ROW, source="jhbf")


def sql(query):
    r = subprocess.run(PSQL, input=query, text=True, capture_output=True, timeout=15)
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def payload(score):
    return json.dumps({"matches": [{"round": "R1", "match_no": 1,
                                    "score_a": score,
                                    "status": "scheduled" if score is None else "completed"}]})


def action(kind):
    if kind == "auto":
        return ("SET ROLE service_role;SELECT public.auto_apply_koshien_official_results"
                f"('auto','{json.dumps([ROW])}');")
    if kind == "cancel":
        return USER + f"SELECT public.cancel_koshien_match_result('auto','R1',1,'{payload(None)}','[]');"
    score = int(kind)
    rows = [dict(event_id="auto", round_key="R1", match_no=1,
                 team1_id=TEAM1, team2_id=TEAM2, team1_score=score, team2_score=1,
                 winner_team_id=TEAM1, loser_team_id=TEAM2, status="completed")]
    return USER + f"SELECT public.save_koshien_result_snapshot('auto','{json.dumps(rows)}','[]','{payload(score)}');"


def send(p, query):
    p.stdin.write(query + "\n")
    p.stdin.flush()


def line(p):
    with selectors.DefaultSelector() as sel:
        sel.register(p.stdout, selectors.EVENT_READ)
        assert sel.select(10), "session output timeout"
    result = p.stdout.readline().strip()
    assert result, "session ended before completing SQL"
    return result


def reset():
    sql("DELETE FROM public.external_match_imports WHERE event_id='auto';"
        "DELETE FROM public.koshien_result_cancellations WHERE event_id='auto';"
        "DELETE FROM yoso_approval_private.revisions WHERE event_id='auto';"
        "UPDATE public.matches SET status='scheduled',team1_score=NULL,team2_score=NULL,"
        "winner_team_id=NULL,loser_team_id=NULL WHERE event_id='auto';"
        f"UPDATE public.results SET payload='{payload(None)}' WHERE event_id='auto';")


def race(first, second, finish, expected, seed=False):
    reset()
    if seed:
        sql(action("auto"))
    sessions = []
    try:
        a = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, bufsize=1)
        sessions.append(a)
        send(a, "SELECT pg_backend_pid();")
        pid = int(line(a))
        send(a, "BEGIN;" + action(first))
        json.loads(line(a))
        b = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
        sessions.append(b)
        send(b, "SET application_name='yoso_auto_race';SET statement_timeout='15s';" + action(second))
        limit = time.monotonic() + 8
        while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='yoso_auto_race' "
                  f"AND {pid}=ANY(pg_blocking_pids(pid));") != "1":
            assert b.poll() is None and time.monotonic() < limit, "second RPC did not wait"
            time.sleep(0.05)
        send(a, finish + ";")
        a.stdin.close()
        a.wait(10)
        assert a.returncode == 0, a.stderr.read()
        out, err = b.communicate(timeout=10)
        assert b.returncode == 0, err
        result = json.loads(out)
        actual = json.loads(sql(
            "SELECT jsonb_build_array(r.revision,m.status,m.team1_score,"
            "(SELECT status FROM public.external_match_imports WHERE event_id='auto'),"
            "(x.payload->'matches'->0->>'score_a')::int) "
            "FROM yoso_approval_private.revisions r JOIN public.matches m ON m.event_id=r.event_id "
            "JOIN public.results x ON x.event_id=r.event_id WHERE r.event_id='auto';"))
        assert actual == expected, (actual, expected)
        if second == "auto":
            assert result["blocked" if first == "cancel" else "skipped"] == 1, result
        if "cancel" in (first, second):
            assert sql("SELECT previous_match->>'team1_score' FROM public.koshien_result_cancellations "
                       "WHERE event_id='auto';") == "3"
        print(f"PASS: {first} -> {second}, {finish}: lock, revision, match, payload, import consistent")
    finally:
        for p in sessions:
            if p.poll() is None:
                p.kill()
                p.wait()


paths = ["tests/sql/auto-result-fixture.sql",
         "supabase/prototypes/koshien-auto-result-write.sql",
         "tests/sql/auto-result-concurrency-fixture.sql",
         "tests/sql/fixtures/external-import-status-trigger.sql"]
sql("\n".join((root / p).read_text() for p in paths) + "\nCOMMIT;")
try:
    race("auto", "4", "COMMIT", [2, "completed", 4, "confirmed", 4])
    race("3", "auto", "COMMIT", [1, "completed", 3, None, 3])
    race("auto", "cancel", "COMMIT", [2, "scheduled", None, "canceled", None])
    race("cancel", "auto", "COMMIT", [2, "scheduled", None, "canceled", None], seed=True)
    race("auto", "4", "ROLLBACK", [1, "completed", 4, None, 4])
finally:
    sql("DROP OWNED BY authenticated,anon,service_role; DROP ROLE authenticated,anon,service_role;")
print("PASS: five automatic/manual result RPC race scenarios")
