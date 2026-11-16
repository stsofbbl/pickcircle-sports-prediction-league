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
    # Reopen any previous finalized fixture before writing its next seed.
    if sql("SELECT count(*) FROM public.events WHERE id='save' AND "
           "(status='finalized' OR rules->'resultFlow'->>'status'='finalized');") == "1":
        sql(AUTH + reopen())
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


def race(first, second, finish, expected, rejected=False):
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
        if rejected:
            assert b.returncode != 0 and "reopen finalized results before editing" in errors, errors
        else:
            assert b.returncode == 0, errors
            json.loads(output)
        actual = json.loads(sql(
            "SELECT jsonb_build_array(coalesce(r.revision,0),e.status,m.team1_score,"
            "(SELECT count(*) FROM public.koshien_result_reopens WHERE event_id='save')) "
            "FROM public.events e JOIN public.matches m ON m.event_id=e.id "
            "LEFT JOIN yoso_approval_private.revisions r ON r.event_id=e.id WHERE e.id='save';"))
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

    # Baseline races above reproduce the old finalized-write behavior.
    sql((root / "supabase/prototypes/koshien-finalized-result-guard.sql").read_text())
    sql("UPDATE public.league_members SET membership_status='active' "
        "WHERE user_id='00000000-0000-0000-0000-000000000001';")

    def snapshot():
        tables = ["public.events", "public.matches", "public.results", "public.scores",
                  "public.koshien_result_reopens", "public.koshien_result_cancellations",
                  "public.external_match_imports", "yoso_approval_private.revisions",
                  "yoso_approval_private.write_permits", "yoso_approval_private.transition_permits"]
        return [sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
                    "FROM " + table + " t;") for table in tables]

    for legacy in [False, True]:
        reset(legacy=legacy)
        before = snapshot()
        for statement in [save("denied", 7), cancel()]:
            sql(AUTH + "SELECT public.test_reject($q$" + statement + "$q$,'55000');")
            assert snapshot() == before, "finalized denial must roll back every table"
        print(f"PASS: finalized save/cancel unchanged (legacy={legacy})")

    # Actual event-lock waits, with both commit and rollback of the opener.
    race(reopen(), save("second", 4), "COMMIT", [2, "resultWait", 4, 1])
    race(reopen(), cancel(), "COMMIT", [2, "resultWait", None, 1])
    race(reopen(), save("second", 4), "ROLLBACK", [0, "finalized", 3, 0], rejected=True)
    race(reopen(), cancel(), "ROLLBACK", [0, "finalized", 3, 0], rejected=True)

    # A permit issued earlier in this transaction must not bypass later finalization.
    sql("BEGIN;" + AUTH + reopen() +
        "SELECT yoso_approval_private.begin_result_write('save');RESET ROLE;"
        "INSERT INTO yoso_approval_private.transition_permits "
        "SELECT id,txid_current(),auth.uid(),status,'finalized',rules->'resultFlow',"
        "'{\"status\":\"finalized\"}' FROM public.events WHERE id='save';"
        "UPDATE public.events SET status='finalized',rules=jsonb_set(rules,'{resultFlow}',"
        "'{\"status\":\"finalized\"}',true) WHERE id='save';" + AUTH +
        "SELECT public.test_reject($q$UPDATE public.matches SET team1_score=9 "
        "WHERE event_id='save'$q$,'55000');ROLLBACK;")
    print("PASS: earlier writer permit cannot bypass finalization")

    # Auto-apply uses a real scheduled match and service-only RPC, without impersonation.
    sql("CREATE ROLE service_role NOLOGIN NOSUPERUSER NOBYPASSRLS;"
        "GRANT USAGE ON SCHEMA public TO service_role;"
        "GRANT EXECUTE ON FUNCTION public.auto_apply_koshien_official_results(text,jsonb) TO service_role;")
    row = json.loads((root / "tests/sql/auto-result-checks.sql").read_text().split("'auto','", 1)[1].split("')$q$", 1)[0])
    auto_call = "SELECT public.auto_apply_koshien_official_results('auto','" + json.dumps(row) + "');"
    sql("BEGIN;SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';"
        "SELECT yoso_approval_private.issue_write_permit('auto');"
        "DELETE FROM public.external_match_imports WHERE event_id='auto';"
        "UPDATE public.matches SET status='scheduled',team1_score=NULL,team2_score=NULL,"
        "winner_team_id=NULL,loser_team_id=NULL WHERE event_id='auto';"
        "INSERT INTO yoso_approval_private.transition_permits "
        "SELECT id,txid_current(),auth.uid(),status,'finalized',rules->'resultFlow',"
        "'{\"status\":\"finalized\"}' FROM public.events WHERE id='auto';"
        "UPDATE public.events SET status='finalized',rules='{\"resultFlow\":{\"status\":\"finalized\"}}' "
        "WHERE id='auto';COMMIT;")
    before = snapshot()
    sql("SET ROLE service_role;SELECT public.test_reject($q$" + auto_call + "$q$,'55000');")
    assert snapshot() == before, "rejected automatic apply must leave no partial changes"
    sql(AUTH + "SELECT public.reopen_koshien_results('auto');")
    sql("SET ROLE service_role;" + auto_call)
    assert sql("SELECT team1_score FROM public.matches WHERE event_id='auto';") == "3"
    print("PASS: automatic apply rejected when finalized and succeeds after authorized reopen")

    # Real deferred downstream trigger + real scoring body/helpers.
    sql((root / "tests/sql/result-downstream-scoring-fixture.sql").read_text())
    sql(AUTH + reopen())
    base_row = dict(event_id="save", round_key="R2", match_no=1,
                    team1_id="10000000-0000-0000-0000-000000000001",
                    team2_id="10000000-0000-0000-0000-000000000002",
                    team1_score=3, team2_score=1,
                    winner_team_id="10000000-0000-0000-0000-000000000001",
                    loser_team_id="10000000-0000-0000-0000-000000000002", status="completed")
    slots = json.dumps({"matches": [{"round": "R2", "match_no": 1},
                                   {"round": "R3", "match_no": 1}]})

    def save_round(round_key):
        rows = json.dumps([dict(base_row, round_key=round_key)])
        return "SELECT public.save_koshien_result_snapshot('save','" + rows + "','[]','" + slots + "');"

    def phase1():
        return sql("SELECT phase1_score FROM public.scores WHERE event_id='save';")

    before = snapshot()
    sql("SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';"
        "SET ROLE authenticated;SELECT public.test_reject($q$" + save_round("R2") + "$q$,'42501');")
    assert snapshot() == before
    # Deadline is already in the past: result entry remains admin-authorized.
    sql(AUTH + save_round("R2"))
    assert float(phase1()) == 3.6, phase1()
    assert sql("SELECT team1_id::text FROM public.matches WHERE event_id='save' AND round_key='R3';") == base_row["team1_id"]
    assert sql("SELECT payload->'matches'->1->>'team_a_id' FROM public.results WHERE event_id='save';") == "Team A"
    print("PASS: deferred R2->R3 creation and real captain/multiplier scoring (3.6)")

    cancel_r2 = "SELECT public.cancel_koshien_match_result('save','R2',1,'" + slots + "','[]');"
    # Cancellation recalculates only supplied score rows; use the real player row.
    cancel_r2 = cancel_r2.replace("'[]');", "'[{\"event_id\":\"save\",\"player_id\":\"20000000-0000-0000-0000-000000000001\",\"phase1_score\":999}]');")
    sql(AUTH + cancel_r2)
    assert float(phase1()) == 2.4, phase1()
    assert sql("SELECT team1_id IS NULL FROM public.matches WHERE event_id='save' AND round_key='R3';") == "t"
    assert sql("SELECT payload->'matches'->1->>'team_a_id' FROM public.results WHERE event_id='save';") == ""
    print("PASS: cancellation clears downstream card and recomputes supplied 999 to 2.4")

    sql(AUTH + save_round("R2"))
    sql(AUTH + save_round("R3"))
    assert float(phase1()) == 4.8, phase1()
    before = snapshot()
    failed = subprocess.run(PSQL, input="BEGIN;" + AUTH + cancel_r2 + "COMMIT;",
                            text=True, capture_output=True, timeout=10)
    assert failed.returncode != 0 and "dependent completed match exists" in failed.stderr, failed.stderr
    assert snapshot() == before, "deferred failure must roll back result, score, audit and revision"
    print("PASS: commit-time downstream rejection rolls back all ten tracked tables")

    # Finalized gate with the production trigger bodies installed.
    sql("BEGIN;SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';"
        "INSERT INTO yoso_approval_private.transition_permits "
        "SELECT id,txid_current(),auth.uid(),status,'finalized',rules->'resultFlow',"
        "'{\"status\":\"finalized\"}' FROM public.events WHERE id='save';"
        "UPDATE public.events SET status='finalized',rules='{\"resultFlow\":{\"status\":\"finalized\"}}' "
        "WHERE id='save';COMMIT;")
    before = snapshot()
    sql(AUTH + "SELECT public.test_reject($q$" + save_round("R2") + "$q$,'55000');")
    assert snapshot() == before
    print("PASS: finalized rejection retains downstream cards and recomputed scores")

    # Add actual R1 advancement and both existing result-correction guards.
    sql((root / "tests/sql/result-existing-guards-fixture.sql").read_text())
    sql(AUTH + reopen())
    sql("BEGIN;" + AUTH + "SELECT yoso_approval_private.begin_result_write('save');RESET ROLE;"
        "DELETE FROM public.matches WHERE event_id='save';"
        "INSERT INTO public.matches(event_id,round_key,match_no,team1_id,team2_id,status,metadata) VALUES "
        "('save','R1',1,'10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','scheduled','{}'),"
        "('save','R1',2,'10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','scheduled','{}'),"
        "('save','R2',1,NULL,NULL,'scheduled','{\"team1_source_match_no\":1}');"
        "UPDATE public.results SET payload='" + slots + "' WHERE event_id='save';COMMIT;")
    sql(AUTH + save_round("R1"))
    assert sql("SELECT team1_id::text FROM public.matches WHERE event_id='save' AND round_key='R2';") == base_row["team1_id"]
    assert sql("SELECT payload->'matches'->0->>'team_a_id' FROM public.results WHERE event_id='save';") == "Team A"
    print("PASS: official R1 advancement updates R2 card and results payload")

    cancel_r1 = "SELECT public.cancel_koshien_match_result('save','R1',1,'" + slots + "','[]');"
    sql(AUTH + cancel_r1)
    assert sql("SELECT team1_id IS NULL FROM public.matches WHERE event_id='save' AND round_key='R2';") == "t"
    assert sql("SELECT payload->'matches'->0->>'team_a_id' FROM public.results WHERE event_id='save';") == ""
    print("PASS: R1 cancellation clears official R2 slot through deferred trigger")
    sql(AUTH + save_round("R1"))
    sql(AUTH + save_round("R2"))
    before = snapshot()
    sql(AUTH + "SELECT public.test_reject($q$" + cancel_r1 + "$q$,'55000');")
    assert snapshot() == before
    print("PASS: completed downstream guard rejects cancellation without mutation")

    sql("INSERT INTO public.koshien_later_rounds VALUES('save','revenge','open');")
    changed_winner = dict(base_row, round_key="R1", team1_score=1, team2_score=3,
                          winner_team_id=base_row["team2_id"], loser_team_id=base_row["team1_id"])

    def save_rows(rows):
        return "SELECT public.save_koshien_result_snapshot('save','" + json.dumps(rows) + "','[]','" + slots + "');"

    before = snapshot()
    sql(AUTH + "SELECT public.test_reject($q$" + save_rows([changed_winner]) + "$q$,'55000');")
    assert snapshot() == before
    print("PASS: opened later phase rejects winner-changing correction")
    sql(AUTH + save_rows([dict(base_row, round_key="R1", team1_score=4)]))
    assert sql("SELECT team1_score FROM public.matches WHERE event_id='save' AND round_key='R1' AND match_no=1;") == "4"
    # The second synthetic scheduled card isolates the initial-completion exemption.
    sql(AUTH + save_rows([dict(base_row, round_key="R1", match_no=2)]))
    assert sql("SELECT status FROM public.matches WHERE event_id='save' AND round_key='R1' AND match_no=2;") == "completed"
    print("PASS: same-winner correction and initial completion remain allowed after phase opens")

    # Last production matches trigger: real zombie preparation + eligibility writer.
    sql((root / "tests/sql/result-zombie-integration-fixture.sql").read_text())

    def zombie_snapshot():
        return snapshot() + [
            sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') FROM " + table + " t;")
            for table in ["public.koshien_later_rounds", "public.koshien_zombie_eligibility"]]

    def zombie_update(deadline):
        return ("BEGIN;" + AUTH +
                "SELECT yoso_approval_private.begin_result_write('zombie-test');"
                "UPDATE public.matches SET starts_at=" + deadline + ",updated_at=now() "
                "WHERE event_id='zombie-test' AND round_key='SF';")

    before = zombie_snapshot()
    sql("SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';SET ROLE authenticated;"
        "SELECT public.test_reject($q$SELECT yoso_approval_private.begin_result_write('zombie-test')$q$,'42501');")
    assert zombie_snapshot() == before
    sql(AUTH + "SELECT public.test_reject($q$SELECT public.prepare_koshien_zombie_phase_internal("
        "'zombie-test',now(),now()+interval '1 day')$q$,'42501');")
    sql("SELECT public.test_reject($q$SELECT public.prepare_koshien_zombie_phase_internal("
        "'zombie-test',now(),now())$q$,'P0001');")
    assert zombie_snapshot() == before
    # Already elapsed deadlines must not create a round or eligibility rows.
    sql(zombie_update("clock_timestamp()-interval '1 second'") + "COMMIT;")
    assert sql("SELECT count(*) FROM public.koshien_later_rounds WHERE event_id='zombie-test';") == "0"
    assert sql("SELECT count(*) FROM public.koshien_zombie_eligibility;") == "0"
    print("PASS: unauthorized preparation and equal schedule rejected; elapsed deadline creates nothing")

    # A failure after eligibility insertion must roll back the caller's whole write.
    sql("CREATE FUNCTION public.test_fail_zombie() RETURNS trigger LANGUAGE plpgsql AS $f$ "
        "BEGIN RAISE EXCEPTION 'injected zombie failure'; END $f$;"
        "CREATE CONSTRAINT TRIGGER test_fail_zombie AFTER INSERT ON public.koshien_zombie_eligibility "
        "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.test_fail_zombie();")
    before = zombie_snapshot()
    failed = subprocess.run(PSQL, input=zombie_update("clock_timestamp()+interval '1 day'") + "COMMIT;",
                            text=True, capture_output=True, timeout=10)
    assert failed.returncode != 0 and "injected zombie failure" in failed.stderr, failed.stderr
    assert zombie_snapshot() == before, "late zombie failure must roll back twelve tables"
    sql("DROP TRIGGER test_fail_zombie ON public.koshien_zombie_eligibility;DROP FUNCTION public.test_fail_zombie();")
    print("PASS: late zombie failure rolls back schedule, round, eligibility, revision and permits")

    sql(zombie_update("clock_timestamp()+interval '1 day'") + "COMMIT;")
    assert sql("SELECT status||':'||start_mode||':'||end_mode||':'||version FROM public.koshien_later_rounds "
               "WHERE event_id='zombie-test';") == "open:automatic:automatic:1"
    assert sql("SELECT eligible AND cardinality(allowed_team_ids)=4 FROM public.koshien_zombie_eligibility "
               "WHERE player_id='20000000-0000-0000-0000-000000000001';") == "t"
    assert sql("SELECT NOT eligible AND cardinality(allowed_team_ids)=0 FROM public.koshien_zombie_eligibility "
               "WHERE player_id='20000000-0000-0000-0000-000000000002';") == "t"
    assert sql("SELECT bool_and(source_results_version=public.koshien_result_version(event_id)) "
               "FROM public.koshien_zombie_eligibility;") == "t"
    rounds_before = sql("SELECT to_jsonb(t) FROM public.koshien_later_rounds t WHERE event_id='zombie-test';")
    sql(zombie_update("clock_timestamp()+interval '2 days'") + "COMMIT;")
    assert sql("SELECT to_jsonb(t) FROM public.koshien_later_rounds t WHERE event_id='zombie-test';") == rounds_before
    assert sql("SELECT count(*) FROM public.koshien_zombie_eligibility;") == "2"
    print("PASS: future deadline auto-opens once with real eligibility; repeat does not overwrite")

finally:
    sql("DROP OWNED BY authenticated,anon; DROP ROLE authenticated,anon;")
    if sql("SELECT count(*) FROM pg_roles WHERE rolname='service_role';") == "1":
        sql("DROP OWNED BY service_role; DROP ROLE service_role;")
