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
GRANT INSERT,UPDATE,DELETE ON public.teams TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.matches,public.results,public.scores TO authenticated;
GRANT UPDATE ON public.events TO authenticated;
-- Recreated role must retain access used by the invoker import-sync trigger.
GRANT SELECT,UPDATE ON public.external_match_imports TO authenticated;
GRANT EXECUTE ON FUNCTION yoso_approval_private.begin_result_write(text) TO authenticated;
ALTER TABLE public.events ADD COLUMN status text DEFAULT 'resultWait';
ALTER TABLE public.events ADD COLUMN rules jsonb DEFAULT '{}';
-- Mirror production event scoring columns for the shared approval fixtures.
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS rules_config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS current_phase text NOT NULL DEFAULT 'setup';
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS sport_type text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS season text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS odds numeric DEFAULT 1;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
-- Production stores representative_key in teams.metadata. The early
-- disposable fixture originally omitted this column.
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
-- Mirror event_teams' production metadata shape for the shared audit.
CREATE TABLE IF NOT EXISTS public.event_teams(
  id bigint PRIMARY KEY, event_id text NOT NULL, name text,
  seed integer, metadata jsonb DEFAULT '{}',created_at timestamptz DEFAULT now());
GRANT SELECT,INSERT,UPDATE,DELETE ON public.event_teams TO authenticated;
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


    # Each condition is isolated by rollback; force the real deferred triggers
    # before asserting, so a queued-but-unrun trigger cannot make the test pass.
    missing_conditions = [
        ("draft incomplete", "UPDATE public.phase2_drafts SET status='drafting' WHERE event_id='zombie-test';"),
        ("disabled", "UPDATE public.events SET rules='{\"config\":{\"zombieEnabled\":false}}' WHERE id='zombie-test';"),
        ("QF missing", "DELETE FROM public.matches WHERE event_id='zombie-test' AND round_key='QF' AND match_no=4;"),
        ("SF time missing", "UPDATE public.matches SET starts_at=NULL WHERE event_id='zombie-test' AND round_key='SF';"),
        ("SF card missing", "DELETE FROM public.matches WHERE event_id='zombie-test' AND round_key='SF';"
         "UPDATE public.matches SET updated_at=now() WHERE event_id='zombie-test' AND round_key='QF';"),
        ("SF contains nonwinner", "INSERT INTO public.matches(event_id,round_key,match_no,team1_id,team2_id,status,starts_at) "
         "VALUES('zombie-test','SF',2,'50000000-0000-0000-0000-000000000005',"
         "'50000000-0000-0000-0000-000000000003','scheduled',now()+interval '1 day');"),
    ]
    for label, mutation in missing_conditions:
        before = zombie_snapshot()
        draft_before = sql("SELECT to_jsonb(d) FROM public.phase2_drafts d WHERE event_id='zombie-test';")
        revision_before = int(sql("SELECT revision FROM yoso_approval_private.revisions WHERE event_id='zombie-test';"))
        sql(zombie_update("clock_timestamp()+interval '1 day'") + "RESET ROLE;" + mutation +
            "SET CONSTRAINTS ALL IMMEDIATE;"
            "SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.koshien_later_rounds "
            "WHERE event_id='zombie-test'),'missing condition leaves no round');"
            "SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.koshien_zombie_eligibility "
            "WHERE event_id='zombie-test'),'missing condition leaves no eligibility');"
            "SELECT public.test_assert((SELECT revision=" + str(revision_before + 1) +
            " FROM yoso_approval_private.revisions WHERE event_id='zombie-test'),"
            "'source write advances once even when preparation skips');ROLLBACK;")
        assert zombie_snapshot() == before
        assert sql("SELECT to_jsonb(d) FROM public.phase2_drafts d WHERE event_id='zombie-test';") == draft_before
        print(f"PASS: zombie condition {label}: deferred skip, one source revision, complete rollback")

    # The internal prepare itself is not an approval-revision writer.
    # Match the production service_role EXECUTE grant; never call this in production.
    before = zombie_snapshot()
    revision_before = int(sql("SELECT revision FROM yoso_approval_private.revisions WHERE event_id='zombie-test';"))
    sql("BEGIN;SET ROLE service_role;SELECT public.prepare_koshien_zombie_phase_internal("
        "'zombie-test',now(),now()+interval '1 day');RESET ROLE;"
        "SELECT public.test_assert((SELECT count(*)=2 FROM public.koshien_zombie_eligibility),"
        "'internal prepare creates real eligibility');"
        "SELECT public.test_assert((SELECT revision=" + str(revision_before) +
        " FROM yoso_approval_private.revisions WHERE event_id='zombie-test'),"
        "'internal prepare alone does not advance approval revision');ROLLBACK;")
    assert zombie_snapshot() == before
    print("PASS: production service-role permission reproduces unversioned internal preparation")

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

    # A read-state RPC calls this real mutator. Exercise it without invoking
    # the much larger read response or pretending it is a read-only function.
    sql((root / "tests/sql/result-refresh-schedule-fixture.sql").read_text())
    before = zombie_snapshot()
    revision_before = int(sql("SELECT revision FROM yoso_approval_private.revisions WHERE event_id='zombie-test';"))
    sql("BEGIN;UPDATE public.koshien_later_rounds SET deadline_at=now()-interval '1 second' "
        "WHERE event_id='zombie-test';"
        "SET ROLE anon;SELECT public.test_reject($q$SELECT public.refresh_koshien_phase_schedule('zombie-test')$q$,'42501');"
        "RESET ROLE;SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';"
        "SET ROLE authenticated;SELECT public.test_reject($q$SELECT public.refresh_koshien_phase_schedule('zombie-test')$q$,'42501');"
        "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';"
        "SELECT public.refresh_koshien_phase_schedule('zombie-test');"
        "SELECT public.refresh_koshien_phase_schedule('zombie-test');RESET ROLE;"
        "SELECT public.test_assert((SELECT status='locked' AND version=2 AND locked_at IS NOT NULL "
        "FROM public.koshien_later_rounds WHERE event_id='zombie-test'),'member refresh locks elapsed round exactly once');"
        "SELECT public.test_assert((SELECT revision=" + str(revision_before) +
        " FROM yoso_approval_private.revisions WHERE event_id='zombie-test'),"
        "'production refresh does not advance prototype approval revision');ROLLBACK;")
    assert zombie_snapshot() == before
    print("PASS: member refresh mutates round once without approval revision; unauthorized rejected and rollback clean")



    # A read-state call can transition round/draft deadlines. Members must
    # advance the shared revision but must never receive a results write permit.
    sql((root / "supabase/prototypes/koshien-refresh-schedule-write.sql").read_text())
    refresh_call = ("SELECT coalesce(public.refresh_koshien_phase_schedule("
                    "'zombie-test')::text,'') || 'ok';")
    before = zombie_snapshot()
    rev = int(sql("SELECT revision FROM yoso_approval_private.revisions WHERE event_id='zombie-test';"))
    sql("BEGIN;UPDATE public.koshien_later_rounds SET deadline_at=now()-interval '1 second' "
        "WHERE event_id='zombie-test';"
        "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';"
        "SET ROLE authenticated;" + refresh_call + "RESET ROLE;"
        "SELECT public.test_assert((SELECT status='locked' AND version=2 "
        "FROM public.koshien_later_rounds WHERE event_id='zombie-test'),"
        "'member refresh locks expired round');"
        "SELECT public.test_assert((SELECT revision=" + str(rev+1) +
        " FROM yoso_approval_private.revisions WHERE event_id='zombie-test'),"
        "'member refresh advances once');ROLLBACK;")
    assert zombie_snapshot() == before, "failed refresh must restore all twelve tables"

    sql("UPDATE public.koshien_later_rounds SET deadline_at=now()-interval '1 second' "
        "WHERE event_id='zombie-test';")
    before = zombie_snapshot()
    permits = sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
                  "FROM yoso_approval_private.write_permits t;")
    for prefix in ["SET ROLE anon;",
                   "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';"
                   "SET ROLE authenticated;"]:
        sql(prefix + "SELECT public.test_reject($q$" + refresh_call + "$q$,'42501');")
    assert zombie_snapshot() == before

    a = subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE,text=True,bufsize=1)
    b = subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE,text=True)
    try:
        send(a,"SELECT pg_backend_pid();")
        pid = int(line(a))
        member = ("SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';"
                  "SET ROLE authenticated;")
        send(a,"BEGIN;" + member + refresh_call)
        assert line(a)=="ok"
        send(b,"SET application_name='yoso_member_refresh_b';SET statement_timeout='15s';"
             + member + refresh_call)
        deadline=time.monotonic()+8
        while sql("SELECT count(*) FROM pg_stat_activity "
                  "WHERE application_name='yoso_member_refresh_b' "
                  f"AND {pid}=ANY(pg_blocking_pids(pid));")!="1":
            assert b.poll() is None,"member refresh did not wait"
            assert time.monotonic()<deadline
            time.sleep(.05)
        send(a,"COMMIT;")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode==0,a.stderr.read()
        output,errors=b.communicate(timeout=10)
        assert b.returncode==0 and output.strip()=="ok",errors
    finally:
        for proc in (a,b):
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    assert sql("SELECT status||':'||version FROM public.koshien_later_rounds "
               "WHERE event_id='zombie-test';")=="locked:2"
    assert int(sql("SELECT revision FROM yoso_approval_private.revisions "
                   "WHERE event_id='zombie-test';"))==rev+1
    assert sql(AUTH+refresh_call)=="ok"
    assert int(sql("SELECT revision FROM yoso_approval_private.revisions "
                   "WHERE event_id='zombie-test';"))==rev+1
    assert sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
               "FROM yoso_approval_private.write_permits t;")==permits
    print("PASS: member refresh rollback, ACL, concurrent event wait, single revision, no permit")

    # Real service schedule RPC joins the same event/revision/permit boundary.
    sql((root / "supabase/prototypes/koshien-late-schedule-write.sql").read_text())
    # Reset only synthetic fixture state. Expired SF prevents deferred preparation.
    sql(zombie_update("now()-interval '1 day'") + "RESET ROLE;"
        "DELETE FROM public.koshien_later_rounds WHERE event_id='zombie-test';"
        "DELETE FROM public.koshien_zombie_eligibility WHERE event_id='zombie-test';"
        "INSERT INTO public.results(event_id,payload) VALUES('zombie-test',"
        "'{\"matches\":[{\"round\":\"SF\",\"match_no\":1}]}');COMMIT;")
    service = "SET ROLE service_role;"

    def late_schedule(starts="2099-08-20T00:00:00Z", fetched="2026-11-17T00:00:00Z", missing=False):
        rows = [dict(round_key="SF", match_no=1, starts_at=starts,
                     tournament_day_no=13, daily_match_no=1)]
        if missing:
            rows.append(dict(rows[0], match_no=2, daily_match_no=2))
        return ("SELECT public.auto_sync_koshien_late_schedule('zombie-test','" +
                json.dumps(rows) + "','https://www.jhbf.or.jp/sensyuken/2026/schedule/','" +
                fetched + "');")

    def zombie_revision():
        return int(sql("SELECT revision FROM yoso_approval_private.revisions WHERE event_id='zombie-test';"))

    before = zombie_snapshot()
    for role in ["anon", "authenticated"]:
        sql("SET ROLE " + role + ";SELECT public.test_reject($q$" + late_schedule() + "$q$,'42501');")
    sql(service + "SELECT public.test_reject($q$" + late_schedule(missing=True) + "$q$,'P0001');")
    assert zombie_snapshot() == before, "missing second slot rolls back first write and revision"
    print("PASS: late schedule ACL and partial-batch rejection leave twelve tables unchanged")

    # Actual deadline boundary via service RPC, with deferred triggers forced before rollback.
    rev = zombie_revision()
    sql("BEGIN;" + service + late_schedule(starts="2000-08-20T00:00:00Z") +
        "RESET ROLE;SET CONSTRAINTS ALL IMMEDIATE;"
        "SELECT public.test_assert(NOT EXISTS(SELECT 1 FROM public.koshien_later_rounds "
        "WHERE event_id='zombie-test'),'expired service schedule cannot open zombie');ROLLBACK;")
    assert zombie_snapshot() == before
    result = json.loads(sql(service + late_schedule()))
    assert result["changed"] == 1 and not result["idempotent"]
    assert zombie_revision() == rev + 1
    assert sql("SELECT status||':'||version FROM public.koshien_later_rounds "
               "WHERE event_id='zombie-test';") == "open:1"
    assert sql("SELECT count(*) FROM public.koshien_zombie_eligibility WHERE event_id='zombie-test';") == "2"
    assert sql("SELECT (payload->'matches'->0->>'starts_at')::timestamptz = "
               "(SELECT starts_at FROM public.matches WHERE event_id='zombie-test' AND round_key='SF') "
               "FROM public.results WHERE event_id='zombie-test';") == "t"
    print("PASS: service SF schedule opens real zombie round and eligibility with one revision")

    before = zombie_snapshot()
    result = json.loads(sql(service + late_schedule()))
    assert result["idempotent"] and result["changed"] == 0
    assert zombie_snapshot() == before, "identical schedule cannot issue new permit or revision"
    result = json.loads(sql(service + late_schedule(fetched="2026-11-17T01:00:00Z")))
    assert not result["idempotent"] and result["changed"] == 0
    assert zombie_revision() == rev + 2, "results-only mutation must advance once"
    print("PASS: identical schedule is no-op; fetched-at-only results update advances once")


    # Two real RPCs serialize on the event; the waiter observes the committed no-op.
    rev = zombie_revision()
    a = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True, bufsize=1)
    b = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
    try:
        send(a, "SELECT pg_backend_pid();")
        pid = int(line(a))
        concurrent = late_schedule(fetched="2026-11-17T03:00:00Z")
        send(a, "BEGIN;" + service + concurrent)
        assert not json.loads(line(a))["idempotent"]
        send(b, "SET application_name='yoso_late_schedule_b';SET statement_timeout='15s';" +
             service + concurrent)
        deadline = time.monotonic() + 8
        while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='yoso_late_schedule_b' "
                  f"AND {pid}=ANY(pg_blocking_pids(pid));") != "1":
            assert b.poll() is None, "second schedule exited before lock wait"
            assert time.monotonic() < deadline, "schedule did not wait on event"
            time.sleep(0.05)
        send(a, "COMMIT;")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode == 0, a.stderr.read()
        output, errors = b.communicate(timeout=10)
        assert b.returncode == 0, errors
        assert json.loads(output)["idempotent"]
        assert zombie_revision() == rev + 1
    finally:
        for proc in [a, b]:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    print("PASS: concurrent real schedules serialize and advance revision only once")

    # Finalization must protect both match changes and results-only metadata changes.
    sql("BEGIN;SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';"
        "INSERT INTO yoso_approval_private.transition_permits "
        "SELECT id,txid_current(),auth.uid(),status,'finalized',rules->'resultFlow',"
        "'{\"status\":\"finalized\"}' FROM public.events WHERE id='zombie-test';"
        "UPDATE public.events SET status='finalized',rules='{\"resultFlow\":{\"status\":\"finalized\"}}' "
        "WHERE id='zombie-test';COMMIT;")
    before = zombie_snapshot()
    for statement in [late_schedule(starts="2099-08-21T00:00:00Z"),
                      late_schedule(fetched="2026-11-17T02:00:00Z")]:
        sql(service + "SELECT public.test_reject($q$" + statement + "$q$,'55000');")
        assert zombie_snapshot() == before
    result = json.loads(sql(service + late_schedule(fetched="2026-11-17T03:00:00Z")))
    assert result["idempotent"] and zombie_snapshot() == before
    print("PASS: finalized schedule rejects both write paths but permits exact no-op")


    # R1/R2 uses a different, exactly-33-row production RPC.
    sql((root / "supabase/prototypes/koshien-official-schedule-write.sql").read_text())
    official_rows = [
        dict(round_key=r, match_no=n, starts_at="2099-08-01T00:00:00Z",
             tournament_day_no=1 + i // 4, daily_match_no=1 + i % 4)
        for i, (r, n) in enumerate(
            [(r, n) for r, count in [("R1", 17), ("R2", 16)] for n in range(1, count + 1)])
    ]
    official_slots = json.dumps({"matches": [
        {"round": row["round_key"], "match_no": row["match_no"]} for row in official_rows]})
    sql("BEGIN;INSERT INTO public.events(id,preset_type,league_id,created_by,status,rules) "
        "VALUES('official-test','koshien','00000000-0000-0000-0000-000000000010',"
        "'00000000-0000-0000-0000-000000000001','resultWait','{}');"
        "SELECT yoso_approval_private.issue_write_permit('official-test');"
        "INSERT INTO public.matches(event_id,round_key,match_no,status,metadata) "
        "SELECT 'official-test',r,n,'scheduled','{}'::jsonb "
        "FROM (VALUES('R1',17),('R2',16)) rounds(r,c),generate_series(1,c) n;"
        "INSERT INTO public.results(event_id,payload) VALUES('official-test','" + official_slots + "');COMMIT;")

    def official_call(rows=None, fetched="2026-11-17T00:00:00Z"):
        return ("SELECT public.auto_sync_koshien_official_schedule('official-test','" +
                json.dumps(official_rows if rows is None else rows) +
                "','https://www.jhbf.or.jp/sensyuken/2026/schedule/','" + fetched + "');")

    def official_revision():
        return int(sql("SELECT revision FROM yoso_approval_private.revisions WHERE event_id='official-test';"))

    before = zombie_snapshot()
    for role in ["anon", "authenticated"]:
        sql("SET ROLE " + role + ";SELECT public.test_reject($q$" + official_call() + "$q$,'42501');")
    for rows in [official_rows[:-1], official_rows[:-1] + [official_rows[0]]]:
        sql(service + "SELECT public.test_reject($q$" + official_call(rows) + "$q$,'P0001');")
    assert zombie_snapshot() == before
    # Fail only at the last JSON slot, after earlier matches have been updated.
    sql("BEGIN;SELECT yoso_approval_private.issue_write_permit('official-test');"
        "UPDATE public.results SET payload=payload #- '{matches,32}' WHERE event_id='official-test';COMMIT;")
    before = zombie_snapshot()
    sql(service + "SELECT public.test_reject($q$" + official_call() + "$q$,'P0001');")
    assert zombie_snapshot() == before, "last-slot failure must roll back all 33 writes and revision"
    sql("BEGIN;SELECT yoso_approval_private.issue_write_permit('official-test');"
        "UPDATE public.results SET payload='" + official_slots + "' WHERE event_id='official-test';COMMIT;")
    rev = official_revision()
    result = json.loads(sql(service + official_call()))
    assert result == dict(ok=True, count=33, changed=33, idempotent=False), result
    assert official_revision() == rev + 1
    assert sql("SELECT count(*) FROM public.results r, jsonb_array_elements(r.payload->'matches') s "
               "JOIN public.matches m ON m.round_key=s->>'round' AND m.match_no=(s->>'match_no')::int "
               "WHERE r.event_id='official-test' AND m.event_id=r.event_id "
               "AND m.starts_at=(s->>'starts_at')::timestamptz;") == "33"
    before = zombie_snapshot()
    assert json.loads(sql(service + official_call()))["idempotent"]
    assert zombie_snapshot() == before
    result = json.loads(sql(service + official_call(fetched="2026-11-17T01:00:00Z")))
    assert result["changed"] == 0 and not result["idempotent"]
    assert official_revision() == rev + 2
    print("PASS: official 33-row ACL, validation, late-slot rollback, consistency and one revision per batch")

    # A known completed start time is retained even if the source sends a new one.
    # Synthetic completed card tests the production time branch; no scoring rules changed.
    before = zombie_snapshot()
    sql("BEGIN;SELECT yoso_approval_private.issue_write_permit('official-test');"
        "UPDATE public.matches SET status='completed' WHERE event_id='official-test' AND round_key='R1' AND match_no=1;"
        + service + official_call([dict(r, starts_at="2000-08-01T00:00:00Z") for r in official_rows]) +
        "RESET ROLE;SET CONSTRAINTS ALL IMMEDIATE;"
        "SELECT public.test_assert((SELECT starts_at='2099-08-01T00:00:00Z'::timestamptz FROM public.matches "
        "WHERE event_id='official-test' AND round_key='R1' AND match_no=1),'completed start retained');"
        "SELECT public.test_assert((SELECT count(*)=32 FROM public.matches WHERE event_id='official-test' "
        "AND starts_at='2000-08-01T00:00:00Z'::timestamptz),'scheduled cards accept past official time');ROLLBACK;")
    assert zombie_snapshot() == before
    print("PASS: official completed start retained, past scheduled time accepted, transaction rollback clean")

    # An uncommitted schedule blocks another service call; rollback leaves one revision.
    rev = official_revision()
    a = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True, bufsize=1)
    b = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
    try:
        send(a, "SELECT pg_backend_pid();")
        pid = int(line(a))
        concurrent = official_call(fetched="2026-11-17T03:00:00Z")
        send(a, "BEGIN;" + service + concurrent)
        assert not json.loads(line(a))["idempotent"]
        send(b, "SET application_name='yoso_official_schedule_b';SET statement_timeout='15s';" + service + concurrent)
        deadline = time.monotonic() + 8
        while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='yoso_official_schedule_b' "
                  f"AND {pid}=ANY(pg_blocking_pids(pid));") != "1":
            assert b.poll() is None, "second official schedule exited before lock wait"
            assert time.monotonic() < deadline, "official schedule did not wait"
            time.sleep(0.05)
        send(a, "ROLLBACK;")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode == 0, a.stderr.read()
        output, errors = b.communicate(timeout=10)
        assert b.returncode == 0, errors
        assert not json.loads(output)["idempotent"]
        assert official_revision() == rev + 1
    finally:
        for proc in [a, b]:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    print("PASS: official concurrent rollback releases waiter and advances once")

    sql("BEGIN;SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';"
        "INSERT INTO yoso_approval_private.transition_permits "
        "SELECT id,txid_current(),auth.uid(),status,'finalized',rules->'resultFlow',"
        "'{\"status\":\"finalized\"}' FROM public.events WHERE id='official-test';"
        "UPDATE public.events SET status='finalized',rules='{\"resultFlow\":{\"status\":\"finalized\"}}' "
        "WHERE id='official-test';COMMIT;")
    before = zombie_snapshot()
    for statement in [official_call(), official_call([dict(r, starts_at="2099-08-02T00:00:00Z") for r in official_rows])]:
        sql(service + "SELECT public.test_reject($q$" + statement + "$q$,'55000');")
        assert zombie_snapshot() == before
    assert json.loads(sql(service + official_call(fetched="2026-11-17T03:00:00Z")))["idempotent"]
    assert zombie_snapshot() == before
    print("PASS: official finalized match and results-only writes denied; exact repeat remains no-op")


    # First-round registration remains SECURITY INVOKER and requires an active admin.
    sql((root / "supabase/prototypes/koshien-first-round-write.sql").read_text())
    registration_teams = [f"71000000-0000-4000-8000-{i:012d}" for i in range(1, 35)]
    registration_rows = [dict(round_key="R1", match_no=i + 1,
                              team1_id=registration_teams[2*i], team2_id=registration_teams[2*i+1])
                         for i in range(17)]
    registration_slots = json.dumps({"matches": [
        dict(round="R1", match_no=i, status="scheduled") for i in range(1, 18)]})
    sql("BEGIN;INSERT INTO public.events(id,preset_type,league_id,created_by,status,rules,prediction_deadline) "
        "VALUES('registration-test','koshien','00000000-0000-0000-0000-000000000010',"
        "'00000000-0000-0000-0000-000000000001','resultWait','{}',now()-interval '1 day');"
        "SELECT yoso_approval_private.issue_write_permit('registration-test');"
        "INSERT INTO public.teams(id,event_id,name,start_round) VALUES " +
        ",".join("('" + team + "','registration-test','School " + str(i) + "',1)"
                 for i, team in enumerate(registration_teams, 1)) + ";"
        "INSERT INTO public.results(event_id,payload) VALUES('registration-test','" + registration_slots + "');COMMIT;")

    def register_first(rows=None):
        return ("SELECT public.register_koshien_official_first_round_matches('registration-test','" +
                json.dumps(registration_rows if rows is None else rows) +
                "','https://www.jhbf.or.jp/sensyuken/2026/tournament/','2026-11-17T00:00:00Z');")

    def registration_revision():
        return int(sql("SELECT revision FROM yoso_approval_private.revisions WHERE event_id='registration-test';"))

    before = zombie_snapshot()
    for prefix in ["SET ROLE anon;", service,
                   "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';SET ROLE authenticated;",
                   "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';SET ROLE authenticated;"]:
        sql(prefix + "SELECT public.test_reject($q$" + register_first() + "$q$,'42501');")
    sql("UPDATE public.league_members SET membership_status='inactive' "
        "WHERE user_id='00000000-0000-0000-0000-000000000001';")
    sql(AUTH + "SELECT public.test_reject($q$" + register_first() + "$q$,'42501');")
    sql("UPDATE public.league_members SET membership_status='active' "
        "WHERE user_id='00000000-0000-0000-0000-000000000001';")
    for rows in [registration_rows[:-1],
                 registration_rows[:-1] + [dict(registration_rows[-1], team1_id=registration_teams[0])]]:
        sql(AUTH + "SELECT public.test_reject($q$" + register_first(rows) + "$q$,'P0001');")
    assert zombie_snapshot() == before
    print("PASS: registration anonymous/service-without-user/member/other-league/inactive admin and invalid cards rejected")

    # Slot 17 mismatch exercises rollback after 16 inserts.
    sql("BEGIN;SELECT yoso_approval_private.issue_write_permit('registration-test');"
        "UPDATE public.results SET payload=jsonb_set(payload,'{matches,16,match_no}','99') "
        "WHERE event_id='registration-test';COMMIT;")
    before = zombie_snapshot()
    sql(AUTH + "SELECT public.test_reject($q$" + register_first() + "$q$,'P0001');")
    assert zombie_snapshot() == before
    sql("BEGIN;SELECT yoso_approval_private.issue_write_permit('registration-test');"
        "UPDATE public.results SET payload='" + registration_slots + "' WHERE event_id='registration-test';COMMIT;")
    rev = registration_revision()
    result = json.loads(sql(AUTH + register_first()))
    assert result == dict(ok=True, count=17, inserted=17, idempotent=False), result
    assert registration_revision() == rev + 1
    assert sql("SELECT count(*) FROM public.matches WHERE event_id='registration-test';") == "17"
    assert sql("SELECT count(*) FROM public.results r,jsonb_array_elements(r.payload->'matches') s "
               "JOIN public.matches m ON m.round_key=s->>'round' AND m.match_no=(s->>'match_no')::int "
               "JOIN public.teams t ON t.id=m.team1_id "
               "WHERE r.event_id='registration-test' AND m.event_id=r.event_id AND t.name=s->>'team_a_id';") == "17"
    result = json.loads(sql(AUTH + register_first()))
    assert result == dict(ok=True, count=17, inserted=0, idempotent=True)
    # Production idempotent means no new cards; results.updated_at is still written.
    assert registration_revision() == rev + 2
    assert sql("SELECT count(*) FROM public.matches WHERE event_id='registration-test';") == "17"
    print("PASS: registration 17-card consistency, late-slot rollback, repeat advances once without duplicate cards")

    before = zombie_snapshot()
    swapped = [dict(registration_rows[0], team1_id=registration_rows[0]["team2_id"],
                    team2_id=registration_rows[0]["team1_id"])] + registration_rows[1:]
    sql(AUTH + "SELECT public.test_reject($q$" + register_first(swapped) + "$q$,'P0001');")
    assert zombie_snapshot() == before
    sql("BEGIN;" + AUTH + "SELECT yoso_approval_private.begin_result_write('registration-test');"
        "UPDATE public.matches SET status='completed',team1_score=3,team2_score=1,"
        "winner_team_id=team1_id,loser_team_id=team2_id "
        "WHERE event_id='registration-test' AND match_no=1;"
        "SELECT public.test_reject($q$" + register_first() + "$q$,'P0001');ROLLBACK;")
    assert zombie_snapshot() == before
    print("PASS: registration conflicting draw/completed card denied; past prediction deadline does not block admin setup")

    # Both real invoker calls serialize, and each successful results write advances once.
    rev = registration_revision()
    a = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True, bufsize=1)
    b = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
    try:
        send(a, "SELECT pg_backend_pid();")
        pid = int(line(a))
        send(a, "BEGIN;" + AUTH + register_first())
        assert json.loads(line(a))["idempotent"]
        send(b, "SET application_name='yoso_register_b';SET statement_timeout='15s';" + AUTH + register_first())
        deadline = time.monotonic() + 8
        while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='yoso_register_b' "
                  f"AND {pid}=ANY(pg_blocking_pids(pid));") != "1":
            assert b.poll() is None, "second registration exited before wait"
            assert time.monotonic() < deadline, "registration did not wait"
            time.sleep(0.05)
        send(a, "COMMIT;")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode == 0, a.stderr.read()
        output, errors = b.communicate(timeout=10)
        assert b.returncode == 0, errors
        assert json.loads(output)["idempotent"]
        assert registration_revision() == rev + 2
    finally:
        for proc in [a, b]:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    print("PASS: concurrent registrations wait on event and version both actual writes")

    sql("BEGIN;SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';"
        "INSERT INTO yoso_approval_private.transition_permits "
        "SELECT id,txid_current(),auth.uid(),status,'finalized',rules->'resultFlow',"
        "'{\"status\":\"finalized\"}' FROM public.events WHERE id='registration-test';"
        "UPDATE public.events SET status='finalized',rules='{\"resultFlow\":{\"status\":\"finalized\"}}' "
        "WHERE id='registration-test';COMMIT;")
    before = zombie_snapshot()
    sql(AUTH + "SELECT public.test_reject($q$" + register_first() + "$q$,'55000');")
    assert zombie_snapshot() == before
    print("PASS: finalized registration rejected without revision, card or payload changes")


    # Reuse the real 17-card registration fixture; add 15 R2 starters.
    sql((root / "supabase/prototypes/koshien-second-round-write.sql").read_text())
    sql(AUTH + "SELECT public.reopen_koshien_results('registration-test');")
    r2_teams = [f"72000000-0000-4000-8000-{i:012d}" for i in range(1, 16)]
    r2_rows = [dict(round_key="R2", match_no=i+1, team1_source_match_no=i+1, team2_id=t)
               for i, t in enumerate(r2_teams)]
    r2_rows.append(dict(round_key="R2", match_no=16, team1_source_match_no=16, team2_source_match_no=17))
    r2_slots = json.dumps([dict(round="R2", match_no=i, status="scheduled") for i in range(1,17)])
    sql("BEGIN;" + AUTH + "SELECT yoso_approval_private.begin_result_write('registration-test');RESET ROLE;"
        "INSERT INTO public.teams(id,event_id,name,start_round) VALUES " +
        ",".join("('" + team + "','registration-test','Seed " + str(i) + "',2)"
                 for i, team in enumerate(r2_teams, 1)) + ";"
        "UPDATE public.results SET payload=jsonb_set(payload,'{matches}',(payload->'matches')||'" + r2_slots +
        "'::jsonb) WHERE event_id='registration-test';COMMIT;")

    def register_second(rows=None, source="https://www.jhbf.or.jp/sensyuken/2026/tournament/"):
        return ("SELECT public.register_koshien_official_second_round_slots('registration-test','" +
                json.dumps(r2_rows if rows is None else rows) + "','" + source + "','2026-11-17T00:00:00Z');")

    before = zombie_snapshot()
    for prefix in ["SET ROLE anon;", service,
                   "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';SET ROLE authenticated;",
                   "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';SET ROLE authenticated;"]:
        sql(prefix + "SELECT public.test_reject($q$" + register_second() + "$q$,'42501');")
    for rows in [r2_rows[:-1], r2_rows[:-1]+[dict(r2_rows[-1],team2_source_match_no=16)],
                 [dict(r2_rows[0],team2_id=registration_teams[0])]+r2_rows[1:]]:
        sql(AUTH + "SELECT public.test_reject($q$" + register_second(rows) + "$q$,'P0001');")
    assert zombie_snapshot() == before
    sql("BEGIN;" + AUTH + "SELECT yoso_approval_private.begin_result_write('registration-test');"
        "UPDATE public.results SET payload=jsonb_set(payload,'{matches,32,match_no}','99') "
        "WHERE event_id='registration-test';COMMIT;")
    before = zombie_snapshot()
    sql(AUTH + "SELECT public.test_reject($q$" + register_second() + "$q$,'P0001');")
    assert zombie_snapshot() == before, "R2 last-slot failure must roll back earlier inserts"
    sql("BEGIN;" + AUTH + "SELECT yoso_approval_private.begin_result_write('registration-test');"
        "UPDATE public.results SET payload=jsonb_set(payload,'{matches,32,match_no}','16') "
        "WHERE event_id='registration-test';COMMIT;")
    rev = registration_revision()
    result = json.loads(sql(AUTH + register_second()))
    assert result == dict(ok=True,count=16,inserted=16,idempotent=False), result
    assert registration_revision() == rev + 1
    assert sql("SELECT count(*) FROM public.matches WHERE event_id='registration-test' AND round_key='R2';") == "16"
    before = zombie_snapshot()
    assert json.loads(sql(AUTH + register_second()))["idempotent"]
    assert zombie_snapshot() == before
    print("PASS: R2 ACL/feeders/starters validation, partial rollback, 16 insertions and exact no-op")

    # Actual R1 completion advances the registered R2 feeder via the real deferred trigger.
    before = zombie_snapshot()
    sql("BEGIN;" + AUTH + "SELECT yoso_approval_private.begin_result_write('registration-test');"
        "UPDATE public.matches SET status='completed',team1_score=3,team2_score=1,"
        "winner_team_id=team1_id,loser_team_id=team2_id WHERE event_id='registration-test' "
        "AND round_key='R1' AND match_no=1;SET CONSTRAINTS ALL IMMEDIATE;RESET ROLE;"
        "SELECT public.test_assert((SELECT team1_id='" + registration_teams[0] +
        "'::uuid FROM public.matches WHERE event_id='registration-test' AND round_key='R2' AND match_no=1),"
        "'registered R2 receives actual R1 winner');"
        "SELECT public.test_assert((SELECT payload->'matches'->17->>'team_a_id'='School 1' "
        "FROM public.results WHERE event_id='registration-test'),'R2 JSON receives winner name');ROLLBACK;")
    assert zombie_snapshot() == before
    swapped = [dict(r2_rows[0],team2_id=r2_teams[1]),dict(r2_rows[1],team2_id=r2_teams[0])] + r2_rows[2:]
    sql(AUTH + "SELECT public.test_reject($q$" + register_second(swapped) + "$q$,'P0001');")
    assert zombie_snapshot() == before
    print("PASS: R2 actual winner advancement and payload consistency; different draw rejected")

    # Results-only repair must still receive a versioned permit.
    sql("BEGIN;" + AUTH + "SELECT yoso_approval_private.begin_result_write('registration-test');"
        "UPDATE public.results SET payload=payload #- '{matches,17,match_id}' WHERE event_id='registration-test';COMMIT;")
    rev = registration_revision()
    a = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True, bufsize=1)
    b = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True)
    try:
        send(a,"SELECT pg_backend_pid();")
        pid = int(line(a))
        send(a,"BEGIN;" + AUTH + register_second())
        result = json.loads(line(a))
        assert result["inserted"] == 0 and not result["idempotent"]
        send(b,"SET application_name='yoso_r2_register_b';SET statement_timeout='15s';" + AUTH + register_second())
        deadline = time.monotonic()+8
        while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='yoso_r2_register_b' "
                  f"AND {pid}=ANY(pg_blocking_pids(pid));") != "1":
            assert b.poll() is None, "second R2 registration exited before lock wait"
            assert time.monotonic() < deadline, "R2 registration did not wait"
            time.sleep(0.05)
        send(a,"COMMIT;")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode == 0, a.stderr.read()
        output, errors = b.communicate(timeout=10)
        assert b.returncode == 0, errors
        assert json.loads(output)["idempotent"]
        assert registration_revision() == rev+1
    finally:
        for proc in [a,b]:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    print("PASS: R2 concurrent results-only repair advances once; waiter is a real no-op")


    before = zombie_snapshot()
    sql("BEGIN;" + AUTH + "SELECT yoso_approval_private.begin_result_write('registration-test');"
        "UPDATE public.results SET payload=payload #- '{matches,17,match_id}' WHERE event_id='registration-test';RESET ROLE;"
        "INSERT INTO yoso_approval_private.transition_permits SELECT id,txid_current(),auth.uid(),status,"
        "'finalized',rules->'resultFlow','{\"status\":\"finalized\"}' FROM public.events WHERE id='registration-test';"
        "UPDATE public.events SET status='finalized',rules='{\"resultFlow\":{\"status\":\"finalized\"}}' "
        "WHERE id='registration-test';" + AUTH +
        "SELECT public.test_reject($q$" + register_second() + "$q$,'55000');ROLLBACK;")
    assert zombie_snapshot() == before
    print("PASS: R2 finalized results-only repair rejected and rollback restores every tracked table")

    # Exact no-op remains legal when finalized, actual metadata changes do not.
    sql("BEGIN;SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';"
        "INSERT INTO yoso_approval_private.transition_permits SELECT id,txid_current(),auth.uid(),status,"
        "'finalized',rules->'resultFlow','{\"status\":\"finalized\"}' FROM public.events WHERE id='registration-test';"
        "UPDATE public.events SET status='finalized',rules='{\"resultFlow\":{\"status\":\"finalized\"}}' "
        "WHERE id='registration-test';COMMIT;")
    before = zombie_snapshot()
    assert json.loads(sql(AUTH + register_second()))["idempotent"]
    assert zombie_snapshot() == before
    sql(AUTH + "SELECT public.test_reject($q$" +
        register_second(source="https://jhbf.or.jp/sensyuken/2026/tournament/") + "$q$,'55000');")
    assert zombie_snapshot() == before
    print("PASS: R2 finalized no-op allowed, changed metadata rejected without mutation")


    # Service-only QF/SF redraw: actual production RPC body with gated writes.
    sql((root / "supabase/prototypes/koshien-redraw-write.sql").read_text())
    redraw_teams = [f"73000000-0000-4000-8000-{i:012d}" for i in range(1, 17)]
    redraw_qf = [dict(round_key="QF", match_no=i+1,
                      team1_id=redraw_teams[2*i], team2_id=redraw_teams[2*i+1])
                 for i in range(4)]
    redraw_sf = [dict(round_key="SF", match_no=i+1,
                      team1_id=redraw_teams[4*i], team2_id=redraw_teams[4*i+2])
                 for i in range(2)]
    redraw_slots = json.dumps({"matches": [
        dict(round=rnd, match_no=i, status="scheduled")
        for rnd, n in [("QF", 4), ("SF", 2)] for i in range(1,n+1)]})
    sql("BEGIN;INSERT INTO public.events(id,preset_type,league_id,created_by,status,rules) "
        "VALUES('redraw-test','koshien','00000000-0000-0000-0000-000000000010',"
        "'00000000-0000-0000-0000-000000000001','resultWait','{}');"
        "SELECT yoso_approval_private.issue_write_permit('redraw-test');"
        "INSERT INTO public.teams(id,event_id,name,start_round) VALUES " +
        ",".join("('" + team + "','redraw-test','Redraw " + str(i) + "',1)"
                 for i,team in enumerate(redraw_teams,1)) + ";"
        "INSERT INTO public.matches(event_id,round_key,match_no,team1_id,team2_id,"
        "team1_score,team2_score,winner_team_id,loser_team_id,status) VALUES " +
        ",".join("('redraw-test','R3'," + str(i+1) + ",'" + redraw_teams[i] +
                 "','" + redraw_teams[i+8] + "',3,1,'" + redraw_teams[i] +
                 "','" + redraw_teams[i+8] + "','completed')"
                 for i in range(8)) + ";"
        "INSERT INTO public.results(event_id,payload) VALUES('redraw-test','" +
        redraw_slots + "');COMMIT;")

    def redraw_call(round_key="QF", rows=None, source="https://www.jhbf.or.jp/sensyuken/2026/tournament/"):
        return ("SELECT public.register_koshien_official_redraw_slots('redraw-test','" +
                round_key + "','" +
                json.dumps((redraw_qf if round_key=="QF" else redraw_sf) if rows is None else rows) +
                "','" + source + "','2026-11-18T00:00:00Z');")

    def redraw_revision():
        return int(sql("SELECT revision FROM yoso_approval_private.revisions WHERE event_id='redraw-test';"))

    before = zombie_snapshot()
    for role in ["anon", "authenticated"]:
        sql("SET ROLE " + role + ";SELECT public.test_reject($q$" + redraw_call() + "$q$,'42501');")
    for bad in [redraw_call("R3"),redraw_call(rows=[]),
                redraw_call(rows=[dict(redraw_qf[0],team2_id=redraw_teams[9])]+redraw_qf[1:]),
                redraw_call(source="https://example.com/")]:
        sql(service + "SELECT public.test_reject($q$" + bad + "$q$,'P0001');")
    assert zombie_snapshot() == before

    # Force a failure after preceding QF inserts; all 12 tracked tables roll back.
    sql("BEGIN;SELECT yoso_approval_private.issue_write_permit('redraw-test');"
        "UPDATE public.results SET payload=jsonb_set(payload,'{matches,3,match_no}','99') "
        "WHERE event_id='redraw-test';COMMIT;")
    before = zombie_snapshot()
    sql(service + "SELECT public.test_reject($q$" + redraw_call() + "$q$,'P0001');")
    assert zombie_snapshot() == before
    sql("BEGIN;SELECT yoso_approval_private.issue_write_permit('redraw-test');"
        "UPDATE public.results SET payload='" + redraw_slots + "' WHERE event_id='redraw-test';COMMIT;")
    rev = redraw_revision()
    result = json.loads(sql(service + redraw_call()))
    assert result == dict(ok=True,round_key="QF",count=4,changed=4,idempotent=False),result
    assert redraw_revision()==rev+1
    assert sql("SELECT count(*) FROM public.matches WHERE event_id='redraw-test' AND round_key='QF';")=="4"
    before = zombie_snapshot()
    assert json.loads(sql(service + redraw_call()))["idempotent"]
    assert zombie_snapshot()==before
    print("PASS: QF service-only ACL/validation, four inserts, no-op and full late rollback")

    # Real row-level lock wait; the second service worker sees only the committed repair.
    sql("BEGIN;SELECT yoso_approval_private.issue_write_permit('redraw-test');"
        "UPDATE public.results SET payload=payload #- '{matches,0,match_id}' "
        "WHERE event_id='redraw-test';COMMIT;")
    rev=redraw_revision()
    a=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,bufsize=1)
    b=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        send(a,"SELECT pg_backend_pid();")
        pid=int(line(a))
        send(a,"BEGIN;"+service+redraw_call())
        assert not json.loads(line(a))["idempotent"]
        send(b,"SET application_name='yoso_redraw_b';SET statement_timeout='15s';"+service+redraw_call())
        deadline=time.monotonic()+8
        while sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='yoso_redraw_b' "
                  f"AND {pid}=ANY(pg_blocking_pids(pid));")!="1":
            assert b.poll() is None
            assert time.monotonic()<deadline,"redraw caller did not wait on event"
            time.sleep(.05)
        send(a,"COMMIT;")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode==0,a.stderr.read()
        out,err=b.communicate(timeout=10)
        assert b.returncode==0,err
        assert json.loads(out)["idempotent"]
        assert redraw_revision()==rev+1
    finally:
        for proc in [a,b]:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    print("PASS: results-only repair increments once; concurrent repeat is no-op")

    # Complete QF cards, then register the two SF matches from real QF winners.
    sql("BEGIN;"+AUTH+"SELECT yoso_approval_private.begin_result_write('redraw-test');"
        "UPDATE public.matches SET status='completed',team1_score=3,team2_score=1,"
        "winner_team_id=team1_id,loser_team_id=team2_id "
        "WHERE event_id='redraw-test' AND round_key='QF';COMMIT;")
    rev=redraw_revision()
    result=json.loads(sql(service+redraw_call("SF")))
    assert result==dict(ok=True,round_key="SF",count=2,changed=2,idempotent=False),result
    assert redraw_revision()==rev+1
    assert sql("SELECT count(*) FROM public.matches WHERE event_id='redraw-test' AND round_key='SF';")=="2"
    before=zombie_snapshot()
    assert json.loads(sql(service+redraw_call("SF")))["idempotent"]
    assert zombie_snapshot()==before
    sql(service+"SELECT public.test_reject($q$"+
        redraw_call("SF",rows=[dict(redraw_sf[0],team2_id=redraw_teams[4]),redraw_sf[1]])+
        "$q$,'P0001');")
    assert zombie_snapshot()==before
    print("PASS: SF from QF winners, exact no-op and competing draw rejection")

    sql("BEGIN;SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';"
        "INSERT INTO yoso_approval_private.transition_permits SELECT id,txid_current(),auth.uid(),status,"
        "'finalized',rules->'resultFlow','{\"status\":\"finalized\"}' "
        "FROM public.events WHERE id='redraw-test';"
        "UPDATE public.events SET status='finalized',rules='{\"resultFlow\":{\"status\":\"finalized\"}}' "
        "WHERE id='redraw-test';COMMIT;")
    before=zombie_snapshot()
    assert json.loads(sql(service+redraw_call("SF")))["idempotent"]
    assert zombie_snapshot()==before
    sql(service+"SELECT public.test_reject($q$"+
        redraw_call("SF",source="https://jhbf.or.jp/sensyuken/2026/tournament/")+
        "$q$,'55000');")
    assert zombie_snapshot()==before
    print("PASS: finalized redraw no-op allowed, metadata change refused")


    # Manual zombie prepare uses the production internal body and production
    # admin wrapper; only the large UI state JSON is represented by a stub.
    sql("CREATE OR REPLACE FUNCTION public.get_koshien_later_phase_state(p_event_id text) "
        "RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$ "
        "BEGIN PERFORM public.refresh_koshien_phase_schedule(p_event_id);"
        "RETURN jsonb_build_object('event_id',p_event_id,'round_count',"
        "(SELECT count(*) FROM public.koshien_later_rounds WHERE event_id=p_event_id)); "
        "END $fn$;")
    sql((root / "supabase/prototypes/koshien-manual-zombie-prepare.sql").read_text())
    sql((root / "supabase/prototypes/koshien-manual-later-prepare.sql").read_text())

    def seed_manual(event):
        prefix = "81000000" if event == "manual-a" else "81100000"
        teams = [f"{prefix}-0000-4000-8000-{i:012d}" for i in range(1,9)]
        draft_id = "82000000-0000-4000-8000-00000000000" + ("1" if event=="manual-a" else "2")
        sql("BEGIN;INSERT INTO public.events(id,preset_type,league_id,created_by,status,rules) "
            "VALUES('" + event + "','koshien','00000000-0000-0000-0000-000000000010',"
            "'00000000-0000-0000-0000-000000000001','resultWait','{}');"
            "INSERT INTO public.teams(id,event_id,name,start_round) VALUES " +
            ",".join("('" + t + "','" + event + "','M " + str(i) + "',1)"
                     for i,t in enumerate(teams,1)) + ";"
            "SELECT yoso_approval_private.issue_write_permit('" + event + "');"
            "INSERT INTO public.matches(event_id,round_key,match_no,team1_id,team2_id,"
            "team1_score,team2_score,winner_team_id,loser_team_id,status,updated_at) VALUES " +
            ",".join("('" + event + "','QF'," + str(i+1) + ",'" + teams[i] + "','" +
                     teams[i+4] + "',3,1,'" + teams[i] + "','" + teams[i+4] +
                     "','completed',now())" for i in range(4)) + ";"
            "INSERT INTO public.phase2_drafts(event_id,status,id,ordered_player_ids) VALUES"
            "('" + event + "','completed','" + draft_id + "',ARRAY["
            "'20000000-0000-0000-0000-000000000001'::uuid,"
            "'20000000-0000-0000-0000-000000000002'::uuid]);"
            "INSERT INTO public.phase2_draft_picks(draft_id,player_id,team_id,pick_no) VALUES " +
            ",".join("('" + draft_id + "','" + (
              "20000000-0000-0000-0000-000000000002" if i<4 else
              "20000000-0000-0000-0000-000000000001") + "','" + teams[i] + "'," +
              str(i+1) + ")" for i in range(8)) + ";COMMIT;")

    def manual_call(event, wrapped=False, start="2099-08-20T00:00:00Z"):
        params = ("'" + event + "'," +
                  ("'zombie'," if wrapped else "") +
                  "'" + start + "','2099-08-21T00:00:00Z'" +
                  (",'manual','manual'" if wrapped else ""))
        rpc = "prepare_koshien_later_phase" if wrapped else "prepare_koshien_zombie_phase"
        return "SELECT public." + rpc + "(" + params + ");"

    def manual_revision(event):
        return int(sql("SELECT revision FROM yoso_approval_private.revisions "
                       "WHERE event_id='" + event + "';"))

    def manual_snapshot():
        return zombie_snapshot() + [
            sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
                "FROM " + table + " t;")
            for table in ["public.teams","public.phase2_drafts","public.phase2_draft_picks"]]

    seed_manual("manual-a")
    seed_manual("manual-b")
    initial = manual_snapshot()
    for prefix in ["SET ROLE anon;",
                   "SET ROLE service_role;",
                   "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';SET ROLE authenticated;",
                   "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';SET ROLE authenticated;"]:
        sql(prefix + "SELECT public.test_reject($q$" + manual_call("manual-a") + "$q$,'42501');")
        sql(prefix + "SELECT public.test_reject($q$" + manual_call("manual-b",True) + "$q$,'42501');")
    sql(AUTH + "SELECT public.test_reject($q$" + manual_call("manual-a",start="2099-08-21T00:00:00Z") +
        "$q$,'P0001');")
    assert manual_snapshot()==initial
    print("PASS: manual direct/wrapper ACL and invalid deadline leave all data unchanged")

    rev_a=manual_revision("manual-a")
    res=json.loads(sql(AUTH + manual_call("manual-a")))
    assert res["event_id"]=="manual-a" and res["round_count"]==1
    assert manual_revision("manual-a")==rev_a+1
    assert sql("SELECT status||':'||version FROM public.koshien_later_rounds "
               "WHERE event_id='manual-a';")=="ready:0"
    assert sql("SELECT count(*) FROM public.koshien_zombie_eligibility "
               "WHERE event_id='manual-a';")=="2"
    saved=manual_snapshot()
    sql(AUTH+"SELECT public.test_reject($q$"+manual_call("manual-a")+"$q$,'55000');")
    assert manual_snapshot()==saved
    print("PASS: direct manual zombie prepare increments once; duplicate rejected")

    rev_b=manual_revision("manual-b")
    res=json.loads(sql(AUTH+manual_call("manual-b",True)))
    assert res["event_id"]=="manual-b" and res["round_count"]==1
    assert manual_revision("manual-b")==rev_b+1, "outer wrapper cannot double-version nested prepare"
    assert sql("SELECT status||':'||start_mode||':'||end_mode||':'||version "
               "FROM public.koshien_later_rounds WHERE event_id='manual-b';")=="ready:manual:manual:1"
    assert sql("SELECT count(*) FROM public.koshien_zombie_eligibility "
               "WHERE event_id='manual-b';")=="2"
    print("PASS: wrapped manual zombie prepare makes round/manual schedule with one revision")

    # Roll back an entire wrapper call (round, eligibility, revision) after a
    # successful internal preparation, without changing any production event.
    sql("BEGIN;DELETE FROM public.koshien_zombie_eligibility WHERE event_id='manual-b';"
        "DELETE FROM public.koshien_later_rounds WHERE event_id='manual-b';"
        "DELETE FROM yoso_approval_private.revisions WHERE event_id='manual-b';"
        "RESET ROLE;" + AUTH + manual_call("manual-b",True) + "ROLLBACK;")
    assert sql("SELECT count(*) FROM public.koshien_later_rounds WHERE event_id='manual-b';")=="1"
    assert manual_revision("manual-b")==rev_b+1
    print("PASS: wrapper rollback restores prior round and revision")

    # Two same-event admin prepares: the second must wait on event then reject
    # duplicate, not race to insert two eligibility/round rows.
    sql("BEGIN;DELETE FROM public.koshien_zombie_eligibility WHERE event_id='manual-a';"
        "DELETE FROM public.koshien_later_rounds WHERE event_id='manual-a';"
        "DELETE FROM yoso_approval_private.revisions WHERE event_id='manual-a';COMMIT;")
    a=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                       text=True,bufsize=1)
    b=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    try:
        send(a,"SELECT pg_backend_pid();")
        pid=int(line(a))
        send(a,"BEGIN;"+AUTH+manual_call("manual-a"))
        assert json.loads(line(a))["round_count"]==1
        send(b,"SET application_name='yoso_manual_prepare_b';SET statement_timeout='15s';"+
             AUTH+manual_call("manual-a"))
        deadline=time.monotonic()+8
        while sql("SELECT count(*) FROM pg_stat_activity "
                  "WHERE application_name='yoso_manual_prepare_b' "
                  f"AND {pid}=ANY(pg_blocking_pids(pid));")!="1":
            assert b.poll() is None, "manual waiter exited early"
            assert time.monotonic()<deadline,"manual prepare lock wait timed out"
            time.sleep(.05)
        send(a,"COMMIT;")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode==0,a.stderr.read()
        output,errors=b.communicate(timeout=10)
        assert b.returncode!=0 and "already prepared" in errors,errors
    finally:
        for proc in (a,b):
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    assert sql("SELECT count(*) FROM public.koshien_later_rounds "
               "WHERE event_id='manual-a';")=="1"
    assert sql("SELECT count(*) FROM public.koshien_zombie_eligibility "
               "WHERE event_id='manual-a';")=="2"
    assert manual_revision("manual-a")==1
    print("PASS: concurrent manual preparations serialize, second rejected, one revision")


    # The direct phase3 preparer and two admin round controls have the same
    # state-refresh descendant; all must own event/revision before child locks.
    sql("ALTER TABLE public.koshien_later_rounds ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();"
        "ALTER TABLE public.koshien_later_rounds ADD COLUMN IF NOT EXISTS team_a_id uuid;"
        "ALTER TABLE public.koshien_later_rounds ADD COLUMN IF NOT EXISTS team_b_id uuid;")
    for event,prefix in [("manual-a","81000000"),("manual-b","81100000")]:
        sql("BEGIN;SELECT yoso_approval_private.issue_write_permit('" + event + "');"
            "INSERT INTO public.matches(event_id,round_key,match_no,team1_id,team2_id,status) "
            "VALUES('" + event + "','F',1,'" + prefix + "-0000-4000-8000-000000000001','" +
            prefix + "-0000-4000-8000-000000000002','scheduled');COMMIT;")
    sql((root / "supabase/prototypes/koshien-manual-phase3-prepare.sql").read_text())
    sql((root / "supabase/prototypes/koshien-manual-phase-status.sql").read_text())
    sql((root / "supabase/prototypes/koshien-manual-phase-schedule.sql").read_text())

    def phase3_call(event,wrap=False):
        begin = ("SELECT public.prepare_koshien_later_phase('" + event + "','phase3',"
                 if wrap else "SELECT public.prepare_koshien_phase3('" + event + "',")
        return begin + "'2099-08-22T00:00:00Z','2099-08-23T00:00:00Z'" + (
               ",'manual','manual');" if wrap else ");")

    def status_call(event,action):
        return ("SELECT public.set_koshien_later_phase_status('" + event +
                "','zombie','" + action + "');")

    def schedule_call(event,start="2099-08-20T00:00:00Z",end="2099-08-24T00:00:00Z"):
        return ("SELECT public.update_koshien_later_phase_schedule('" + event +
                "','zombie','" + start + "','" + end + "','manual','manual');")

    before=manual_snapshot()
    for prefix in ["SET ROLE anon;",
                   "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';SET ROLE authenticated;",
                   "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';SET ROLE authenticated;"]:
        for call in [phase3_call("manual-a"),status_call("manual-b","open"),
                     schedule_call("manual-b")]:
            sql(prefix+"SELECT public.test_reject($q$"+call+"$q$,'42501');")
    assert manual_snapshot()==before
    print("PASS: phase3 preparation, status and schedule controls reject unauthorized callers")

    rev_a=manual_revision("manual-a")
    result=json.loads(sql(AUTH+phase3_call("manual-a")))
    assert result["event_id"]=="manual-a" and result["round_count"]==2
    assert manual_revision("manual-a")==rev_a+1
    before=manual_snapshot()
    sql(AUTH+"SELECT public.test_reject($q$"+phase3_call("manual-a")+"$q$,'55000');")
    assert manual_snapshot()==before
    print("PASS: direct phase3 preparation records exactly one revision, duplicate rejected")

    rev_b=manual_revision("manual-b")
    result=json.loads(sql(AUTH+phase3_call("manual-b",True)))
    assert result["event_id"]=="manual-b" and result["round_count"]==2
    assert manual_revision("manual-b")==rev_b+1
    assert sql("SELECT status||':'||start_mode||':'||end_mode||':'||version "
               "FROM public.koshien_later_rounds WHERE event_id='manual-b' "
               "AND phase_key='phase3';")=="ready:manual:manual:1"
    print("PASS: wrapped phase3 prepare creates schedule without double revision")

    rev_b=manual_revision("manual-b")
    result=json.loads(sql(AUTH+schedule_call("manual-b")))
    assert result["event_id"]=="manual-b"
    assert manual_revision("manual-b")==rev_b+1
    assert sql("SELECT version FROM public.koshien_later_rounds WHERE event_id='manual-b' "
               "AND phase_key='zombie';")=="2"
    before=manual_snapshot()
    sql(AUTH+"SELECT public.test_reject($q$"+
        schedule_call("manual-b",start="2099-08-25T00:00:00Z")+
        "$q$,'P0001');")
    assert manual_snapshot()==before
    print("PASS: admin schedule update versioned once; invalid times roll back every table")

    rev_a=manual_revision("manual-a")
    result=json.loads(sql(AUTH+status_call("manual-a","open")))
    assert result["event_id"]=="manual-a" and manual_revision("manual-a")==rev_a+1
    assert sql("SELECT status||':'||version FROM public.koshien_later_rounds "
               "WHERE event_id='manual-a' AND phase_key='zombie';")=="open:1"
    before=manual_snapshot()
    sql(AUTH+"SELECT public.test_reject($q$"+status_call("manual-a","open")+"$q$,'55000');")
    assert manual_snapshot()==before
    result=json.loads(sql(AUTH+status_call("manual-a","lock")))
    assert result["event_id"]=="manual-a" and manual_revision("manual-a")==rev_a+2
    assert sql("SELECT status||':'||version FROM public.koshien_later_rounds "
               "WHERE event_id='manual-a' AND phase_key='zombie';")=="locked:2"
    print("PASS: admin manual open/lock versioned, duplicate rejected, no child-to-event inversion")


    # Participant writers originally locked phase rows, wrote picks, then called
    # get_state -> refresh(event). Reuse their exact production bodies with
    # event-first serialization, not admin result-write permissions.
    sql("ALTER TABLE public.players ADD COLUMN IF NOT EXISTS profile_id uuid;"
        "UPDATE public.players SET profile_id='00000000-0000-0000-0000-000000000001' "
        "WHERE id='20000000-0000-0000-0000-000000000001';"
        "CREATE TABLE public.koshien_later_prediction_requests("
        "event_id text,player_id uuid,phase_key text,request_id uuid,payload jsonb,"
        "UNIQUE(event_id,player_id,phase_key,request_id));"
        "CREATE TABLE public.koshien_revenge_eligibility("
        "event_id text,player_id uuid,eligible boolean,allowed_team_ids uuid[]);"
        "ALTER TABLE public.revenge_picks ADD COLUMN IF NOT EXISTS request_id uuid;"
        "ALTER TABLE public.revenge_picks ADD COLUMN IF NOT EXISTS payload jsonb;"
        "ALTER TABLE public.revenge_picks ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();"
        "CREATE UNIQUE INDEX test_revenge_unique ON public.revenge_picks(event_id,player_id);"
        "ALTER TABLE public.zombie_predictions ADD COLUMN IF NOT EXISTS player_id uuid;"
        "ALTER TABLE public.zombie_predictions ADD COLUMN IF NOT EXISTS request_id uuid;"
        "ALTER TABLE public.zombie_predictions ADD COLUMN IF NOT EXISTS payload jsonb;"
        "ALTER TABLE public.zombie_predictions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();"
        "CREATE UNIQUE INDEX test_zombie_unique ON public.zombie_predictions(event_id,player_id);"
        "ALTER TABLE public.final_score_predictions ADD COLUMN IF NOT EXISTS champion_team_id uuid;"
        "ALTER TABLE public.final_score_predictions ADD COLUMN IF NOT EXISTS runner_up_team_id uuid;"
        "ALTER TABLE public.final_score_predictions ADD COLUMN IF NOT EXISTS request_id uuid;"
        "ALTER TABLE public.final_score_predictions ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();"
        "CREATE UNIQUE INDEX test_phase3_unique ON public.final_score_predictions(event_id,player_id);")
    for path in ["supabase/prototypes/save-koshien-zombie-prediction.sql",
                 "supabase/prototypes/save-koshien-revenge-pick.sql",
                 "supabase/prototypes/save-koshien-phase3-prediction.sql"]:
        sql((root / path).read_text())

    # Round setup uses the already-tested real admin phase status RPC.
    sql(AUTH+"SELECT public.set_koshien_later_phase_status('manual-b','zombie','open');")
    sql(AUTH+"SELECT public.set_koshien_later_phase_status('manual-b','phase3','open');")
    sql("INSERT INTO public.koshien_later_rounds(event_id,phase_key,status,"
        "opens_at,deadline_at,start_mode,end_mode,version) VALUES"
        "('manual-b','revenge','open',now()-interval '1 day',now()+interval '1 day',"
        "'manual','manual',1);"
        "INSERT INTO public.koshien_revenge_eligibility("
        "event_id,player_id,eligible,allowed_team_ids) VALUES "
        "('manual-b','20000000-0000-0000-0000-000000000001',true,"
        "ARRAY['81100000-0000-4000-8000-000000000001'::uuid]);")

    def prediction_snapshot():
        return manual_snapshot() + [
            sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
                "FROM "+table+" t;")
            for table in ["public.koshien_later_prediction_requests",
                          "public.revenge_picks","public.zombie_predictions",
                          "public.final_score_predictions","public.koshien_revenge_eligibility"]]

    def prediction_call(phase,request="1",target="1",version=None):
        round_key = "zombie" if phase=="zombie" else ("revenge" if phase=="revenge" else "phase3")
        if version is None:
            version=int(sql("SELECT version FROM public.koshien_later_rounds "
                            "WHERE event_id='manual-b' AND phase_key='"+round_key+"';"))
        request_id = "91000000-0000-4000-8000-" + f"{int(request):012d}"
        if phase=="phase3":
            return ("SELECT public.save_koshien_phase3_prediction('manual-b',2,1,3,1," +
                    str(version) + ",'" + request_id + "');")
        function = "save_koshien_zombie_prediction" if phase=="zombie" else "save_koshien_revenge_pick"
        team_id = "81100000-0000-4000-8000-" + f"{int(target):012d}"
        return ("SELECT public." + function + "('manual-b','" + team_id + "'," +
                str(version) + ",'" + request_id + "');")

    before=prediction_snapshot()
    for phase in ("zombie","revenge","phase3"):
        for prefix in ["SET ROLE anon;",
                       "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';SET ROLE authenticated;"]:
            sql(prefix+"SELECT public.test_reject($q$"+prediction_call(phase)+"$q$,'42501');")
    assert prediction_snapshot()==before
    permits=sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
                "FROM yoso_approval_private.write_permits t;")
    rev=manual_revision("manual-b")
    for phase,req in [("zombie","11"),("revenge","12"),("phase3","13")]:
        result=json.loads(sql(AUTH+prediction_call(phase,request=req)))
        assert result["event_id"]=="manual-b"
        assert json.loads(sql(AUTH+prediction_call(phase,request=req)))==result
    assert manual_revision("manual-b")==rev
    assert sql("SELECT count(*) FROM public.koshien_later_prediction_requests "
               "WHERE event_id='manual-b';")=="3"
    assert sql("SELECT count(*) FROM public.zombie_predictions "
               "WHERE event_id='manual-b';")=="1"
    assert sql("SELECT count(*) FROM public.revenge_picks "
               "WHERE event_id='manual-b';")=="1"
    assert sql("SELECT count(*) FROM public.final_score_predictions "
               "WHERE event_id='manual-b';")=="1"
    before=prediction_snapshot()
    sql(AUTH+"SELECT public.test_reject($q$"+
        prediction_call("zombie",request="11",target="2")+"$q$,'23505');")
    sql(AUTH+"SELECT public.test_reject($q$"+
        prediction_call("zombie",request="14",version=0)+"$q$,'40001');")
    assert prediction_snapshot()==before
    print("PASS: three real participant saves, replay idempotence, ACL/conflict, no approval revision")

    # Actual concurrent participant writes serialize on event instead of taking
    # a phase/child lock before read-triggered refresh.
    a=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE,text=True,bufsize=1)
    b=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    try:
        send(a,"SELECT pg_backend_pid();")
        pid=int(line(a))
        send(a,"BEGIN;"+AUTH+prediction_call("zombie",request="15",target="2"))
        assert json.loads(line(a))["event_id"]=="manual-b"
        send(b,"SET application_name='yoso_prediction_b';SET statement_timeout='15s';"+
             AUTH+prediction_call("zombie",request="16",target="3"))
        deadline=time.monotonic()+8
        while sql("SELECT count(*) FROM pg_stat_activity "
                  "WHERE application_name='yoso_prediction_b' "
                  f"AND {pid}=ANY(pg_blocking_pids(pid));")!="1":
            assert b.poll() is None
            assert time.monotonic()<deadline,"participant writer did not wait on event"
            time.sleep(.05)
        send(a,"COMMIT;")
        a.stdin.close()
        a.wait(timeout=10)
        output,errors=b.communicate(timeout=10)
        assert b.returncode==0,errors
        assert json.loads(output)["event_id"]=="manual-b"
    finally:
        for proc in (a,b):
            if proc.poll() is None:
                proc.kill()
                proc.wait()
    assert sql("SELECT team_id::text FROM public.zombie_predictions "
               "WHERE event_id='manual-b';")=="81100000-0000-4000-8000-000000000003"
    assert manual_revision("manual-b")==rev
    assert sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
               "FROM yoso_approval_private.write_permits t;")==permits
    print("PASS: concurrent participant saves serialize, no result-write permit or revision")


    # Direct best16 setup and its nested later-phase entry are the final manual
    # get_state parents. Use the real production body and synthetic 16-card/4-player data.
    sql("ALTER TABLE public.phase2_drafts "
        "ADD COLUMN IF NOT EXISTS eligible_team_ids uuid[], "
        "ADD COLUMN IF NOT EXISTS ranking_snapshot jsonb, "
        "ADD COLUMN IF NOT EXISTS current_pick_no integer, "
        "ADD COLUMN IF NOT EXISTS starts_at timestamptz;"
        "ALTER TABLE public.koshien_revenge_eligibility "
        "ADD COLUMN IF NOT EXISTS fallback_allowed boolean, "
        "ADD COLUMN IF NOT EXISTS source_results_version bigint;")
    sql((root / "supabase/prototypes/koshien-manual-best16-prepare.sql").read_text())

    for i in range(1,5):
        sql("INSERT INTO public.players(id,league_id,profile_id) VALUES("
            "'28000000-0000-4000-8000-" + f"{i:012d}" +
            "','00000000-0000-0000-0000-000000000010',"
            "'29000000-0000-4000-8000-" + f"{i:012d}" + "');")

    def seed_best16(event,prefix):
        teams=[f"{prefix}-0000-4000-8000-{i:012d}" for i in range(1,17)]
        sql("BEGIN;INSERT INTO public.events(id,preset_type,league_id,created_by,status,rules) "
            "VALUES('" + event + "','koshien','00000000-0000-0000-0000-000000000010',"
            "'00000000-0000-0000-0000-000000000001','resultWait','{}');"
            "INSERT INTO public.teams(id,event_id,name,start_round) VALUES " +
            ",".join("('" + team + "','" + event + "','Best " + str(i) + "',1)"
                     for i,team in enumerate(teams,1)) + ";"
            "SELECT yoso_approval_private.issue_write_permit('" + event + "');"
            "INSERT INTO public.matches(event_id,round_key,match_no,team1_id,team2_id,status) VALUES "+
            ",".join("('" + event + "','R3'," + str(i+1) + ",'" + teams[2*i] +
                     "','" + teams[2*i+1] + "','scheduled')" for i in range(8)) + ";"
            "INSERT INTO public.phase1_picks(event_id,player_id,team_id,captain) VALUES " +
            ",".join("('" + event + "','28000000-0000-4000-8000-" + f"{p:012d}" +
                     "','" + team + "',false)" for p in range(1,5) for team in teams[:8])+
            ";COMMIT;")

    seed_best16("best16-direct","85000000")
    seed_best16("best16-wrapped","85100000")

    def best16_call(event,wrapped=False):
        return ("SELECT public." + ("prepare_koshien_later_phase" if wrapped else
                 "prepare_koshien_best16_phases") + "('" + event + "'," +
                ("'best16'," if wrapped else "") +
                "'2099-08-20T00:00:00Z','2099-08-21T00:00:00Z'" +
                (",'manual','manual');" if wrapped else ");"))

    def best16_snapshot():
        return prediction_snapshot() + [
            sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
                "FROM "+table+" t;")
            for table in ["public.phase1_picks","public.koshien_revenge_eligibility"]]

    before=best16_snapshot()
    for prefix in ["SET ROLE anon;",
                   "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';SET ROLE authenticated;",
                   "SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';SET ROLE authenticated;"]:
        sql(prefix+"SELECT public.test_reject($q$"+best16_call("best16-direct")+"$q$,'42501');")
    sql(AUTH+"SELECT public.test_reject($q$"+
        "SELECT public.prepare_koshien_best16_phases('best16-direct',"
        "'2099-08-21T00:00:00Z','2099-08-21T00:00:00Z');$q$,'P0001');")
    assert best16_snapshot()==before
    print("PASS: direct best16 auth and schedule guards preserve fixture state")

    # Early round corruption must fail before creating any draft/round/eligibility.
    sql("BEGIN;SELECT yoso_approval_private.issue_write_permit('best16-direct');"
        "UPDATE public.matches SET team2_id=NULL "
        "WHERE event_id='best16-direct' AND round_key='R3' AND match_no=8;" +
        AUTH+"SELECT public.test_reject($q$"+best16_call("best16-direct")+"$q$,'P0001');ROLLBACK;")
    assert best16_snapshot()==before
    print("PASS: insufficient best16 roster fully rolls back")

    sql("BEGIN;"+AUTH+best16_call("best16-direct")+"ROLLBACK;")
    assert best16_snapshot()==before
    print("PASS: successful direct prepare rolls back every table when transaction aborts")

    before_revision=sql("SELECT coalesce(revision,-1) FROM yoso_approval_private.revisions "
                        "WHERE event_id='best16-direct';")
    result=json.loads(sql(AUTH+best16_call("best16-direct")))
    assert result["event_id"]=="best16-direct" and result["round_count"]==1
    assert sql("SELECT revision FROM yoso_approval_private.revisions "
               "WHERE event_id='best16-direct';")=="1"
    assert sql("SELECT status||':'||cardinality(ordered_player_ids)||':'||"
               "cardinality(eligible_team_ids) FROM public.phase2_drafts "
               "WHERE event_id='best16-direct';")=="ready:4:16"
    assert sql("SELECT count(*) FROM public.koshien_revenge_eligibility "
               "WHERE event_id='best16-direct';")=="4"
    before=best16_snapshot()
    sql(AUTH+"SELECT public.test_reject($q$"+best16_call("best16-direct")+"$q$,'55000');")
    assert best16_snapshot()==before
    print("PASS: direct best16 four player drafts and eligibility, revision once, duplicate rejected")

    result=json.loads(sql(AUTH+best16_call("best16-wrapped",True)))
    assert result["event_id"]=="best16-wrapped" and result["round_count"]==1
    assert sql("SELECT revision FROM yoso_approval_private.revisions "
               "WHERE event_id='best16-wrapped';")=="1"
    assert sql("SELECT status||':'||start_mode||':'||end_mode||':'||version "
               "FROM public.koshien_later_rounds WHERE event_id='best16-wrapped';")=="ready:manual:manual:1"
    assert sql("SELECT (starts_at='-infinity'::timestamptz AND "
               "deadline_at='infinity'::timestamptz) FROM public.phase2_drafts "
               "WHERE event_id='best16-wrapped';")=="t"
    assert sql("SELECT count(*) FROM public.koshien_revenge_eligibility "
               "WHERE event_id='best16-wrapped';")=="4"
    print("PASS: best16 wrapper prepares roster and manual schedule with one revision")


    # A caller may start while authorized but wait on an event row. Ensure that
    # membership deactivation committed during the wait rejects both the admin
    # state transition and the participant save, without partial side effects.
    def membership_race(call, label):
        before=prediction_snapshot()
        before_revision=manual_revision("manual-b")
        a=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE,text=True,bufsize=1)
        b=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE,text=True)
        try:
            send(a,"SELECT pg_backend_pid();")
            pid=int(line(a))
            send(a,"BEGIN;SELECT id FROM public.events WHERE id='manual-b' FOR UPDATE;"
                 "UPDATE public.league_members SET membership_status='inactive' "
                 "WHERE league_id='00000000-0000-0000-0000-000000000010' "
                 "AND user_id='00000000-0000-0000-0000-000000000001';"
                 "SELECT 'deactivated';")
            assert line(a)=="manual-b"
            assert line(a)=="deactivated"
            send(b,"SET application_name='yoso_membership_race';"
                 "SET statement_timeout='15s';"+AUTH+call)
            deadline=time.monotonic()+8
            while sql("SELECT count(*) FROM pg_stat_activity "
                      "WHERE application_name='yoso_membership_race' "
                      f"AND {pid}=ANY(pg_blocking_pids(pid));")!="1":
                assert b.poll() is None,"membership race exited before event wait"
                assert time.monotonic()<deadline,"membership race did not wait"
                time.sleep(.05)
            send(a,"COMMIT;")
            a.stdin.close()
            a.wait(timeout=10)
            assert a.returncode==0,a.stderr.read()
            output,errors=b.communicate(timeout=10)
            assert b.returncode!=0, "deactivated actor unexpectedly wrote: "+output
            assert "permission" in errors or "membership" in errors, errors
        finally:
            for proc in (a,b):
                if proc.poll() is None:
                    proc.kill()
                    proc.wait()
            # Restore only the isolated fixture admin; no production writes.
            sql("UPDATE public.league_members SET membership_status='active' "
                "WHERE league_id='00000000-0000-0000-0000-000000000010' "
                "AND user_id='00000000-0000-0000-0000-000000000001';")
        assert prediction_snapshot()==before, label+" leaked a write on authorization loss"
        assert manual_revision("manual-b")==before_revision
        print("PASS: "+label+" rejects deactivated actor after event lock wait; complete rollback")

    membership_race(status_call("manual-b","lock"),"admin phase lock")
    membership_race(prediction_call("zombie",request="50",target="1"),
                    "participant zombie prediction")


    # Production-catalog RLS policies, not the earlier admin-only synthetic policy.
    # Each policy is installed inside a single ROLLBACK-only transaction so
    # the other integration fixtures remain unchanged.
    prior_policies=sql("SELECT coalesce(string_agg(policyname,',' ORDER BY policyname),'') "
                       "FROM pg_policies WHERE schemaname='public' AND tablename='results';")
    before=snapshot()
    rls_checks = """
      SET ROLE anon;
      SELECT public.test_assert(
        (SELECT count(*)=0 FROM public.results WHERE event_id='save')
        AND (SELECT count(*)=0 FROM public.events WHERE id='save')
        AND (SELECT count(*)=0 FROM public.matches WHERE event_id='save')
        AND (SELECT count(*)=0 FROM public.scores WHERE event_id='save'),
        'anon cannot SELECT restricted production rows');
      RESET ROLE;
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
      SET ROLE authenticated;
      SELECT public.test_assert(
        (SELECT count(*)=0 FROM public.results WHERE event_id='save')
        AND (SELECT count(*)=0 FROM public.events WHERE id='save')
        AND (SELECT count(*)=0 FROM public.matches WHERE event_id='save')
        AND (SELECT count(*)=0 FROM public.scores WHERE event_id='save'),
        'different league owner cannot SELECT');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
      SELECT public.test_assert(
        (SELECT count(*)=1 FROM public.results WHERE event_id='save')
        AND (SELECT count(*)=1 FROM public.events WHERE id='save')
        AND (SELECT count(*)>0 FROM public.matches WHERE event_id='save')
        AND (SELECT count(*)>0 FROM public.scores WHERE event_id='save'),
        'active league member can SELECT own event');
      UPDATE public.results SET updated_by=auth.uid() WHERE event_id='rls-probe';
      SELECT public.test_assert(
        (SELECT updated_by IS DISTINCT FROM auth.uid() FROM public.results
         WHERE event_id='rls-probe'),
        'member cannot update result under production RLS');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SELECT yoso_approval_private.begin_result_write('rls-probe');
      SELECT public.test_reject(
        $rejected$UPDATE public.results
        SET updated_by='00000000-0000-0000-0000-000000000002'
        WHERE event_id='rls-probe'$rejected$,'42501');
      UPDATE public.results SET updated_by=auth.uid() WHERE event_id='rls-probe';
      SELECT public.test_assert(
        (SELECT updated_by=auth.uid() FROM public.results
         WHERE event_id='rls-probe'),
        'real admin actor can update result with valid permit and identity');
      RESET ROLE;
    """
    sql("BEGIN;\n"
        + "INSERT INTO public.events(id,preset_type,league_id,created_by,status,rules) "
          "VALUES('rls-probe','koshien','00000000-0000-0000-0000-000000000010',"
          "'00000000-0000-0000-0000-000000000001','resultWait','{}');"
          "SELECT yoso_approval_private.issue_write_permit('rls-probe');"
          "INSERT INTO public.results(event_id,payload) "
          "VALUES('rls-probe',jsonb_build_object('matches','[]'::jsonb));"
        + (root / "tests/sql/result-production-rls-policy-fixture.sql").read_text()
        + rls_checks + "\nROLLBACK;")
    assert snapshot()==before, "production RLS contract must not mutate fixture tables"
    assert sql("SELECT coalesce(string_agg(policyname,',' ORDER BY policyname),'') "
               "FROM pg_policies WHERE schemaname='public' AND tablename='results';")==prior_policies
    print("PASS: production SELECT, write and updated_by RLS policies (11) in rollback-only fixture")


    # Replay production CHECK/FK definitions in a rollback-only transaction.
    before=snapshot()
    constraint_checks = """
      SELECT yoso_approval_private.issue_write_permit('manual-b');
      SELECT public.test_reject(
        $invalid$UPDATE public.events SET status='invented' WHERE id='manual-b'$invalid$,
        '23514');
      SELECT public.test_reject(
        $invalid$INSERT INTO public.matches(event_id,round_key,match_no,team1_id,status)
        VALUES('manual-b','CATALOG',98,'81100000-0000-4000-8000-000000000001','invented')$invalid$,
        '23514');
      SELECT public.test_reject(
        $invalid$INSERT INTO public.matches(event_id,round_key,match_no,team1_id,status)
        VALUES('manual-b','CATALOG',99,'ffffffff-ffff-4fff-8fff-ffffffffffff','scheduled')$invalid$,
        '23503');
      INSERT INTO public.matches(event_id,round_key,match_no,team1_id,status)
      VALUES('manual-b','CATALOG',100,
        '81100000-0000-4000-8000-000000000001','scheduled');
      SELECT public.test_assert(
        (SELECT count(*)=1 FROM public.matches
         WHERE event_id='manual-b' AND round_key='CATALOG'),
        'valid referenced scheduled match is accepted');
    """
    sql("BEGIN;\n"
        + (root / "tests/sql/result-production-constraints-fixture.sql").read_text()
        + constraint_checks + "\nROLLBACK;")
    assert snapshot()==before, "production CHECK/FK fixture must completely roll back"
    print("PASS: production CHECK/FK constraints (14) reject invalid status/teams, accept valid card")


    # Production-like shared league row: approvals lock FOR SHARE and every
    # membership/player DML trigger locks FOR UPDATE (including fresh INSERT).
    sql("ALTER TABLE public.players ADD COLUMN IF NOT EXISTS display_name text;"
        "ALTER TABLE public.players ADD COLUMN IF NOT EXISTS is_admin boolean DEFAULT false;"
        "ALTER TABLE public.players ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();"
        "ALTER TABLE public.league_members ADD COLUMN IF NOT EXISTS joined_at timestamptz DEFAULT now();"
        "CREATE TABLE public.leagues(id uuid PRIMARY KEY, name text DEFAULT 'fixture');"
        "INSERT INTO public.leagues(id) VALUES "
        "('00000000-0000-0000-0000-000000000010'),"
        "('00000000-0000-0000-0000-000000000020');")
    sql((root / "supabase/prototypes/koshien-shared-approval-roster-lock.sql").read_text())

    # Match the real submit RPC's complete private audit envelope when
    # seeding synthetic submissions for two-session membership/deletion races.
    # Empty '{}' submissions are deliberately no longer accepted by approve.
    sql("""
      CREATE FUNCTION public.test_shared_approval_snapshot(p_event_id text)
      RETURNS jsonb LANGUAGE sql SET search_path='' AS $fn$
      SELECT jsonb_build_object(
        'event_context',jsonb_build_object(
          'rules',coalesce(e.rules,'{}'::jsonb) - 'approvalPolicy' - 'resultFlow',
          'rules_config',e.rules_config,
          'current_phase',e.current_phase,
          'prediction_deadline',e.prediction_deadline,
          'sport_type',e.sport_type,
          'season',e.season
        ),
        'teams',coalesce((
          SELECT jsonb_agg(to_jsonb(t) - 'created_at' - 'updated_at'
            ORDER BY t.id)
          FROM public.teams t WHERE t.event_id=e.id
        ),'[]'::jsonb),
        'event_teams',coalesce((
          SELECT jsonb_agg(to_jsonb(et) - 'created_at' - 'updated_at'
            ORDER BY et.id)
          FROM public.event_teams et WHERE et.event_id=e.id
        ),'[]'::jsonb),
        'matches',coalesce((
          SELECT jsonb_agg(to_jsonb(m) ORDER BY m.round_key,m.match_no)
          FROM public.matches m WHERE m.event_id=e.id
        ),'[]'::jsonb),
        'results',(SELECT r.payload FROM public.results r WHERE r.event_id=e.id),
        'scores',coalesce((
          SELECT jsonb_agg(to_jsonb(sc) ORDER BY sc.player_id)
          FROM public.scores sc JOIN public.players p ON p.id=sc.player_id
          JOIN public.league_members lm
            ON lm.league_id=e.league_id AND lm.user_id=p.profile_id
          WHERE sc.event_id=e.id AND p.league_id=e.league_id
            AND lm.membership_status='active'
        ),'[]'::jsonb)
      ) FROM public.events e WHERE e.id=p_event_id
      $fn$;
    """)

    # Prototype private shared-approval schema and READ-ONLY member RPC.
    # The entire schema, rows and RPC disappear on rollback.
    before=snapshot()
    tables_before=sql("SELECT count(*) FROM information_schema.tables "
                      "WHERE table_schema='yoso_approval_private';")
    read_checks="""
      SELECT public.test_assert(
        (SELECT revision>=0 FROM yoso_approval_private.revisions
         WHERE event_id='manual-b'),
        'existing revision for shared state');
      INSERT INTO yoso_approval_private.submissions(
        event_id,revision,policy,eligible_user_ids,required_count,
        submitted_by,status,result_snapshot
      ) SELECT 'manual-b',r.revision,'unanimous',ARRAY[
        '00000000-0000-0000-0000-000000000001'::uuid,
        '00000000-0000-0000-0000-000000000002'::uuid
      ],2,'00000000-0000-0000-0000-000000000001','submitted','{}'::jsonb
      FROM yoso_approval_private.revisions r WHERE r.event_id='manual-b';
      INSERT INTO yoso_approval_private.votes(submission_id,voter_user_id)
      SELECT id,'00000000-0000-0000-0000-000000000001'
      FROM yoso_approval_private.submissions WHERE event_id='manual-b';

      SET ROLE anon;
      SELECT public.test_reject(
        $q$SELECT public.get_koshien_shared_approval_state('manual-b')$q$,'42501');
      RESET ROLE;
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.get_koshien_shared_approval_state('manual-b')$q$,'42501');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
      SELECT public.test_assert(
        (SELECT (s.data->>'submission_status')='submitted'
          AND (s.data->>'approved_count')::int=1 AND (s.data->>'required_count')::int=2
          AND (s.data->>'current_user_voted')::boolean=false
          AND (s.data->>'current_user_eligible')::boolean=true
         FROM (SELECT public.get_koshien_shared_approval_state('manual-b') AS data) s),
        'member sees only shared approval metadata and own vote');
      SELECT public.test_reject(
        $q$SELECT count(*) FROM yoso_approval_private.submissions$q$,'42501');
      SELECT public.test_reject(
        $q$SELECT count(*) FROM yoso_approval_private.votes$q$,'42501');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SELECT public.test_assert(
        (SELECT (s.data->>'current_user_voted')::boolean=true
          AND (s.data->>'approved_count')::int=1
         FROM (SELECT public.get_koshien_shared_approval_state('manual-b') AS data) s),
        'owner sees his own vote');
      RESET ROLE;
      SELECT public.test_reject(
        $q$INSERT INTO yoso_approval_private.votes(submission_id,voter_user_id)
        SELECT id,'00000000-0000-0000-0000-000000000001'
        FROM yoso_approval_private.submissions WHERE event_id='manual-b'$q$,'23505');
      SELECT public.test_reject(
        $q$INSERT INTO yoso_approval_private.submissions(
         event_id,revision,policy,eligible_user_ids,required_count,
         submitted_by,result_snapshot
        ) SELECT 'manual-b',revision,'unanimous',
         ARRAY['00000000-0000-0000-0000-000000000001'::uuid],2,
         '00000000-0000-0000-0000-000000000001','{}'::jsonb
        FROM yoso_approval_private.revisions WHERE event_id='manual-b'$q$,'23514');
      SELECT public.test_reject(
        $q$INSERT INTO yoso_approval_private.submissions(
          event_id,revision,policy,eligible_user_ids,required_count,
          submitted_by,result_snapshot
        ) SELECT 'manual-b',revision,'admin',
          ARRAY['00000000-0000-0000-0000-000000000001'::uuid,
                '00000000-0000-0000-0000-000000000002'::uuid],2,
          '00000000-0000-0000-0000-000000000001','{}'::jsonb
        FROM yoso_approval_private.revisions WHERE event_id='manual-b'$q$,'23514');
      SELECT yoso_approval_private.advance_revision('manual-b',
        (SELECT revision FROM yoso_approval_private.revisions
         WHERE event_id='manual-b'));
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
      SET ROLE authenticated;
      SELECT public.test_assert(
        (SELECT (s.data->>'submission_status')='none'
          AND (s.data->>'approved_count')::int=0
         FROM (SELECT public.get_koshien_shared_approval_state('manual-b') AS data) s),
        'old submission never resurfaces after a revision advance');
      RESET ROLE;
    """
    sql("BEGIN;\n"
        + (root / "supabase/prototypes/koshien-shared-approval-read.sql").read_text()
        + read_checks + "\nROLLBACK;")
    assert snapshot()==before, "shared approval read test must not alter existing event or revision"
    assert sql("SELECT count(*) FROM information_schema.tables "
               "WHERE table_schema='yoso_approval_private';")==tables_before
    assert sql("SELECT to_regprocedure('public.get_koshien_shared_approval_state(text)') IS NULL;")=="t"
    print("PASS: private submissions/votes, authenticated read, duplicate protection, stale revision, rollback")


    # Policy updates must be atomic with revision changes and stale-vote
    # invalidation, and must not leak from a rollback-only fixture.
    before=snapshot()
    policy_checks="""
      -- A Koshien event cannot start life as finalized via ordinary INSERT.
      SELECT public.test_reject(
        $q$INSERT INTO public.events(id,preset_type,league_id,created_by,status,rules)
        VALUES('approval-bypass-probe','koshien',
          '00000000-0000-0000-0000-000000000010',
          '00000000-0000-0000-0000-000000000001','finalized',
          '{"approvalPolicy":"admin","resultFlow":{"status":"finalized"}}')$q$,
        '42501');
      INSERT INTO public.events(id,preset_type,league_id,created_by,status,rules)
      VALUES('approval-policy-probe','koshien',
       '00000000-0000-0000-0000-000000000010',
       '00000000-0000-0000-0000-000000000001','resultWait',
       '{"approvalPolicy":"half","resultFlow":{"status":"none"},"keepMe":"untouched"}');
      INSERT INTO public.teams(id,event_id,name,odds) VALUES
        ('86000000-0000-4000-8000-0000000000fe','approval-policy-probe','Policy Seed',1);
      INSERT INTO public.event_teams(id,event_id,name,seed,metadata)
        VALUES (9101,'approval-policy-probe','Policy Seed',1,'{"gameMultiplier":1}');
      SELECT yoso_approval_private.lock_revision('approval-policy-probe');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$UPDATE public.events SET
          rules=jsonb_set(rules,'{approvalPolicy}','"admin"',true)
          WHERE id='approval-policy-probe'$q$,'42501');
      RESET ROLE;
      INSERT INTO yoso_approval_private.submissions(
        event_id,revision,policy,eligible_user_ids,required_count,submitted_by,result_snapshot
      ) VALUES('approval-policy-probe',0,'half',ARRAY[
        '00000000-0000-0000-0000-000000000001'::uuid,
        '00000000-0000-0000-0000-000000000002'::uuid
      ],1,'00000000-0000-0000-0000-000000000001','{}');
      INSERT INTO yoso_approval_private.votes(submission_id,voter_user_id)
      SELECT id,'00000000-0000-0000-0000-000000000001'
      FROM yoso_approval_private.submissions WHERE event_id='approval-policy-probe';
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$UPDATE public.events SET status='open'
          WHERE id='approval-policy-probe'$q$,'55000');
      SELECT public.test_assert(
        (SELECT status='resultWait' FROM public.events
          WHERE id='approval-policy-probe'),
        'pending approval blocks reverting event to prediction entry');
      SELECT public.test_reject(
        $q$UPDATE public.events SET rules_config='{"stagePoints":{"champion":999}}'
        WHERE id='approval-policy-probe'$q$,'55000');
      SELECT public.test_reject(
        $q$UPDATE public.events SET rules=jsonb_set(rules,'{config}',
          '{"captainMultiplier":100}'::jsonb,true)
        WHERE id='approval-policy-probe'$q$,'55000');
      SELECT public.test_reject(
        $q$UPDATE public.events SET current_phase='phase3'
        WHERE id='approval-policy-probe'$q$,'55000');
      SELECT public.test_reject(
        $q$UPDATE public.events SET prediction_deadline=clock_timestamp()
        WHERE id='approval-policy-probe'$q$,'55000');
      SELECT public.test_reject(
        $q$UPDATE public.events SET archived_at=clock_timestamp()
        WHERE id='approval-policy-probe'$q$,'55000');
      SELECT public.test_assert(
        (SELECT archived_at IS NULL FROM public.events
         WHERE id='approval-policy-probe'),
        'pending approval cannot be hidden by archiving without superseding votes');
      UPDATE public.events SET name='Renamed without touching scoring'
        WHERE id='approval-policy-probe';
      SELECT public.test_assert(
        (SELECT name='Renamed without touching scoring' FROM public.events
          WHERE id='approval-policy-probe'),
        'a harmless title change remains permitted during pending approval');
      SELECT public.test_reject(
        $q$UPDATE public.teams SET odds=odds+1
          WHERE event_id='approval-policy-probe'$q$,'55000');
      SELECT public.test_reject(
        $q$DELETE FROM public.teams WHERE event_id='approval-policy-probe'$q$,'55000');
      SELECT public.test_reject(
        $q$UPDATE public.event_teams SET metadata='{"gameMultiplier":50}'
          WHERE event_id='approval-policy-probe'$q$,'55000');
      SELECT public.test_reject(
        $q$INSERT INTO public.teams(id,event_id,name,odds)
          VALUES('86000000-0000-4000-8000-0000000000fd',
          'approval-policy-probe','Unauthorized late seed',1)$q$,'55000');
      UPDATE public.teams SET updated_at=now() WHERE event_id='approval-policy-probe';
      RESET ROLE;
      SET ROLE anon;
      SELECT public.test_reject(
        $q$SELECT public.set_koshien_shared_approval_policy(
          'approval-policy-probe','unanimous',0)$q$,'42501');
      RESET ROLE;
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.set_koshien_shared_approval_policy(
          'approval-policy-probe','unanimous',0)$q$,'42501');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SELECT public.test_reject(
        $q$SELECT public.set_koshien_shared_approval_policy(
          'approval-policy-probe','bogus',0)$q$,'22023');
      SELECT public.test_reject(
        $q$SELECT public.set_koshien_shared_approval_policy(
          'approval-policy-probe','unanimous',99)$q$,'40001');
      SELECT public.test_assert(
        (SELECT (d->>'changed')::boolean=false AND (d->>'revision')::bigint=0
         FROM (SELECT public.set_koshien_shared_approval_policy(
           'approval-policy-probe','half',0) AS d) s),
        'same policy and revision is idempotent');
      SELECT public.test_assert(
        (SELECT (d->>'changed')::boolean=true AND (d->>'revision')::bigint=1
         FROM (SELECT public.set_koshien_shared_approval_policy(
           'approval-policy-probe','unanimous',0) AS d) s),
        'changing policy increases revision');
      RESET ROLE;
      SELECT public.test_assert(
        (SELECT rules->>'approvalPolicy'='unanimous'
          AND rules->>'keepMe'='untouched'
          AND status='resultWait'
         FROM public.events WHERE id='approval-policy-probe')
        AND (SELECT revision=1 FROM yoso_approval_private.revisions
          WHERE event_id='approval-policy-probe')
        AND (SELECT status='superseded' FROM yoso_approval_private.submissions
          WHERE event_id='approval-policy-probe')
        AND NOT EXISTS(SELECT 1 FROM yoso_approval_private.transition_permits
          WHERE event_id='approval-policy-probe')
        AND (SELECT (d->>'submission_status')='none'
          FROM (SELECT public.get_koshien_shared_approval_state(
            'approval-policy-probe') AS d) s),
        'policy preserves unrelated rules and makes old votes uncountable');
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.set_koshien_shared_approval_policy(
          'approval-policy-probe','admin',0)$q$,'40001');
      SELECT public.test_assert(
        (SELECT (d->>'changed')::boolean=false AND (d->>'revision')::bigint=1
         FROM (SELECT public.set_koshien_shared_approval_policy(
           'approval-policy-probe','unanimous',1) AS d) s),
        'idempotent repeat does not advance revision');
      RESET ROLE;
      UPDATE public.events
        SET rules_config='{"stagePoints":{"champion":999}}'
        WHERE id='approval-policy-probe';
      SELECT public.test_assert(
        (SELECT rules_config->'stagePoints'->>'champion'='999'
         FROM public.events WHERE id='approval-policy-probe'),
        'scoring settings can change only after old submission is superseded');
      UPDATE public.teams SET odds=odds+1 WHERE event_id='approval-policy-probe';
      SELECT public.test_assert(
        (SELECT odds=2 FROM public.teams WHERE event_id='approval-policy-probe'),
        'team coefficients can change after the old submission is superseded');
      UPDATE public.event_teams SET metadata='{"gameMultiplier":2}'
        WHERE event_id='approval-policy-probe';
      SELECT public.test_assert(
        (SELECT metadata->>'gameMultiplier'='2' FROM public.event_teams
         WHERE event_id='approval-policy-probe'),
        'event-team metadata can change after submission is superseded');
      UPDATE public.events SET archived_at=clock_timestamp()
        WHERE id='approval-policy-probe';
      SELECT public.test_assert(
        (SELECT archived_at IS NOT NULL FROM public.events
         WHERE id='approval-policy-probe'),
        'event can be archived once the old submission is superseded');
      UPDATE public.events SET archived_at=NULL
        WHERE id='approval-policy-probe';
      UPDATE public.events SET status='open'
      WHERE id='approval-policy-probe';
      SELECT public.test_assert(
        (SELECT status='open' FROM public.events
          WHERE id='approval-policy-probe'),
        'event can reopen only after pending approval was superseded');
    """
    sql("BEGIN;\n"
        + (root / "supabase/prototypes/koshien-shared-approval-read.sql").read_text()
        + (root / "supabase/prototypes/koshien-shared-approval-policy.sql").read_text()
        + policy_checks + "\nROLLBACK;")
    assert snapshot()==before,"shared policy test must fully roll back"
    assert sql("SELECT to_regprocedure('public.set_koshien_shared_approval_policy(text,text,bigint)') IS NULL;")=="t"
    print("PASS: shared approval policy auth/CAS, stale votes, idempotence, rollback")

    # Submission prototype: synthetic complete 48-match Koshien with four
    # active members (but five league player rows). No finalize or real votes.
    before=snapshot()

    approve_checks="""
      SELECT set_config('yoso.fixture_submission_id',(
        SELECT id::text FROM yoso_approval_private.submissions
        WHERE event_id='submit-probe' AND status='submitted'),false);
      SAVEPOINT team_coefficients_changed;
      -- Simulate legacy/out-of-band drift to prove vote-time snapshot
      -- detection works even if the team write trigger had been bypassed.
      ALTER TABLE public.teams DISABLE TRIGGER yoso_protect_koshien_team_configuration;
      UPDATE public.teams SET odds=odds+1
      WHERE event_id='submit-probe' AND name='Seed A';
      ALTER TABLE public.teams ENABLE TRIGGER yoso_protect_koshien_team_configuration;
      SET request.jwt.claim.sub='29000000-0000-4000-8000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_assert(
        (SELECT (x->>'submission_status')='stale'
          AND (x->>'requires_resubmission')::boolean=true
         FROM (SELECT public.approve_koshien_shared_results(
           'submit-probe',current_setting('yoso.fixture_submission_id')::uuid,1) AS x) t),
        'scoring team coefficient drift invalidates an otherwise unchanged vote');
      RESET ROLE;
      SELECT public.test_assert(
        (SELECT count(*)=1 FROM yoso_approval_private.votes v
         JOIN yoso_approval_private.submissions s ON s.id=v.submission_id
         WHERE s.event_id='submit-probe' AND s.revision=1)
        AND (SELECT status='superseded' FROM yoso_approval_private.submissions
             WHERE event_id='submit-probe' AND revision=1),
        'stale team metadata adds no vote to the active revision');
      ROLLBACK TO SAVEPOINT team_coefficients_changed;
      SAVEPOINT event_team_metadata_changed;
      ALTER TABLE public.event_teams
        DISABLE TRIGGER yoso_protect_koshien_event_team_configuration;
      UPDATE public.event_teams SET metadata='{"gameMultiplier":2.5}'
        WHERE event_id='submit-probe';
      ALTER TABLE public.event_teams
        ENABLE TRIGGER yoso_protect_koshien_event_team_configuration;
      SET request.jwt.claim.sub='29000000-0000-4000-8000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_assert(
        (SELECT (x->>'submission_status')='stale'
          AND (x->>'requires_resubmission')::boolean=true
         FROM (SELECT public.approve_koshien_shared_results(
           'submit-probe',current_setting('yoso.fixture_submission_id')::uuid,1) AS x) t),
        'event_teams metadata drift invalidates old approval vote');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT event_team_metadata_changed;
      -- A vote before quorum must be rejected if historical/out-of-band
      -- updates changed the signed results payload without a revision.
      SAVEPOINT results_payload_drift_before_vote;
      ALTER TABLE public.results DISABLE TRIGGER USER;
      UPDATE public.results
        SET payload=jsonb_set(payload,'{matches,0,score_a}','99'::jsonb,false)
        WHERE event_id='submit-probe';
      ALTER TABLE public.results ENABLE TRIGGER USER;
      SET request.jwt.claim.sub='29000000-0000-4000-8000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_assert(
        (SELECT (x->>'submission_status')='stale'
          AND (x->>'requires_resubmission')::boolean=true
         FROM (SELECT public.approve_koshien_shared_results(
           'submit-probe',current_setting('yoso.fixture_submission_id')::uuid,1) AS x) t),
        'second voter rejects results payload drift before quorum');
      RESET ROLE;
      SELECT public.test_assert(
        (SELECT count(*)=1 FROM yoso_approval_private.votes v
         JOIN yoso_approval_private.submissions s ON s.id=v.submission_id
         WHERE s.event_id='submit-probe' AND s.revision=1)
        AND (SELECT status='superseded' FROM yoso_approval_private.submissions
          WHERE event_id='submit-probe' AND revision=1),
        'stale results did not add an interim vote');
      ROLLBACK TO SAVEPOINT results_payload_drift_before_vote;
      SET ROLE anon;
      SELECT public.test_reject(
        $q$SELECT public.approve_koshien_shared_results(
        'submit-probe',current_setting('yoso.fixture_submission_id')::uuid,1)$q$,'42501');
      RESET ROLE;
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.approve_koshien_shared_results(
        'submit-probe',current_setting('yoso.fixture_submission_id')::uuid,1)$q$,'42501');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
      SELECT public.test_reject(
        $q$SELECT public.approve_koshien_shared_results(
        'submit-probe',current_setting('yoso.fixture_submission_id')::uuid,1)$q$,'42501');
      RESET ROLE;
      SAVEPOINT roster_changed;
      UPDATE public.league_members SET membership_status='inactive'
      WHERE user_id='29000000-0000-4000-8000-000000000003';
      SET request.jwt.claim.sub='29000000-0000-4000-8000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_assert(
        (SELECT (x->>'submission_status')='stale'
         FROM (SELECT public.approve_koshien_shared_results('submit-probe',
           current_setting('yoso.fixture_submission_id')::uuid,1) AS x) t),
        'membership change invalidates unfinalized approval');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT roster_changed;

      SET request.jwt.claim.sub='29000000-0000-4000-8000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_assert(
        (SELECT (x->>'submission_status')='submitted'
            AND (x->>'approved_count')::int=2
         FROM (SELECT public.approve_koshien_shared_results('submit-probe',
           current_setting('yoso.fixture_submission_id')::uuid,1) AS x) t),
        'second voter is individually identified');
      SELECT public.test_assert(
        (SELECT (x->>'approved_count')::int=2 AND (x->>'idempotent')::boolean=true
         FROM (SELECT public.approve_koshien_shared_results('submit-probe',
           current_setting('yoso.fixture_submission_id')::uuid,1) AS x) t),
        'same voter repeat creates no extra vote');
      SET request.jwt.claim.sub='29000000-0000-4000-8000-000000000002';
      SELECT public.test_assert(
        (SELECT (x->>'approved_count')::int=3
         FROM (SELECT public.approve_koshien_shared_results('submit-probe',
           current_setting('yoso.fixture_submission_id')::uuid,1) AS x) t),
        'third vote remains submitted under unanimity');
      SET request.jwt.claim.sub='29000000-0000-4000-8000-000000000003';
      SELECT public.test_assert(
        (SELECT (x->>'submission_status')='finalized'
           AND (x->>'approved_count')::int=4
         FROM (SELECT public.approve_koshien_shared_results('submit-probe',
           current_setting('yoso.fixture_submission_id')::uuid,1) AS x) t),
        'fourth vote finalizes through exact transition permit');
      RESET ROLE;
      SELECT public.test_assert(
        (SELECT status='finalized' AND rules->'resultFlow'->>'status'='finalized'
          FROM public.events WHERE id='submit-probe')
        AND (SELECT status='finalized' AND finalized_at IS NOT NULL
          FROM yoso_approval_private.submissions WHERE event_id='submit-probe'
            AND revision=1)
        AND NOT EXISTS(SELECT 1 FROM yoso_approval_private.transition_permits
          WHERE event_id='submit-probe'),
        'event and submission finalized; transition permit consumed');
      UPDATE public.events SET archived_at=clock_timestamp()
        WHERE id='submit-probe';
      SELECT public.test_assert(
        (SELECT archived_at IS NOT NULL FROM public.events
          WHERE id='submit-probe'),
        'fully finalized event can still be archived normally');
      UPDATE public.events SET archived_at=NULL WHERE id='submit-probe';
      SET request.jwt.claim.sub='29000000-0000-4000-8000-000000000003';
      SET ROLE authenticated;
      SELECT public.test_assert(
        (SELECT (x->>'submission_status')='finalized'
           AND (x->>'idempotent')::boolean=true
         FROM (SELECT public.approve_koshien_shared_results('submit-probe',
           current_setting('yoso.fixture_submission_id')::uuid,1) AS x) t),
        'replayed vote after finalized is read-only');
      RESET ROLE;
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.reopen_koshien_results('submit-probe');
      SELECT public.test_assert(
        (SELECT (x->>'submission_status')='none'
         FROM (SELECT public.get_koshien_shared_approval_state('submit-probe') AS x) t),
        'reopen revision invalidates previous finalized approval');
      RESET ROLE;
      -- admin=1 must finalize in the same transaction, including its retry.
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.set_koshien_shared_approval_policy('submit-probe','admin',2);
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_assert(
       (SELECT (x->>'submission_status')='finalized'
         AND (x->>'approved_count')::int=1
         AND (x->>'required_count')::int=1
         AND (x->>'idempotent')::boolean=false
        FROM (SELECT public.submit_koshien_shared_results('submit-probe',3) x) r),
       'admin policy first vote finalizes atomically');
      SELECT public.test_assert(
       (SELECT (x->>'idempotent')::boolean=true
        FROM (SELECT public.submit_koshien_shared_results('submit-probe',3) x) r),
       'repeated finalized admin submission returns idempotently');
      RESET ROLE;
      SELECT public.test_assert(
       (SELECT status='finalized' FROM public.events WHERE id='submit-probe')
       AND (SELECT count(*)=1 FROM yoso_approval_private.submissions
        WHERE event_id='submit-probe' AND revision=3 AND status='finalized'),
       'admin submit created one final approval');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$UPDATE public.events SET rules_config='{"phase2Points":{"best16":777}}'
         WHERE id='submit-probe'$q$,'55000');
      SELECT public.test_reject(
        $q$UPDATE public.events SET
          rules=jsonb_set(rules,'{config}','{"captainMultiplier":99}'::jsonb,true)
          WHERE id='submit-probe'$q$,'55000');
      SELECT public.test_reject(
        $q$UPDATE public.teams SET odds=odds+1 WHERE event_id='submit-probe'$q$,'55000');
      SELECT public.test_reject(
        $q$UPDATE public.event_teams SET metadata='{"gameMultiplier":7}'
          WHERE event_id='submit-probe'$q$,'55000');
      RESET ROLE;
      -- half=ceil(4/2)=2: initial admin submit remains pending until another member.
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.reopen_koshien_results('submit-probe');
      SELECT public.set_koshien_shared_approval_policy('submit-probe','half',4);
      RESET ROLE;
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_assert(
       (SELECT (x->>'submission_status')='submitted'
         AND (x->>'required_count')::int=2
         AND (x->>'approved_count')::int=1
        FROM (SELECT public.submit_koshien_shared_results('submit-probe',5) x) r),
       'half policy awaits second voter');
      RESET ROLE;
      SELECT set_config('yoso.fixture_submission_id',(
        SELECT id::text FROM yoso_approval_private.submissions
        WHERE event_id='submit-probe' AND revision=5),false);
      SET request.jwt.claim.sub='29000000-0000-4000-8000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_assert(
       (SELECT (x->>'submission_status')='finalized'
         AND (x->>'approved_count')::int=2
        FROM (SELECT public.approve_koshien_shared_results(
           'submit-probe',current_setting('yoso.fixture_submission_id')::uuid,5) x) r),
       'half policy finalizes at two of four members');
      RESET ROLE;
    """

    submit_checks="""
      INSERT INTO public.events(id,preset_type,league_id,created_by,status,rules,prediction_deadline)
      VALUES('submit-probe','koshien','00000000-0000-0000-0000-000000000010',
        '00000000-0000-0000-0000-000000000001','resultWait',
        '{"approvalPolicy":"unanimous","resultFlow":{"status":"none"},"config":{"phase2Points":{"best16":20}}}'::jsonb,
        now()-interval '1 day');
      UPDATE public.events SET rules_config='{"phase2Points":{"best16":20}}'
      WHERE id='submit-probe';
      INSERT INTO public.league_members(league_id,user_id,role,membership_status)
      SELECT '00000000-0000-0000-0000-000000000010',
        ('29000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'member','active'
      FROM generate_series(1,3) i;
      -- 49 real entrants: 34 schools enter R1 and 15 enter R2 with a bye.
      -- Seed A/B retain their old IDs so coefficient-change tests still work.
      INSERT INTO public.teams(id,event_id,name,start_round)
      SELECT ('86000000-0000-4000-8000-'||lpad(ids.n::text,12,'0'))::uuid,
        'submit-probe',
        CASE WHEN ids.n=1 THEN 'Seed A' WHEN ids.n=2 THEN 'Seed B'
          ELSE 'Seed '||lpad(ids.n::text,2,'0') END,
        CASE WHEN ids.n<=34 THEN 1 ELSE 2 END
      FROM generate_series(1,49) AS ids(n);
      INSERT INTO public.event_teams(id,event_id,name,seed,metadata)
      SELECT 9200+ids.n,'submit-probe',
        CASE WHEN ids.n=1 THEN 'Seed A' WHEN ids.n=2 THEN 'Seed B'
          ELSE 'Seed '||lpad(ids.n::text,2,'0') END,
        ids.n,'{"gameMultiplier":1}'::jsonb
      FROM generate_series(1,49) AS ids(n);
      SELECT yoso_approval_private.issue_write_permit('submit-probe');
      -- Seed a coherent official 49-team knockout progression, without
      -- invoking the live progression triggers before the full bracket exists.
      ALTER TABLE public.matches DISABLE TRIGGER USER;
      INSERT INTO public.matches(
        event_id,round_key,match_no,team1_id,team2_id,
        team1_score,team2_score,winner_team_id,loser_team_id,status,updated_at)
      SELECT 'submit-probe','R1',slot.n,p.first_id,p.second_id,
        3,1,p.first_id,p.second_id,'completed',now()
      FROM generate_series(1,17) AS slot(n)
      CROSS JOIN LATERAL (
        SELECT ('86000000-0000-4000-8000-'||
            lpad((2*slot.n-1)::text,12,'0'))::uuid AS first_id,
          ('86000000-0000-4000-8000-'||
            lpad((2*slot.n)::text,12,'0'))::uuid AS second_id
      ) p;
      WITH entrants AS (
        SELECT k,
          ('86000000-0000-4000-8000-'||
            lpad((CASE WHEN k<=17 THEN 2*k-1 ELSE k+17 END)::text,12,'0'))::uuid AS team_id
        FROM generate_series(1,32) AS ord(k)
      )
      INSERT INTO public.matches(
        event_id,round_key,match_no,team1_id,team2_id,
        team1_score,team2_score,winner_team_id,loser_team_id,status,metadata,updated_at)
      SELECT 'submit-probe','R2',slot.n,a.team_id,b.team_id,
        3,1,a.team_id,b.team_id,'completed',
        jsonb_strip_nulls(jsonb_build_object(
          'team1_source_round_key',CASE WHEN a.k<=17 THEN 'R1' END,
          'team1_source_match_no',CASE WHEN a.k<=17 THEN a.k END,
          'team2_source_round_key',CASE WHEN b.k<=17 THEN 'R1' END,
          'team2_source_match_no',CASE WHEN b.k<=17 THEN b.k END
        )),now()
      FROM generate_series(1,16) AS slot(n)
      JOIN entrants a ON a.k=2*slot.n-1
      JOIN entrants b ON b.k=2*slot.n;
      DO $rounds$
      DECLARE v_round text; v_previous text; v_total integer;
      BEGIN
        FOR v_round,v_previous,v_total IN
          SELECT r.round_key,r.prev_round,r.n FROM
          (VALUES ('R3','R2',8),('QF','R3',4),('SF','QF',2),('F','SF',1))
          AS r(round_key,prev_round,n)
        LOOP
          INSERT INTO public.matches(
            event_id,round_key,match_no,team1_id,team2_id,
            team1_score,team2_score,winner_team_id,loser_team_id,status,metadata,updated_at)
          SELECT 'submit-probe',v_round,slot.n,p1.winner_team_id,p2.winner_team_id,
            3,1,p1.winner_team_id,p2.winner_team_id,'completed',
            CASE WHEN v_round IN ('R3','F') THEN jsonb_build_object(
              'team1_source_round_key',v_previous,
              'team1_source_match_no',2*slot.n-1,
              'team2_source_round_key',v_previous,
              'team2_source_match_no',2*slot.n
            ) ELSE '{}'::jsonb END,now()
          FROM generate_series(1,v_total) AS slot(n)
          JOIN public.matches p1 ON p1.event_id='submit-probe'
            AND p1.round_key=v_previous AND p1.match_no=2*slot.n-1
          JOIN public.matches p2 ON p2.event_id='submit-probe'
            AND p2.round_key=v_previous AND p2.match_no=2*slot.n;
        END LOOP;
      END
      $rounds$;
      ALTER TABLE public.matches ENABLE TRIGGER USER;
      INSERT INTO public.results(event_id,payload,updated_by)
      SELECT 'submit-probe',jsonb_build_object('matches',jsonb_agg(
          jsonb_build_object('round',m.round_key,'match_no',m.match_no,
            'team_a_id',t1.name,'team_b_id',t2.name,
            'winner_id',tw.name,'loser_id',tl.name,
            'score_a',m.team1_score,'score_b',m.team2_score,
            'status',m.status)
          ORDER BY m.round_key,m.match_no)),
          '00000000-0000-0000-0000-000000000001'
      FROM public.matches m
      JOIN public.teams t1 ON t1.id=m.team1_id
      JOIN public.teams t2 ON t2.id=m.team2_id
      JOIN public.teams tw ON tw.id=m.winner_team_id
      JOIN public.teams tl ON tl.id=m.loser_team_id
      WHERE m.event_id='submit-probe';
      INSERT INTO public.scores(event_id,player_id)
      VALUES ('submit-probe','20000000-0000-0000-0000-000000000001'),
             ('submit-probe','28000000-0000-4000-8000-000000000001'),
             ('submit-probe','28000000-0000-4000-8000-000000000002'),
             ('submit-probe','28000000-0000-4000-8000-000000000003');
      -- A historical payload may contain all 48 slots while disagreeing
      -- with the authoritative structured match rows.
      SAVEPOINT mismatched_payload_score;
      SELECT yoso_approval_private.issue_write_permit('submit-probe');
      UPDATE public.results
      SET payload=jsonb_set(payload,'{matches,0,score_a}','99'::jsonb,false)
      WHERE event_id='submit-probe';
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT mismatched_payload_score;

      SAVEPOINT mismatched_payload_school;
      SELECT yoso_approval_private.issue_write_permit('submit-probe');
      UPDATE public.results SET payload=jsonb_set(payload,
        '{matches,0,winner_id}','"Not the winner"'::jsonb,false)
      WHERE event_id='submit-probe';
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT mismatched_payload_school;

      SAVEPOINT duplicated_payload_slot;
      SELECT yoso_approval_private.issue_write_permit('submit-probe');
      UPDATE public.results SET payload=jsonb_set(payload,'{matches,1}',
        payload->'matches'->0,false)
      WHERE event_id='submit-probe';
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT duplicated_payload_slot;

      SELECT public.test_assert(
        (SELECT count(*)=48 FROM public.matches WHERE event_id='submit-probe')
        AND (SELECT count(*)=49 FROM public.teams WHERE event_id='submit-probe')
        AND yoso_approval_private.koshien_bracket_topology_valid('submit-probe')
        AND (SELECT count(*)=4 FROM public.scores WHERE event_id='submit-probe'),
        '49 schools, 48 coherent cards and four active scorers seeded');
      SET ROLE anon;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'42501');
      RESET ROLE;
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000003';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'42501');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'42501');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',123)$q$,'40001');
      RESET ROLE;
      -- The displayed event_teams roster must contain all 49 schools
      -- and map exactly to the scoring-oriented teams roster.
      SAVEPOINT display_roster_missing;
      DELETE FROM public.event_teams WHERE event_id='submit-probe' AND seed=49;
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT display_roster_missing;
      SAVEPOINT display_roster_wrong_name;
      UPDATE public.event_teams SET name='Unknown School'
        WHERE event_id='submit-probe' AND seed=49;
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT display_roster_wrong_name;
      -- Real matches FKs check teams.id only, not teams.event_id. Simulate a
      -- completed match with correct score/winner/loser but a foreign school.
      SAVEPOINT foreign_team_match;
      SELECT yoso_approval_private.issue_write_permit('submit-probe');
      ALTER TABLE public.matches DISABLE TRIGGER USER;
      UPDATE public.matches
        SET team2_id='10000000-0000-0000-0000-000000000002',
            loser_team_id='10000000-0000-0000-0000-000000000002'
        WHERE event_id='submit-probe' AND round_key='R1' AND match_no=1;
      ALTER TABLE public.matches ENABLE TRIGGER USER;
      SELECT public.test_assert(
        (SELECT t.event_id='save' FROM public.matches m JOIN public.teams t
           ON t.id=m.team2_id WHERE m.event_id='submit-probe'
             AND m.round_key='R1' AND m.match_no=1),
        'foreign school ID passes the global FK but belongs to another event');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT foreign_team_match;

      -- A school can advance into a valid R2 slot but from the WRONG
      -- source fixture. Its assigned feeder must match the R1 winner.
      SAVEPOINT mismatched_official_feeder;
      SELECT yoso_approval_private.issue_write_permit('submit-probe');
      ALTER TABLE public.matches DISABLE TRIGGER USER;
      UPDATE public.matches
      SET metadata=jsonb_set(metadata,'{team1_source_match_no}','2'::jsonb,false)
      WHERE event_id='submit-probe' AND round_key='R2' AND match_no=1;
      ALTER TABLE public.matches ENABLE TRIGGER USER;
      SELECT public.test_assert(
        NOT yoso_approval_private.koshien_bracket_topology_valid('submit-probe'),
        'R2 feeder must point to the actual winning R1 match');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT mismatched_official_feeder;

      -- Missing feeder metadata must not silently disable validation.
      SAVEPOINT omitted_official_feeder;
      SELECT yoso_approval_private.issue_write_permit('submit-probe');
      ALTER TABLE public.matches DISABLE TRIGGER USER;
      UPDATE public.matches
      SET metadata=metadata - 'team1_source_match_no' - 'team1_source_round_key'
      WHERE event_id='submit-probe' AND round_key='R2' AND match_no=1;
      ALTER TABLE public.matches ENABLE TRIGGER USER;
      SELECT public.test_assert(
        NOT yoso_approval_private.koshien_bracket_topology_valid('submit-probe'),
        'R2 feeder count cannot be bypassed by removing metadata');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT omitted_official_feeder;

      -- A score-consistent card can still reuse a school twice in R1.
      SAVEPOINT repeated_r1_school;
      SELECT yoso_approval_private.issue_write_permit('submit-probe');
      ALTER TABLE public.matches DISABLE TRIGGER USER;
      UPDATE public.matches
      SET team2_id=(SELECT team2_id FROM public.matches
        WHERE event_id='submit-probe' AND round_key='R1' AND match_no=1),
          loser_team_id=(SELECT team2_id FROM public.matches
        WHERE event_id='submit-probe' AND round_key='R1' AND match_no=1)
      WHERE event_id='submit-probe' AND round_key='R1' AND match_no=2;
      ALTER TABLE public.matches ENABLE TRIGGER USER;
      SELECT public.test_assert(
        NOT yoso_approval_private.koshien_bracket_topology_valid('submit-probe'),
        'a school appearing twice in R1 invalidates bracket topology');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT repeated_r1_school;

      -- The round counts and card-level scores stay valid, but the R1
      -- winner in match 1 must not be replaced by its defeated school in R2.
      SAVEPOINT missing_r1_winner;
      SELECT yoso_approval_private.issue_write_permit('submit-probe');
      ALTER TABLE public.matches DISABLE TRIGGER USER;
      UPDATE public.matches
      SET team1_id=(SELECT loser_team_id FROM public.matches
        WHERE event_id='submit-probe' AND round_key='R1' AND match_no=1),
          winner_team_id=(SELECT loser_team_id FROM public.matches
        WHERE event_id='submit-probe' AND round_key='R1' AND match_no=1)
      WHERE event_id='submit-probe' AND round_key='R2' AND match_no=1;
      ALTER TABLE public.matches ENABLE TRIGGER USER;
      SELECT public.test_assert(
        NOT yoso_approval_private.koshien_bracket_topology_valid('submit-probe'),
        'R1 winner missing from R2 invalidates bracket topology');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT missing_r1_winner;
      SELECT public.test_assert(
        yoso_approval_private.koshien_bracket_topology_valid('submit-probe'),
        'undoing both invalid edits restores the complete bracket');

      -- The school coefficients must describe the real entry round.
      SAVEPOINT wrong_start_round;
      UPDATE public.teams SET start_round=2
        WHERE event_id='submit-probe' AND name='Seed A';
      SELECT public.test_assert(
        NOT yoso_approval_private.koshien_bracket_topology_valid('submit-probe'),
        'an R1 school falsely marked as an R2 bye cannot be approved');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT wrong_start_round;
      SELECT public.test_assert(
        yoso_approval_private.koshien_bracket_topology_valid('submit-probe'),
        'restored start-round metadata passes topology validation');

      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_assert(
        (SELECT (x->>'required_count')::int=4
            AND (x->>'approved_count')::int=1
            AND (x->>'idempotent')::boolean=false
         FROM (SELECT public.submit_koshien_shared_results('submit-probe',0) AS x) s),
        'authorized owner creates unanimous submission with four eligible');
      SELECT public.test_assert(
        (SELECT (x->>'idempotent')::boolean=true
         FROM (SELECT public.submit_koshien_shared_results('submit-probe',0) AS x) s),
        'repeated submission is idempotent');
      RESET ROLE;
      SELECT public.test_assert(
        (SELECT count(*)=1 FROM yoso_approval_private.submissions
         WHERE event_id='submit-probe')
        AND (SELECT count(*)=1 FROM yoso_approval_private.votes),
        'repeat creates no duplicate submission or votes');
      RESET ROLE;
      SELECT public.test_assert(
        (SELECT count(*)=4 FROM
          yoso_approval_private.submissions s,
          LATERAL jsonb_array_elements(s.result_snapshot->'scores') v
         WHERE s.event_id='submit-probe')
        AND (SELECT count(*)=48 FROM
          yoso_approval_private.submissions s,
          LATERAL jsonb_array_elements(s.result_snapshot->'matches') v
         WHERE s.event_id='submit-probe'),
        'private audit snapshot contains four scores and 48 cards');
      SELECT public.test_assert(
        (SELECT result_snapshot->'event_context'->'rules'->'config'
                  ->'phase2Points'->>'best16'='20'
           AND result_snapshot->'event_context'->'rules_config'
                  ->'phase2Points'->>'best16'='20'
           AND jsonb_array_length(result_snapshot->'teams')=49
           AND jsonb_array_length(result_snapshot->'event_teams')=49
         FROM yoso_approval_private.submissions
         WHERE event_id='submit-probe' AND revision=0),
        'private approval audit includes event configuration and team coefficients');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$UPDATE public.events
        SET rules_config='{"phase2Points":{"best16":900}}'
        WHERE id='submit-probe'$q$,'55000');
      SELECT public.test_reject(
        $q$UPDATE public.teams SET odds=odds+1
          WHERE event_id='submit-probe' AND name='Seed A'$q$,'55000');
      SELECT public.test_reject(
        $q$UPDATE public.event_teams SET metadata='{"gameMultiplier":5}'
          WHERE event_id='submit-probe'$q$,'55000');
      RESET ROLE;
      SAVEPOINT invalid_snapshot;
      SELECT yoso_approval_private.issue_write_permit('submit-probe');
      UPDATE public.results
        SET payload=jsonb_set(payload,'{matches}','[]'::jsonb,false)
        WHERE event_id='submit-probe';
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT invalid_snapshot;
      SAVEPOINT missing_score;
      SELECT yoso_approval_private.issue_write_permit('submit-probe');
      DELETE FROM public.scores
        WHERE event_id='submit-probe'
        AND player_id='28000000-0000-4000-8000-000000000003';
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.submit_koshien_shared_results('submit-probe',0)$q$,'55000');
      RESET ROLE;
      ROLLBACK TO SAVEPOINT missing_score;
      SELECT yoso_approval_private.advance_revision('submit-probe',0);
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SET ROLE authenticated;
      SELECT public.test_assert(
        (SELECT (x->>'idempotent')::boolean=false
         FROM (SELECT public.submit_koshien_shared_results('submit-probe',1) AS x) s),
        'new revision creates new submission and one fresh vote');
      RESET ROLE;
      SELECT public.test_assert(
        (SELECT count(*)=1 FROM yoso_approval_private.submissions
         WHERE event_id='submit-probe' AND status='superseded')
        AND (SELECT count(*)=1 FROM yoso_approval_private.submissions
         WHERE event_id='submit-probe' AND status='submitted')
        AND (SELECT count(*)=2 FROM yoso_approval_private.votes),
        'old submission superseded and votes never reused');
    """
    sql("BEGIN;\n"
        + (root / "supabase/prototypes/koshien-shared-approval-read.sql").read_text()
        + (root / "supabase/prototypes/koshien-shared-approval-submit.sql").read_text()
        + (root / "supabase/prototypes/koshien-shared-approval-approve.sql").read_text()
        + (root / "supabase/prototypes/koshien-shared-approval-policy.sql").read_text()
        + submit_checks + approve_checks + "\nROLLBACK;")
    assert snapshot()==before, "shared approval submit/vote must roll back all changes"
    assert sql("SELECT to_regprocedure('public.submit_koshien_shared_results(text,bigint)') IS NULL;")=="t"
    assert sql("SELECT to_regprocedure('public.approve_koshien_shared_results(text,uuid,bigint)') IS NULL;")=="t"
    print("PASS: result submission, quorum voting, guarded finalize, reopen and rollback")


    # Actual membership UPDATE has to wait on the league row shared by
    # approvals and DML triggers; no individual member-row locks are needed.
    race_member = "00000000-0000-0000-0000-000000000002"
    before_member_status=sql("SELECT membership_status FROM public.league_members "
                             "WHERE league_id='00000000-0000-0000-0000-000000000010' "
                             f"AND user_id='{race_member}';")
    assert before_member_status=="active"
    rev=manual_revision("manual-b")
    a=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE,text=True,bufsize=1)
    b=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                       stderr=subprocess.PIPE,text=True)
    try:
        send(a,"SELECT pg_backend_pid();")
        pid=int(line(a))
        setup=("BEGIN;"
          +(root/"supabase/prototypes/koshien-shared-approval-read.sql").read_text()
          +(root/"supabase/prototypes/koshien-shared-approval-approve.sql").read_text()
          +(root/"supabase/prototypes/koshien-shared-approval-policy.sql").read_text()
          +"INSERT INTO public.players(id,league_id,profile_id) "
           "VALUES('87000000-0000-4000-8000-000000000002',"
           "'00000000-0000-0000-0000-000000000010',"
           "'00000000-0000-0000-0000-000000000002');"
           +AUTH+
           "DO $d$ BEGIN PERFORM public.set_koshien_shared_approval_policy("
           "'manual-b','unanimous',"+str(rev)+"); END $d$; RESET ROLE;"
          +"INSERT INTO yoso_approval_private.submissions("
           "event_id,revision,policy,eligible_user_ids,required_count,"
           "submitted_by,status,result_snapshot) VALUES('manual-b',"+
           str(rev+1)+",'unanimous',ARRAY["
           "'00000000-0000-0000-0000-000000000001'::uuid,"
           "'00000000-0000-0000-0000-000000000002'::uuid],2,"
           "'00000000-0000-0000-0000-000000000001','submitted',public.test_shared_approval_snapshot('manual-b'));"
           "INSERT INTO yoso_approval_private.votes(submission_id,voter_user_id) "
           "SELECT id,'00000000-0000-0000-0000-000000000001' "
           "FROM yoso_approval_private.submissions WHERE event_id='manual-b';"
           "DO $block$ BEGIN PERFORM set_config('yoso.test_sub_id',"
           "(SELECT id::text FROM yoso_approval_private.submissions "
           "WHERE event_id='manual-b'),true); END $block$;"
           +AUTH+
           "SELECT public.approve_koshien_shared_results('manual-b',"
           "current_setting('yoso.test_sub_id')::uuid,"+str(rev+1)+");")
        send(a,setup)
        response=json.loads(line(a))
        assert response["submission_status"]=="submitted" and response["approved_count"]==1,response
        send(b,"SET application_name='yoso_membership_vote_b';"
             "SET statement_timeout='15s';"
             "UPDATE public.league_members SET membership_status='inactive' "
             "WHERE league_id='00000000-0000-0000-0000-000000000010' "
             f"AND user_id='{race_member}';")
        deadline=time.monotonic()+8
        while sql("SELECT count(*) FROM pg_stat_activity "
                  "WHERE application_name='yoso_membership_vote_b' "
                  f"AND {pid}=ANY(pg_blocking_pids(pid));")!="1":
            assert b.poll() is None,"member update escaped vote lock"
            assert time.monotonic()<deadline,"member update not waiting on voter"
            time.sleep(.05)
        send(a,"ROLLBACK;")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode==0,a.stderr.read()
        out,err=b.communicate(timeout=10)
        assert b.returncode==0,err
        assert sql("SELECT membership_status FROM public.league_members "
                   "WHERE league_id='00000000-0000-0000-0000-000000000010' "
                   f"AND user_id='{race_member}';")=="inactive"
    finally:
        for proc in (a,b):
            if proc.poll() is None:
                proc.kill()
                proc.wait()
        sql("UPDATE public.league_members SET membership_status='active' "
            "WHERE league_id='00000000-0000-0000-0000-000000000010' "
            f"AND user_id='{race_member}';")
    assert sql("SELECT to_regprocedure('public.approve_koshien_shared_results(text,uuid,bigint)') IS NULL;")=="t"
    assert manual_revision("manual-b")==rev
    print("PASS: existing member removal waits on shared league roster lock")


    # Serialize a NEW member + player INSERT, not only updates to existing
    # rows. A pending vote must not finalize from a stale eligible-user list.
    before=snapshot()
    event_id="roster-race"
    new_uid="39000000-0000-4000-8000-000000000001"
    new_player="89000000-0000-4000-8000-000000000001"
    admin_uid="00000000-0000-0000-0000-000000000001"
    other_uid="00000000-0000-0000-0000-000000000002"
    league_id="00000000-0000-0000-0000-000000000010"
    # The four 290... participant profiles from the earlier test were
    # deliberately rolled back. Seed an actual second active player here.
    sql("INSERT INTO public.players(id,league_id,profile_id) VALUES("
        "'87000000-0000-4000-8000-000000000002',"
        "'"+league_id+"','"+other_uid+"');")
    setup_shared=(
        "BEGIN;"
        +(root/"supabase/prototypes/koshien-shared-approval-read.sql").read_text()
        +(root/"supabase/prototypes/koshien-shared-approval-approve.sql").read_text()
        +"INSERT INTO public.events(id,preset_type,league_id,status,rules,created_by)"
         "VALUES('roster-race','koshien','"+league_id+"','resultWait',"
         "'{\"approvalPolicy\":\"unanimous\",\"resultFlow\":{\"status\":\"none\"}}',"
         "'"+admin_uid+"');"
         "INSERT INTO public.teams(id,event_id,name,odds) VALUES("
         "'86000000-0000-4000-8000-0000000000fc','roster-race','Race Seed',1);"
         "INSERT INTO public.event_teams(id,event_id,name,seed,metadata) VALUES("
         "9301,'roster-race','Race Seed',1,'{\"gameMultiplier\":1}');"
         "SELECT yoso_approval_private.lock_revision('roster-race');"
         "INSERT INTO yoso_approval_private.submissions("
         "event_id,revision,policy,eligible_user_ids,required_count,"
         "submitted_by,status,result_snapshot)"
         "SELECT 'roster-race',0,'unanimous',"
         "array_agg(DISTINCT p.profile_id ORDER BY p.profile_id),"
         "count(DISTINCT p.profile_id)::integer,'"+admin_uid+"',"
         "'submitted',public.test_shared_approval_snapshot('roster-race') "
         "FROM public.players p JOIN public.league_members lm "
         "ON lm.league_id=p.league_id AND lm.user_id=p.profile_id "
         "WHERE p.league_id='"+league_id+"' AND p.profile_id IS NOT NULL "
         "AND lm.membership_status='active';"
        "COMMIT;")
    sql(setup_shared)
    assert sql("SELECT required_count FROM yoso_approval_private.submissions "
               "WHERE event_id='roster-race' AND status='submitted';")=="2"
    def current_submission():
        return sql("SELECT id FROM yoso_approval_private.submissions "
                   "WHERE event_id='roster-race' AND status='submitted';")
    def vote_statement(submission_id,uid):
        return ("SET request.jwt.claim.sub='"+uid+"';SET ROLE authenticated;"
                "SELECT public.approve_koshien_shared_results("
                "'roster-race','"+submission_id+"',0);")

    # Reproduce the troublesome inverse lock order. A legacy team writer
    # already holds the event row; B acquires the approval advisory lock and
    # waits for the same event; A must fail FAST trying to write a team row.
    # A waiting team trigger would deadlock here (event -> team -> event).
    a=b=None
    try:
        sid=current_submission()
        a=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE,text=True,bufsize=1)
        send(a,"SELECT pg_backend_pid();")
        holder_pid=int(line(a))
        send(a,"SET application_name='yoso_team_event_holder';BEGIN;"
               "SELECT id FROM public.events WHERE id='roster-race' FOR UPDATE;")
        assert line(a)=="roster-race", "legacy team writer did not lock event"
        b=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE,text=True)
        send(b,"SET application_name='yoso_team_vote_waiter';"
               "SET statement_timeout='15s';BEGIN;"
               +vote_statement(sid,admin_uid)+"COMMIT;")
        deadline=time.monotonic()+8
        while sql("SELECT count(*) FROM pg_stat_activity "
                  "WHERE application_name='yoso_team_vote_waiter' "
                  f"AND {holder_pid}=ANY(pg_blocking_pids(pid));")!="1":
            assert b.poll() is None, "approval did not wait on event row"
            assert time.monotonic()<deadline, "approval event wait not observed"
            time.sleep(.05)
        send(a,"UPDATE public.teams SET odds=odds+1 "
               "WHERE event_id='roster-race' AND name='Race Seed';")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode!=0 and "team configuration is being approved" in a.stderr.read(), \
            "team writer must fail fast instead of deadlocking with the voter"
        output,errors=b.communicate(timeout=10)
        assert b.returncode==0,errors
        result=json.loads(output.strip().splitlines()[-1])
        assert result["submission_status"]=="submitted" and result["approved_count"]==1,result
        assert sql("SELECT odds FROM public.teams WHERE event_id='roster-race';")=="1"
        print("PASS: prelocked event vs approval advisory lock rejects team write without deadlock")
    finally:
        for proc in (a,b):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait()

    # Normal direct table DML must also be rejected for pending submissions.
    sql(AUTH+"SELECT public.test_reject("
        "$q$UPDATE public.teams SET odds=7 WHERE event_id='roster-race'$q$,'55000');"
        "SELECT public.test_reject("
        "$q$DELETE FROM public.teams WHERE event_id='roster-race'$q$,'55000');"
        "SELECT public.test_reject("
        "$q$UPDATE public.event_teams SET metadata='{}' "
        "WHERE event_id='roster-race'$q$,'55000');")
    def add_new_member(with_player=True):
        x=("INSERT INTO public.league_members(league_id,user_id,role,membership_status)"
           " VALUES('"+league_id+"','"+new_uid+"','member','active');")
        if with_player:
            x+=("INSERT INTO public.players(id,league_id,profile_id)"
                " VALUES('"+new_player+"','"+league_id+"','"+new_uid+"');")
        return x
    def clear_new_member():
        sql("DELETE FROM public.players WHERE id='"+new_player+"';"
            "DELETE FROM public.league_members WHERE league_id='"+league_id+"' "
            "AND user_id='"+new_uid+"';")
    def await_roster_block(waiter_app,holder_pid):
        deadline=time.monotonic()+8
        while sql("SELECT count(*) FROM pg_stat_activity "
                  "WHERE application_name='"+waiter_app+"' "
                  f"AND {holder_pid}=ANY(pg_blocking_pids(pid));")!="1":
            assert time.monotonic()<deadline, "new roster writer did not wait"
            time.sleep(.05)

    a=b=None
    try:
        # Vote goes first. INSERT of a member that did not exist when the
        # original submission was created must block until vote commits.
        sid=current_submission()
        a=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE,text=True,bufsize=1)
        send(a,"SELECT pg_backend_pid();")
        a_pid=int(line(a))
        send(a,"SET application_name='yoso_insert_vote_a';BEGIN;"
               +vote_statement(sid,admin_uid))
        status=json.loads(line(a))
        assert status["submission_status"]=="submitted" and status["approved_count"]==1,status
        b=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE,text=True)
        send(b,"SET application_name='yoso_insert_member_b';"
               "SET statement_timeout='15s';BEGIN;"
               +add_new_member()+"COMMIT;")
        await_roster_block("yoso_insert_member_b",a_pid)
        assert sql("SELECT count(*) FROM public.league_members "
                   "WHERE user_id='"+new_uid+"';")=="0"
        send(a,"COMMIT;")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode==0,a.stderr.read()
        out,err=b.communicate(timeout=10)
        assert b.returncode==0,err
        assert sql("SELECT count(*) FROM public.players "
                   "WHERE profile_id='"+new_uid+"';")=="1"
        stale=json.loads(sql(vote_statement(sid,other_uid)))
        assert stale["submission_status"]=="stale" and stale["requires_resubmission"],stale
        assert sql("SELECT count(*) FROM yoso_approval_private.votes "
                   "WHERE submission_id='"+sid+"';")=="1"
        print("PASS: new member+player INSERT waits for committed vote; roster drift supersedes approval")
        clear_new_member()

        # Reverse order: a new member is already being inserted (uncommitted)
        # when the vote begins. The vote must wait for that transaction, then
        # read the newly committed roster and reject the old eligible set.
        sql("INSERT INTO yoso_approval_private.submissions("
            "event_id,revision,policy,eligible_user_ids,required_count,"
            "submitted_by,status,result_snapshot) "
            "SELECT 'roster-race',0,'unanimous',"
            "array_agg(DISTINCT p.profile_id ORDER BY p.profile_id),"
            "count(DISTINCT p.profile_id)::integer,'"+admin_uid+"',"
            "'submitted',public.test_shared_approval_snapshot('roster-race') "
            "FROM public.players p JOIN public.league_members lm "
            "ON lm.league_id=p.league_id AND lm.user_id=p.profile_id "
            "WHERE p.league_id='"+league_id+"' AND p.profile_id IS NOT NULL "
            "AND lm.membership_status='active';")
        sid=current_submission()
        a=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE,text=True)
        b=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE,text=True,bufsize=1)
        send(b,"SELECT pg_backend_pid();")
        b_pid=int(line(b))
        send(b,"SET application_name='yoso_insert_first_b';BEGIN;"
               +add_new_member()+"SELECT 'member-inserted';")
        assert line(b)=="member-inserted", "membership writer failed to take the first lock"
        send(a,"SET application_name='yoso_vote_after_insert_a';"
               "SET statement_timeout='15s';BEGIN;"
               +vote_statement(sid,admin_uid)+"COMMIT;")
        await_roster_block("yoso_vote_after_insert_a",b_pid)
        send(b,"COMMIT;")
        b.stdin.close()
        b.wait(timeout=10)
        assert b.returncode==0,b.stderr.read()
        out,err=a.communicate(timeout=10)
        assert a.returncode==0,err
        stale=json.loads(out.strip().splitlines()[-1])
        assert stale["submission_status"]=="stale" and stale["requires_resubmission"],stale
        assert sql("SELECT count(*) FROM yoso_approval_private.votes "
                   "WHERE submission_id='"+sid+"';")=="0"
        print("PASS: vote waits for preceding member INSERT and rejects stale voter set")

        # A league member may already be active before the corresponding
        # player/profile row is created. That second INSERT is a separate
        # eligibility-changing path and must block on the same league lock.
        clear_new_member()
        sql(add_new_member(with_player=False))
        sql("INSERT INTO yoso_approval_private.submissions("
            "event_id,revision,policy,eligible_user_ids,required_count,"
            "submitted_by,status,result_snapshot) "
            "SELECT 'roster-race',0,'unanimous',"
            "array_agg(DISTINCT p.profile_id ORDER BY p.profile_id),"
            "count(DISTINCT p.profile_id)::integer,'"+admin_uid+"',"
            "'submitted',public.test_shared_approval_snapshot('roster-race') "
            "FROM public.players p JOIN public.league_members lm "
            "ON lm.league_id=p.league_id AND lm.user_id=p.profile_id "
            "WHERE p.league_id='"+league_id+"' AND p.profile_id IS NOT NULL "
            "AND lm.membership_status='active';")
        sid=current_submission()
        assert sql("SELECT required_count FROM yoso_approval_private.submissions "
                   "WHERE id='"+sid+"';")=="2"
        a=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE,text=True,bufsize=1)
        send(a,"SELECT pg_backend_pid();")
        a_pid=int(line(a))
        send(a,"SET application_name='yoso_player_vote_a';BEGIN;"
               +vote_statement(sid,admin_uid))
        data=json.loads(line(a))
        assert data["submission_status"]=="submitted" and data["approved_count"]==1,data
        # KEY SHARE protects against the roster trigger's FOR UPDATE, but
        # permits unrelated non-key league metadata edits (NO KEY UPDATE).
        assert sql("UPDATE public.leagues SET name='renamed-during-vote' "
                   "WHERE id='"+league_id+"' RETURNING name;")=="renamed-during-vote"
        sql("UPDATE public.leagues SET name='fixture' WHERE id='"+league_id+"';")
        # Profile display and membership timestamps do not affect voting
        # eligibility. These updates must not wait for the league roster lock.
        assert sql("UPDATE public.players SET display_name='cosmetic-edit' "
                   "WHERE id='87000000-0000-4000-8000-000000000002' "
                   "RETURNING display_name;")=="cosmetic-edit"
        assert sql("UPDATE public.league_members SET joined_at=now() "
                   "WHERE league_id='"+league_id+"' AND user_id='"+other_uid+"' "
                   "RETURNING role;")=="member"
        b=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                           stderr=subprocess.PIPE,text=True)
        send(b,"SET application_name='yoso_player_insert_b';"
               "SET statement_timeout='15s';BEGIN;"
               "INSERT INTO public.players(id,league_id,profile_id) VALUES("
               "'"+new_player+"','"+league_id+"','"+new_uid+"');COMMIT;")
        await_roster_block("yoso_player_insert_b",a_pid)
        assert sql("SELECT count(*) FROM public.players "
                   "WHERE id='"+new_player+"';")=="0"
        send(a,"COMMIT;")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode==0,a.stderr.read()
        out,err=b.communicate(timeout=10)
        assert b.returncode==0,err
        stale=json.loads(sql(vote_statement(sid,other_uid)))
        assert stale["submission_status"]=="stale" and stale["requires_resubmission"],stale
        print("PASS: standalone player INSERT waits for vote and invalidates stale submission")
    finally:
        for proc in (a,b):
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait()
        clear_new_member()
        sql("DELETE FROM public.players "
            "WHERE id='87000000-0000-4000-8000-000000000002';")
        sql("DROP FUNCTION IF EXISTS public.approve_koshien_shared_results(text,uuid,bigint);"
            "DROP TRIGGER IF EXISTS yoso_protect_shared_approval_event_status ON public.events;"
            "DROP FUNCTION IF EXISTS yoso_approval_private.protect_shared_approval_event_status();"
            "DROP TRIGGER IF EXISTS yoso_protect_koshien_team_configuration ON public.teams;"
            "DROP TRIGGER IF EXISTS yoso_protect_koshien_event_team_configuration ON public.event_teams;"
            "DROP FUNCTION IF EXISTS yoso_approval_private.protect_koshien_team_configuration();"
            "DROP FUNCTION IF EXISTS yoso_approval_private.team_config_lock_key(text);"
            "DROP FUNCTION IF EXISTS yoso_approval_private.koshien_bracket_topology_valid(text);"
            "DROP FUNCTION IF EXISTS public.get_koshien_shared_approval_state(text);"
            "DROP TABLE IF EXISTS yoso_approval_private.votes;"
            "DROP TABLE IF EXISTS yoso_approval_private.submissions;"
            "DELETE FROM yoso_approval_private.revisions WHERE event_id='roster-race';"
            "DELETE FROM public.teams WHERE event_id='roster-race';"
            "DELETE FROM public.event_teams WHERE event_id='roster-race';"
            "DELETE FROM public.events WHERE id='roster-race';")
    assert snapshot()==before,"new-roster concurrency test must restore all tracked tables"
    assert sql("SELECT to_regprocedure('yoso_approval_private.koshien_bracket_topology_valid(text)') IS NULL;")=="t"
    print("PASS: roster race data and RPC cleanup restores original PostgreSQL fixture")


    # Production function bodies (catalog snapshot) for real membership entry
    # points. DDL and all mutations exist ONLY inside this isolated transaction.
    live_rpc_before=snapshot()
    live_rpc_checks="""
      INSERT INTO auth.users(id) VALUES
        ('00000000-0000-0000-0000-000000000001'),
        ('00000000-0000-0000-0000-000000000002');
      INSERT INTO public.profiles(id,auth_user_id,display_name) VALUES
        ('00000000-0000-0000-0000-000000000001',
         '00000000-0000-0000-0000-000000000001','Owner'),
        ('00000000-0000-0000-0000-000000000002',
         '00000000-0000-0000-0000-000000000002','Member');
      INSERT INTO public.players(id,league_id,profile_id,display_name)
      VALUES('87000000-0000-4000-8000-000000000002',
        '00000000-0000-0000-0000-000000000010',
        '00000000-0000-0000-0000-000000000002','Member');
      INSERT INTO public.league_join_requests(id,league_id,requester_id)
      VALUES('49000000-0000-4000-8000-000000000001',
        '00000000-0000-0000-0000-000000000010',
        '59000000-0000-4000-8000-000000000001');
      SET ROLE anon;
      SELECT public.test_reject(
       $q$SELECT count(*) FROM public.review_club_join_request(
        '49000000-0000-4000-8000-000000000001',true)$q$,'42501');
      RESET ROLE;
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
      SET ROLE authenticated;
      SELECT public.test_reject(
       $q$SELECT count(*) FROM public.review_club_join_request(
        '49000000-0000-4000-8000-000000000001',true)$q$,'42501');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SELECT public.test_assert(
       (SELECT request_status='approved' FROM public.review_club_join_request(
          '49000000-0000-4000-8000-000000000001',true)),
       'real join-review RPC returns approved');
      SELECT public.test_assert(
       (SELECT role='member' AND membership_status='active'
         FROM public.league_members WHERE user_id='59000000-0000-4000-8000-000000000001'),
       'join-review persists active membership through league trigger');
      SELECT public.test_reject(
       $q$SELECT count(*) FROM public.review_club_join_request(
        '49000000-0000-4000-8000-000000000001',true)$q$,'P0002');
      SELECT public.test_assert(
        (SELECT (x->>'changed')::boolean
         FROM (SELECT public.manage_league_admin(
          '00000000-0000-0000-0000-000000000010',
          '00000000-0000-0000-0000-000000000002',true) x) t),
       'real admin-role RPC reports change');
      SELECT public.test_assert(
        (SELECT role='co_owner' FROM public.league_members
          WHERE user_id='00000000-0000-0000-0000-000000000002'),
       'admin-role RPC persists role change');
      SELECT public.test_assert(
        (SELECT (x->>'changed')::boolean
         FROM (SELECT public.manage_league_admin(
          '00000000-0000-0000-0000-000000000010',
          '00000000-0000-0000-0000-000000000002',false) x) t),
        'real admin-role RPC restores regular member');
      SELECT public.test_assert(
        (SELECT (x->>'removed')::boolean
         FROM (SELECT public.remove_club_member(
          '00000000-0000-0000-0000-000000000010',
          '00000000-0000-0000-0000-000000000002') x) t),
       'real member-removal RPC reports removal');
      SELECT public.test_assert(
        (SELECT membership_status='removed' FROM public.league_members
          WHERE user_id='00000000-0000-0000-0000-000000000002'),
       'member-removal persists removed status without deleting history');
      SELECT public.test_reject(
       $q$SELECT public.remove_club_member(
          '00000000-0000-0000-0000-000000000010',
          '00000000-0000-0000-0000-000000000001')$q$,'42501');
      -- Actual account deletion is run by the auth service/owner, not by an
      -- ordinary authenticated SQL role without DELETE permission.
      RESET ROLE;
      SELECT public.test_reject(
       $q$DELETE FROM auth.users
          WHERE id='00000000-0000-0000-0000-000000000001'$q$,'23503');
      UPDATE public.league_members SET membership_status='active'
       WHERE user_id='00000000-0000-0000-0000-000000000002';
      DELETE FROM auth.users WHERE id='00000000-0000-0000-0000-000000000002';
      SELECT public.test_assert(
       (SELECT membership_status='removed' FROM public.league_members
         WHERE user_id='00000000-0000-0000-0000-000000000002')
       AND (SELECT display_name LIKE '退会済みメンバー-%' AND auth_user_id IS NULL
         FROM public.profiles WHERE id='00000000-0000-0000-0000-000000000002')
       AND (SELECT display_name LIKE '退会済みメンバー-%'
         FROM public.players WHERE profile_id='00000000-0000-0000-0000-000000000002'),
       'real account-delete triggers anonymize and remove membership');
      SELECT public.test_assert(
        (SELECT count(*)=2 FROM public.league_admin_audit),
        'admin-role changes retain two audit entries');
    """
    sql("BEGIN;\n"
        + (root / "supabase/prototypes/koshien-real-membership-rpcs.sql").read_text()
        + live_rpc_checks + "\nROLLBACK;")
    assert snapshot()==live_rpc_before, "real membership RPC fixture must fully roll back"
    assert sql("SELECT to_regprocedure('public.review_club_join_request(uuid,boolean)') IS NULL;")=="t"
    assert sql("SELECT to_regprocedure('public.remove_club_member(uuid,uuid)') IS NULL;")=="t"
    assert sql("SELECT to_regclass('auth.users') IS NULL;")=="t"
    print("PASS: real join/role/remove/account-delete RPC bodies, ACL and full rollback")


    # The same exact production membership RPC bodies now run concurrently
    # with a real shared approval vote. All state stays inside the disposable DB.
    before_live_races=snapshot()
    before_members=sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
                       "FROM public.league_members t;")
    before_players=sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
                       "FROM public.players t;")
    league_id="00000000-0000-0000-0000-000000000010"
    owner_id="00000000-0000-0000-0000-000000000001"
    member_id="00000000-0000-0000-0000-000000000002"
    request_id="49000000-0000-4000-8000-000000000001"
    new_uid="59000000-0000-4000-8000-000000000001"
    member_player="87000000-0000-4000-8000-000000000002"
    new_player="89000000-0000-4000-8000-000000000001"
    sql((root / "supabase/prototypes/koshien-real-membership-rpcs.sql").read_text()
        + (root / "supabase/prototypes/koshien-shared-approval-read.sql").read_text()
        + (root / "supabase/prototypes/koshien-shared-approval-approve.sql").read_text()
        + "INSERT INTO auth.users(id) VALUES('"+owner_id+"'),('"+member_id+"');"
        + "INSERT INTO public.profiles(id,auth_user_id,display_name) VALUES "
          "('"+owner_id+"','"+owner_id+"','Owner'),"
          "('"+member_id+"','"+member_id+"','Member');"
        + "INSERT INTO public.players(id,league_id,profile_id,display_name) "
          "VALUES('"+member_player+"','"+league_id+"','"+member_id+"','Member');"
        + "INSERT INTO public.events(id,preset_type,league_id,status,rules,created_by)"
          " VALUES('rpc-race','koshien','"+league_id+"','resultWait',"
          "'{\"approvalPolicy\":\"unanimous\",\"resultFlow\":{\"status\":\"none\"}}',"
          "'"+owner_id+"');"
        + "SELECT yoso_approval_private.lock_revision('rpc-race');")
    def create_live_submission():
        sql("INSERT INTO yoso_approval_private.submissions("
            "event_id,revision,policy,eligible_user_ids,required_count,"
            "submitted_by,status,result_snapshot)"
            "SELECT 'rpc-race',0,'unanimous',"
            "array_agg(DISTINCT p.profile_id ORDER BY p.profile_id),"
            "count(DISTINCT p.profile_id)::integer,'"+owner_id+"',"
            "'submitted',public.test_shared_approval_snapshot('rpc-race') "
            "FROM public.players p JOIN public.league_members lm "
            "ON lm.league_id=p.league_id AND lm.user_id=p.profile_id "
            "WHERE p.league_id='"+league_id+"' AND p.profile_id IS NOT NULL "
            "AND lm.membership_status='active';")
        return sql("SELECT id FROM yoso_approval_private.submissions "
                   "WHERE event_id='rpc-race' AND status='submitted';")
    def live_vote(sid):
        return (AUTH+"SELECT public.approve_koshien_shared_results("
                "'rpc-race','"+sid+"',0);")
    def stale_previous(sid):
        result=json.loads(sql(live_vote(sid)))
        assert result["submission_status"]=="stale" and result["requires_resubmission"],result
        assert sql("SELECT status FROM yoso_approval_private.submissions "
                   "WHERE id='"+sid+"';")=="superseded"
    def run_live_race(sid,writer_sql,label,expects_block=True):
        a=b=None
        try:
            a=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE,text=True,bufsize=1)
            send(a,"SELECT pg_backend_pid();")
            first_pid=int(line(a))
            send(a,"BEGIN;"+live_vote(sid))
            vote=json.loads(line(a))
            assert vote["submission_status"]=="submitted",vote
            b=subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE,text=True)
            send(b,"SET application_name='yoso_real_rpc_writer';"
                   "SET statement_timeout='15s';BEGIN;"+writer_sql+"COMMIT;")
            deadline=time.monotonic()+8
            while sql("SELECT count(*) FROM pg_stat_activity "
                      "WHERE application_name='yoso_real_rpc_writer' "
                      f"AND {first_pid}=ANY(pg_blocking_pids(pid));")!="1":
                assert b.poll() is None,label+": writer exited before league-lock wait"
                assert time.monotonic()<deadline,label+": writer did not wait"
                time.sleep(.05)
            send(a,"COMMIT;")
            a.stdin.close()
            a.wait(timeout=10)
            assert a.returncode==0,a.stderr.read()
            out,err=b.communicate(timeout=10)
            assert b.returncode==0,label+": "+err
            assert out.strip(),label+": no RPC/update result"
            return out.strip().splitlines()[-1]
        finally:
            for proc in (a,b):
                if proc is not None and proc.poll() is None:
                    proc.kill()
                    proc.wait()

    try:
        # Actual removal RPC: it first locks its member row, then its
        # membership UPDATE trigger waits for the voting league lock.
        sid=create_live_submission()
        removed=json.loads(run_live_race(
            sid,AUTH+"SELECT public.remove_club_member('"+league_id+"','"+member_id+"');",
            "remove_club_member"))
        assert removed["removed"] is True
        stale_previous(sid)
        assert sql("SELECT membership_status FROM public.league_members "
                   "WHERE user_id='"+member_id+"';")=="removed"
        sql("UPDATE public.league_members SET membership_status='active' "
            "WHERE league_id='"+league_id+"' AND user_id='"+member_id+"';")
        print("PASS: real remove_club_member waits on vote; removed member invalidates approval")

        # Actual join approval grants membership only. Player registration
        # is a separate authenticated action BY THE NEW USER, not by the owner.
        sql("INSERT INTO auth.users(id) VALUES('"+new_uid+"');"
            "INSERT INTO public.profiles(id,auth_user_id,display_name) VALUES("
            "'"+new_uid+"','"+new_uid+"','New joiner');"
            "INSERT INTO public.league_join_requests(id,league_id,requester_id)"
            " VALUES('"+request_id+"','"+league_id+"','"+new_uid+"');")
        sid=create_live_submission()
        joined=run_live_race(
            sid,AUTH+"SELECT count(*) FROM public.review_club_join_request('"+
            request_id+"',true);","review_club_join_request")
        assert joined=="1",joined
        assert sql("SELECT status FROM public.league_join_requests "
                   "WHERE id='"+request_id+"';")=="approved"
        # Without a player identity, the new member is not yet a voter.
        unchanged=json.loads(sql(live_vote(sid)))
        assert unchanged["submission_status"]=="submitted" and unchanged["approved_count"]==1
        sql("SET request.jwt.claim.sub='"+owner_id+"';SET ROLE authenticated;"
            "SELECT public.test_reject($q$INSERT INTO public.players("
            "id,league_id,profile_id,display_name) VALUES("
            "'"+new_player+"','"+league_id+"','"+new_uid+"','Impersonated')"
            "$q$,'42501');")
        # Self-registration now contends on the same league row, and changes
        # the eligible roster only AFTER the approval lock is released.
        registered=run_live_race(
            sid,"SET request.jwt.claim.sub='"+new_uid+"';SET ROLE authenticated;"
            "INSERT INTO public.players(id,league_id,profile_id,display_name)"
            " VALUES('"+new_player+"','"+league_id+"','"+new_uid+"','New joiner');"
            "SELECT 'registered';","new_member_self_register")
        assert registered=="registered",registered
        stale_previous(sid)
        sql("DELETE FROM public.players WHERE id='"+new_player+"';"
            "DELETE FROM public.league_members WHERE user_id='"+new_uid+"';")
        print("PASS: real join approval waits; only new member may add player; stale quorum rejected")

        # The real owner admin-role RPC updates a membership role. This must
        # wait, but an active member's voter identity does not change.
        sid=create_live_submission()
        changed=json.loads(run_live_race(
            sid,AUTH+"SELECT public.manage_league_admin('"+league_id+"','"+
            member_id+"',true);","manage_league_admin"))
        assert changed["changed"] is True and changed["role"]=="co_owner",changed
        still_pending=json.loads(sql(live_vote(sid)))
        assert still_pending["submission_status"]=="submitted" and still_pending["approved_count"]==1
        sql("UPDATE yoso_approval_private.submissions SET status='superseded' "
            "WHERE id='"+sid+"';"
            "UPDATE public.league_members SET role='member' WHERE user_id='"+member_id+"';")
        print("PASS: real manage_league_admin waits without invalidating unchanged eligible roster")

        # Actual auth.users AFTER DELETE trigger anonymizes the member,
        # and its membership-status update must not race an approval vote.
        sid=create_live_submission()
        deleted=run_live_race(sid,
            "DELETE FROM auth.users WHERE id='"+member_id+"' RETURNING id;",
            "archive_deleted_account")
        assert deleted==member_id,deleted
        stale_previous(sid)
        assert sql("SELECT membership_status FROM public.league_members "
                   "WHERE user_id='"+member_id+"';")=="removed"
        assert sql("SELECT display_name LIKE '退会済みメンバー-%' "
                   "FROM public.players WHERE profile_id='"+member_id+"';")=="t"
        print("PASS: real auth account-delete trigger waits for vote, anonymizes and invalidates")
    finally:
        # Revert every synthetic row and drop only throwaway fixture objects.
        sql("DELETE FROM public.players WHERE id IN ('"+member_player+"','"+new_player+"');"
            "DELETE FROM public.league_members WHERE user_id='"+new_uid+"';"
            "UPDATE public.league_members SET role='member',membership_status='active' "
            "WHERE league_id='"+league_id+"' AND user_id='"+member_id+"';"
            "DROP FUNCTION IF EXISTS public.approve_koshien_shared_results(text,uuid,bigint);"
            "DROP TRIGGER IF EXISTS yoso_protect_shared_approval_event_status ON public.events;"
            "DROP FUNCTION IF EXISTS yoso_approval_private.protect_shared_approval_event_status();"
            "DROP TRIGGER IF EXISTS yoso_protect_koshien_team_configuration ON public.teams;"
            "DROP TRIGGER IF EXISTS yoso_protect_koshien_event_team_configuration ON public.event_teams;"
            "DROP FUNCTION IF EXISTS yoso_approval_private.protect_koshien_team_configuration();"
            "DROP FUNCTION IF EXISTS yoso_approval_private.team_config_lock_key(text);"
            "DROP FUNCTION IF EXISTS yoso_approval_private.koshien_bracket_topology_valid(text);"
            "DROP FUNCTION IF EXISTS public.get_koshien_shared_approval_state(text);"
            "DROP TABLE IF EXISTS yoso_approval_private.votes;"
            "DROP TABLE IF EXISTS yoso_approval_private.submissions;"
            "DELETE FROM yoso_approval_private.revisions WHERE event_id='rpc-race';"
            "DELETE FROM public.events WHERE id='rpc-race';"
            "DROP TABLE IF EXISTS auth.users;"
            "DROP TABLE IF EXISTS public.profiles;"
            "DROP FUNCTION IF EXISTS public.archive_deleted_account();"
            "DROP FUNCTION IF EXISTS public.prevent_owner_account_deletion();"
            "DROP FUNCTION IF EXISTS public.review_club_join_request(uuid,boolean);"
            "DROP FUNCTION IF EXISTS public.remove_club_member(uuid,uuid);"
            "DROP FUNCTION IF EXISTS public.manage_league_admin(uuid,uuid,boolean);"
            "DROP FUNCTION IF EXISTS public.is_league_owner(uuid);"
            "DROP TABLE IF EXISTS public.league_join_requests;"
            "DROP TABLE IF EXISTS public.league_admin_audit;"
            "DROP POLICY IF EXISTS yoso_fixture_players_insert_self ON public.players;"
            "ALTER TABLE public.players DISABLE ROW LEVEL SECURITY;"
            "REVOKE INSERT ON public.players FROM authenticated;"
            "ALTER TABLE public.league_members DROP CONSTRAINT IF EXISTS league_members_pkey;")
    assert snapshot()==before_live_races,"real RPC races must restore tracked event data"
    assert sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
               "FROM public.league_members t;")==before_members
    assert sql("SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]') "
               "FROM public.players t;")==before_players
    assert sql("SELECT to_regprocedure('public.review_club_join_request(uuid,boolean)') IS NULL;")=="t"
    print("PASS: real membership/auth RPC race suite fully restores isolated fixture")


    # Real club deletion acquires parent league FOR UPDATE before cascade.
    # This transaction adds only disposable FK relationships and private
    # approval rows, then ROLLBACKs all effects.
    before_cascade=snapshot()
    revisions_before=sql("SELECT count(*) FROM yoso_approval_private.revisions;")
    cascade_checks="""
      ALTER TABLE public.leagues ADD COLUMN created_by uuid;
      ALTER TABLE public.events ADD CONSTRAINT fixture_events_league_fk
        FOREIGN KEY(league_id) REFERENCES public.leagues(id) ON DELETE CASCADE NOT VALID;
      ALTER TABLE public.league_members ADD CONSTRAINT fixture_members_league_fk
        FOREIGN KEY(league_id) REFERENCES public.leagues(id) ON DELETE CASCADE NOT VALID;
      ALTER TABLE public.players ADD CONSTRAINT fixture_players_league_fk
        FOREIGN KEY(league_id) REFERENCES public.leagues(id) ON DELETE CASCADE NOT VALID;
      -- Production teams and event_teams also cascade on event DELETE.
      ALTER TABLE public.teams ADD CONSTRAINT fixture_teams_event_fk
        FOREIGN KEY(event_id) REFERENCES public.events(id) ON DELETE CASCADE NOT VALID;
      ALTER TABLE public.event_teams ADD CONSTRAINT fixture_event_teams_event_fk
        FOREIGN KEY(event_id) REFERENCES public.events(id) ON DELETE CASCADE NOT VALID;

      INSERT INTO public.leagues(id,name,created_by)
        VALUES('00000000-0000-0000-0000-000000000030','Cascade club',
          '00000000-0000-0000-0000-000000000001');
      INSERT INTO public.league_members(league_id,user_id,role,membership_status)
        VALUES('00000000-0000-0000-0000-000000000030',
          '00000000-0000-0000-0000-000000000001','owner','active');
      INSERT INTO public.players(id,league_id,profile_id,display_name)
        VALUES('88000000-0000-4000-8000-000000000030',
          '00000000-0000-0000-0000-000000000030',
          '00000000-0000-0000-0000-000000000001','Club owner');
      INSERT INTO public.events(id,preset_type,league_id,status,created_by,rules)
        VALUES('cascade-event','koshien',
          '00000000-0000-0000-0000-000000000030','resultWait',
          '00000000-0000-0000-0000-000000000001','{}');
      INSERT INTO public.teams(id,event_id,name,odds)
        VALUES('86000000-0000-4000-8000-0000000000ea','cascade-event','Cascade Seed',2);
      INSERT INTO public.event_teams(id,event_id,name,seed,metadata)
        VALUES(9401,'cascade-event','Cascade Seed',1,'{"gameMultiplier":2}');
      SELECT yoso_approval_private.lock_revision('cascade-event');
      INSERT INTO yoso_approval_private.submissions(
        event_id,revision,policy,eligible_user_ids,required_count,
        submitted_by,result_snapshot
      ) VALUES('cascade-event',0,'admin',
        ARRAY['00000000-0000-0000-0000-000000000001'::uuid],1,
        '00000000-0000-0000-0000-000000000001','{}'::jsonb);
      INSERT INTO yoso_approval_private.votes(submission_id,voter_user_id)
        SELECT id,'00000000-0000-0000-0000-000000000001'
        FROM yoso_approval_private.submissions WHERE event_id='cascade-event';

      SET ROLE anon;
      SELECT public.test_reject(
        $q$SELECT public.delete_club(
        '00000000-0000-0000-0000-000000000030','Cascade club')$q$,'42501');
      RESET ROLE;
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
      SET ROLE authenticated;
      SELECT public.test_reject(
        $q$SELECT public.delete_club(
        '00000000-0000-0000-0000-000000000030','Cascade club')$q$,'42501');
      SET request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
      SELECT public.test_reject(
        $q$SELECT public.delete_club(
        '00000000-0000-0000-0000-000000000030','Wrong club name')$q$,'22023');
      SELECT public.delete_club(
        '00000000-0000-0000-0000-000000000030','Cascade club');
      RESET ROLE;
      SELECT public.test_assert(
        NOT EXISTS(SELECT 1 FROM public.leagues
          WHERE id='00000000-0000-0000-0000-000000000030')
        AND NOT EXISTS(SELECT 1 FROM public.events WHERE id='cascade-event')
        AND NOT EXISTS(SELECT 1 FROM public.league_members
          WHERE league_id='00000000-0000-0000-0000-000000000030')
        AND NOT EXISTS(SELECT 1 FROM public.players
          WHERE league_id='00000000-0000-0000-0000-000000000030')
        AND NOT EXISTS(SELECT 1 FROM public.teams WHERE event_id='cascade-event')
        AND NOT EXISTS(SELECT 1 FROM public.event_teams WHERE event_id='cascade-event')
        AND NOT EXISTS(SELECT 1 FROM yoso_approval_private.revisions
          WHERE event_id='cascade-event')
        AND NOT EXISTS(SELECT 1 FROM yoso_approval_private.submissions
          WHERE event_id='cascade-event')
        AND NOT EXISTS(SELECT 1 FROM yoso_approval_private.votes),
        'real club deletion cascades event, roster, revision and private votes');
      SELECT public.test_assert(
        (SELECT count(*)=1 FROM public.leagues
          WHERE id='00000000-0000-0000-0000-000000000010'),
        'other leagues are unaffected by isolated club deletion');
    """
    sql("BEGIN;\n"
        + (root / "supabase/prototypes/koshien-real-delete-club.sql").read_text()
        + (root / "supabase/prototypes/koshien-shared-approval-read.sql").read_text()
        + cascade_checks + "\nROLLBACK;")
    assert snapshot()==before_cascade, "club deletion fixture must leave tracked state unchanged"
    assert sql("SELECT count(*) FROM yoso_approval_private.revisions;")==revisions_before
    assert sql("SELECT to_regprocedure('public.delete_club(uuid,text)') IS NULL;")=="t"
    print("PASS: real delete_club cascading event and private approval data; full rollback")


    # Three real two-session races against production delete_club:
    # (a) vote first, (b) delete first and COMMIT, (c) delete first and ROLLBACK.
    # All DDL below lives exclusively in the disposable CI database.
    before_delete_races=snapshot()
    club_id="00000000-0000-0000-0000-000000000030"
    club_event="cascade-concurrent"
    club_owner="00000000-0000-0000-0000-000000000001"
    club_member="00000000-0000-0000-0000-000000000002"
    club_name="Concurrent deletion test"
    sql("ALTER TABLE public.leagues ADD COLUMN created_by uuid;"
        "ALTER TABLE public.events ADD CONSTRAINT ci_event_club_fk "
        "FOREIGN KEY(league_id) REFERENCES public.leagues(id) ON DELETE CASCADE NOT VALID;"
        "ALTER TABLE public.league_members ADD CONSTRAINT ci_member_club_fk "
        "FOREIGN KEY(league_id) REFERENCES public.leagues(id) ON DELETE CASCADE NOT VALID;"
        "ALTER TABLE public.players ADD CONSTRAINT ci_player_club_fk "
        "FOREIGN KEY(league_id) REFERENCES public.leagues(id) ON DELETE CASCADE NOT VALID;"
        "ALTER TABLE public.teams ADD CONSTRAINT ci_team_event_fk "
        "FOREIGN KEY(event_id) REFERENCES public.events(id) ON DELETE CASCADE NOT VALID;"
        "ALTER TABLE public.event_teams ADD CONSTRAINT ci_event_team_event_fk "
        "FOREIGN KEY(event_id) REFERENCES public.events(id) ON DELETE CASCADE NOT VALID;"
        +(root/"supabase/prototypes/koshien-real-delete-club.sql").read_text()
        +(root/"supabase/prototypes/koshien-shared-approval-read.sql").read_text()
        +(root/"supabase/prototypes/koshien-shared-approval-approve.sql").read_text())

    def seed_delete_race():
        sql("INSERT INTO public.leagues(id,name,created_by) "
            "VALUES('"+club_id+"','"+club_name+"','"+club_owner+"');"
            "INSERT INTO public.league_members(league_id,user_id,role,membership_status) "
            "VALUES('"+club_id+"','"+club_owner+"','owner','active'),"
            "('"+club_id+"','"+club_member+"','member','active');"
            "INSERT INTO public.players(id,league_id,profile_id,display_name) VALUES"
            "('88000000-0000-4000-8000-000000000031','"+club_id+"','"+club_owner+"','Owner'),"
            "('88000000-0000-4000-8000-000000000032','"+club_id+"','"+club_member+"','Member');"
            "INSERT INTO public.events(id,preset_type,league_id,status,created_by,rules) "
            "VALUES('"+club_event+"','koshien','"+club_id+"','resultWait','"+club_owner+"',"
            "'{\"approvalPolicy\":\"unanimous\",\"resultFlow\":{\"status\":\"none\"}}');"
            "INSERT INTO public.teams(id,event_id,name,odds) VALUES("
            "'86000000-0000-4000-8000-0000000000eb','"+club_event+"','Concurrent Seed',2);"
            "INSERT INTO public.event_teams(id,event_id,name,seed,metadata) VALUES("
            "9402,'"+club_event+"','Concurrent Seed',1,'{\"gameMultiplier\":2}');"
            "SELECT yoso_approval_private.lock_revision('"+club_event+"');"
            "INSERT INTO yoso_approval_private.submissions("
            "event_id,revision,policy,eligible_user_ids,required_count,submitted_by,result_snapshot)"
            "VALUES('"+club_event+"',0,'unanimous',"
            "ARRAY['"+club_owner+"'::uuid,'"+club_member+"'::uuid],2,"
            "'"+club_owner+"',public.test_shared_approval_snapshot('"+club_event+"'));")
        return sql("SELECT id FROM yoso_approval_private.submissions "
                   "WHERE event_id='"+club_event+"' AND status='submitted';")

    def vote_delete_race(sid):
        return (AUTH+"SELECT public.approve_koshien_shared_results('"+
                club_event+"','"+sid+"',0);")

    def delete_sql():
        return ("DO $do$ BEGIN PERFORM public.delete_club('"+
                club_id+"','"+club_name+"'); END $do$;")

    def check_deleted():
        assert sql("SELECT count(*) FROM public.leagues WHERE id='"+club_id+"';")=="0"
        assert sql("SELECT count(*) FROM public.events WHERE id='"+club_event+"';")=="0"
        assert sql("SELECT count(*) FROM public.league_members WHERE league_id='"+club_id+"';")=="0"
        assert sql("SELECT count(*) FROM public.players WHERE league_id='"+club_id+"';")=="0"
        assert sql("SELECT count(*) FROM public.teams WHERE event_id='"+club_event+"';")=="0"
        assert sql("SELECT count(*) FROM public.event_teams WHERE event_id='"+club_event+"';")=="0"
        assert sql("SELECT count(*) FROM yoso_approval_private.revisions WHERE event_id='"+club_event+"';")=="0"
        assert sql("SELECT count(*) FROM yoso_approval_private.submissions WHERE event_id='"+club_event+"';")=="0"
        assert sql("SELECT count(*) FROM yoso_approval_private.votes;")=="0"

    def check_blocked(waiting_name,holder_pid,proc):
        deadline=time.monotonic()+8
        while sql("SELECT count(*) FROM pg_stat_activity "
                  "WHERE application_name='"+waiting_name+"' "
                  f"AND {holder_pid}=ANY(pg_blocking_pids(pid));")!="1":
            assert proc.poll() is None,waiting_name+": exited before waiting"
            assert time.monotonic()<deadline,waiting_name+": no lock wait"
            time.sleep(.05)

    def new_psql():
        return subprocess.Popen(PSQL,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE,text=True,bufsize=1)
    def end_psql(*procs):
        for proc in procs:
            if proc is not None and proc.poll() is None:
                proc.kill()
                proc.wait()

    a=b=None
    try:
        sid=seed_delete_race()
        a=new_psql()
        send(a,"SELECT pg_backend_pid();")
        a_pid=int(line(a))
        send(a,"BEGIN;"+vote_delete_race(sid))
        result=json.loads(line(a))
        assert result["submission_status"]=="submitted" and result["approved_count"]==1,result
        b=new_psql()
        send(b,"SET application_name='yoso_delete_waits_vote';"
               "SET statement_timeout='15s';BEGIN;"+AUTH+delete_sql()+"SELECT 'deleted';COMMIT;")
        check_blocked("yoso_delete_waits_vote",a_pid,b)
        send(a,"COMMIT;")
        a.stdin.close()
        a.wait(timeout=10)
        assert a.returncode==0,a.stderr.read()
        output,errors=b.communicate(timeout=10)
        assert b.returncode==0 and output.strip().splitlines()[-1]=="deleted",errors
        check_deleted()
        print("PASS: real delete_club waits behind vote and cascades every approval record")
        end_psql(a,b)
        a=b=None

        sid=seed_delete_race()
        b=new_psql()
        send(b,"SELECT pg_backend_pid();")
        b_pid=int(line(b))
        send(b,"BEGIN;"+AUTH+delete_sql()+"SELECT 'delete-prepared';")
        assert line(b)=="delete-prepared"
        a=new_psql()
        send(a,"SET application_name='yoso_vote_waits_delete';"
               "SET statement_timeout='15s';BEGIN;"+vote_delete_race(sid)+"COMMIT;")
        check_blocked("yoso_vote_waits_delete",b_pid,a)
        send(b,"COMMIT;")
        b.stdin.close()
        b.wait(timeout=10)
        assert b.returncode==0,b.stderr.read()
        output,errors=a.communicate(timeout=10)
        assert a.returncode!=0 and "approval league not found" in errors,errors
        check_deleted()
        print("PASS: vote waits for committed club deletion then rejects without mutation")
        end_psql(a,b)
        a=b=None

        sid=seed_delete_race()
        b=new_psql()
        send(b,"SELECT pg_backend_pid();")
        b_pid=int(line(b))
        send(b,"BEGIN;"+AUTH+delete_sql()+"SELECT 'delete-prepared';")
        assert line(b)=="delete-prepared"
        a=new_psql()
        send(a,"SET application_name='yoso_vote_after_delete_rollback';"
               "SET statement_timeout='15s';BEGIN;"+vote_delete_race(sid)+"COMMIT;")
        check_blocked("yoso_vote_after_delete_rollback",b_pid,a)
        send(b,"ROLLBACK;")
        b.stdin.close()
        b.wait(timeout=10)
        assert b.returncode==0,b.stderr.read()
        output,errors=a.communicate(timeout=10)
        assert a.returncode==0,errors
        vote=json.loads(output.strip().splitlines()[-1])
        assert vote["submission_status"]=="submitted" and vote["approved_count"]==1,vote
        assert sql("SELECT status FROM public.events WHERE id='"+club_event+"';")=="resultWait"
        assert sql("SELECT count(*) FROM yoso_approval_private.votes;")=="1"
        sql(AUTH+"SELECT public.delete_club('"+club_id+"','"+club_name+"');")
        check_deleted()
        print("PASS: rolled-back club deletion preserves vote and permits subsequent clean deletion")
    finally:
        end_psql(a,b)
        # The failed checks above never touch production; forcibly clean up
        # only this test's fixed IDs and scoped schema in disposable DB.
        sql("DELETE FROM public.leagues WHERE id='"+club_id+"';"
            "DROP FUNCTION IF EXISTS public.approve_koshien_shared_results(text,uuid,bigint);"
            "DROP TRIGGER IF EXISTS yoso_protect_shared_approval_event_status ON public.events;"
            "DROP FUNCTION IF EXISTS yoso_approval_private.protect_shared_approval_event_status();"
            "DROP TRIGGER IF EXISTS yoso_protect_koshien_team_configuration ON public.teams;"
            "DROP TRIGGER IF EXISTS yoso_protect_koshien_event_team_configuration ON public.event_teams;"
            "DROP FUNCTION IF EXISTS yoso_approval_private.protect_koshien_team_configuration();"
            "DROP FUNCTION IF EXISTS yoso_approval_private.team_config_lock_key(text);"
            "DROP FUNCTION IF EXISTS yoso_approval_private.koshien_bracket_topology_valid(text);"
            "DROP FUNCTION IF EXISTS public.get_koshien_shared_approval_state(text);"
            "DROP TABLE IF EXISTS yoso_approval_private.votes;"
            "DROP TABLE IF EXISTS yoso_approval_private.submissions;"
            "DROP FUNCTION IF EXISTS public.delete_club(uuid,text);"
            "DROP FUNCTION IF EXISTS public.is_league_owner(uuid);"
            "ALTER TABLE public.events DROP CONSTRAINT IF EXISTS ci_event_club_fk;"
            "ALTER TABLE public.league_members DROP CONSTRAINT IF EXISTS ci_member_club_fk;"
            "ALTER TABLE public.players DROP CONSTRAINT IF EXISTS ci_player_club_fk;"
            "ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS ci_team_event_fk;"
            "ALTER TABLE public.event_teams DROP CONSTRAINT IF EXISTS ci_event_team_event_fk;"
            "ALTER TABLE public.leagues DROP COLUMN created_by;")
    assert snapshot()==before_delete_races
    assert sql("SELECT to_regprocedure('public.delete_club(uuid,text)') IS NULL;")=="t"
    print("PASS: club deletion concurrent race fixture restored with no external changes")

finally:
    sql("DROP OWNED BY authenticated,anon; DROP ROLE authenticated,anon;")
    if sql("SELECT count(*) FROM pg_roles WHERE rolname='service_role';") == "1":
        sql("DROP OWNED BY service_role; DROP ROLE service_role;")
