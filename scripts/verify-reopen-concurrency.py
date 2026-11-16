#!/usr/bin/env python3
"""Race reopen against result save/cancel in a disposable local database."""
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



def reopen():
    return "SELECT public.reopen_koshien_results('save');"


def reset(legacy=False):
    # Trusted fixture seeding uses the real writer and exact transition permits.
    state = "resultWait" if legacy else "finalized"
    sql("BEGIN;" + AUTH + save("seed", 3) + "RESET ROLE;"
        "INSERT INTO yoso_approval_private.transition_permits "
        "SELECT id,txid_current(),auth.uid(),status,'" + state + "',"
        "rules->'resultFlow','{\"status\":\"finalized\"}' FROM public.events WHERE id='save';"
        "UPDATE public.events SET status='" + state + "',"
        "rules=jsonb_set(rules,'{resultFlow}','{\"status\":\"finalized\"}',true) WHERE id='save';"
        "DELETE FROM yoso_approval_private.transition_permits WHERE event_id='save';"
        "DELETE FROM public.koshien_result_reopens WHERE event_id='save';"
        "DELETE FROM public.koshien_result_cancellations WHERE event_id='save';"
        "DELETE FROM yoso_approval_private.revisions WHERE event_id='save';COMMIT;")


def race(first, second, finish, expected):
    reset()
    sessions = []
    try:
        a = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, bufsize=1)
        sessions.append(a)
        send(a, "SELECT pg_backend_pid();")
        pid = int(line(a))
        send(a, "BEGIN;" + AUTH + first)
        json.loads(line(a))
        b = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
        sessions.append(b)
        send(b, "SET application_name='yoso_reopen_b';SET statement_timeout='15s';" + AUTH + second)
        deadline = time.monotonic() + 8
        while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='yoso_reopen_b' "
                  f"AND {pid}=ANY(pg_blocking_pids(pid));") != "1":
            if b.poll() is not None:
                raise AssertionError(b.stderr.read())
            assert time.monotonic() < deadline, "second writer did not wait"
            time.sleep(0.05)
        send(a, finish + ";")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode == 0, a.stderr.read()
        output, errors = b.communicate(timeout=10)
        assert b.returncode == 0, errors
        json.loads(output)
        actual = json.loads(sql(
            "SELECT jsonb_build_array(r.revision,e.status,m.team1_score,"
            "(SELECT count(*) FROM public.koshien_result_reopens WHERE event_id='save')) "
            "FROM public.events e JOIN public.matches m ON m.event_id=e.id "
            "JOIN yoso_approval_private.revisions r ON r.event_id=e.id WHERE e.id='save';"))
        assert actual == expected, (actual, expected)
        assert sql("SELECT count(*) FROM yoso_approval_private.transition_permits;") == "0"
        assert sql("SELECT count(*) FROM public.koshien_result_reopens "
                   "WHERE previous_event->>'status' <> 'finalized' OR reopened_by IS DISTINCT FROM "
                   "'00000000-0000-0000-0000-000000000001'::uuid;") == "0"
        sql(AUTH + "SELECT public.test_reject($q$UPDATE public.events SET rules='{}' "
            "WHERE id='save'$q$,'42501');")
        print(f"PASS: reopen race {finish}: {expected}")
    finally:
        for p in sessions:
            if p.poll() is None:
                if p.stdin and not p.stdin.closed:
                    p.stdin.close()
                try:
                    p.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    p.kill()
                    p.wait()


# Runs after auto-result concurrency; existing roles were removed, DB persists.
setup = """
BEGIN;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE anon NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA public,auth,yoso_approval_private TO authenticated;
GRANT SELECT ON public.events,public.teams,public.players TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.matches,public.results,public.scores TO authenticated;
GRANT UPDATE ON public.events TO authenticated;
-- Recreated role must retain access used by the invoker import-sync trigger.
GRANT SELECT,UPDATE ON public.external_match_imports TO authenticated;
GRANT EXECUTE ON FUNCTION yoso_approval_private.begin_result_write(text) TO authenticated;
ALTER TABLE public.events ADD COLUMN status text DEFAULT 'resultWait';
ALTER TABLE public.events ADD COLUMN rules jsonb DEFAULT '{}';
DROP POLICY IF EXISTS results_admin ON public.results;
CREATE POLICY results_admin ON public.results FOR ALL TO authenticated
 USING(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)))
 WITH CHECK(EXISTS(SELECT 1 FROM public.events e WHERE e.id=event_id AND public.is_league_admin(e.league_id)));
"""
paths = ["tests/sql/event-reopen-fixture.sql",
         "supabase/prototypes/koshien-event-identity.sql",
         "supabase/prototypes/koshien-event-approval-state.sql",
         "supabase/prototypes/koshien-transition-permit.sql",
         "supabase/prototypes/koshien-result-reopen.sql"]
sql(setup + "\n" + "\n".join((root / p).read_text() for p in paths) + "\nCOMMIT;")
try:
    race(reopen(), save("second", 4), "COMMIT", [2, "resultWait", 4, 1])
    race(save("first", 4), reopen(), "COMMIT", [2, "resultWait", 4, 1])
    race(reopen(), cancel(), "COMMIT", [2, "resultWait", None, 1])
    race(cancel(), reopen(), "COMMIT", [2, "resultWait", None, 1])
    race(reopen(), reopen(), "ROLLBACK", [1, "resultWait", 3, 1])
    reset(legacy=True)
    sql(AUTH + reopen())
    assert sql("SELECT status FROM public.events WHERE id='save';") == "resultWait"
    assert sql("SELECT previous_event->>'status' FROM public.koshien_result_reopens;") == "resultWait"
    print("PASS: legacy flow-only finalized state reopens with audit")
    reset()
    sql("UPDATE public.league_members SET membership_status='inactive' "
        "WHERE user_id='00000000-0000-0000-0000-000000000001';")
    sql(AUTH + "SELECT public.test_reject($q$SELECT public.reopen_koshien_results('save')$q$,'42501');")
    assert sql("SELECT count(*) FROM public.koshien_result_reopens;") == "0"
    assert sql("SELECT status FROM public.events WHERE id='save';") == "finalized"
    print("PASS: inactive owner reopen rejected without mutation")
finally:
    sql("DROP OWNED BY authenticated,anon; DROP ROLE authenticated,anon;")
