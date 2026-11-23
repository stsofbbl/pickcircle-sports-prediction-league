#!/usr/bin/env python3
"""Three isolated two-session races. Never connects to Supabase."""
import json
import selectors
import subprocess
import sys
import time

if sys.argv[1:] != ["yoso_admin_finalize_mvp_test"]:
    raise SystemExit("Use only the disposable CI database")
DB = sys.argv[1]
PSQL = ["sudo", "-u", "postgres", "psql", "-h", "/var/run/postgresql",
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", DB]
EVENT = "test-finalize"
UID = "00000000-0000-0000-0000-000000000001"
AUTH = f"SET request.jwt.claim.sub='{UID}';SET ROLE authenticated;"
FIN = ("SELECT public.finalize_koshien_admin_results('test-finalize',"
       + "public.koshien_result_version('test-finalize'));")
EDIT = ("UPDATE public.matches SET team1_score=3,"
        "updated_at=updated_at+interval '10 seconds' "
        "WHERE event_id='test-finalize' AND round_key='F' RETURNING team1_score;")

def sql(statement):
    p = subprocess.run(PSQL, input=statement, text=True, capture_output=True, timeout=12)
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()

def start():
    p = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True, bufsize=1)
    return p

def send(p, statement):
    p.stdin.write(statement + "\n")
    p.stdin.flush()

def line(p):
    with selectors.DefaultSelector() as selector:
        selector.register(p.stdout, selectors.EVENT_READ)
        assert selector.select(timeout=10), "backend did not produce expected output"
    result = p.stdout.readline().strip()
    assert result, p.stderr.read() if p.poll() is not None else "empty backend output"
    return result

def blocked(name, holder_pid, waiter):
    deadline = time.monotonic() + 8
    while sql("SELECT count(*) FROM pg_stat_activity "
              f"WHERE application_name='{name}' "
              f"AND {holder_pid}=ANY(pg_blocking_pids(pid));") != "1":
        assert waiter.poll() is None, name + ": backend exited unexpectedly"
        assert time.monotonic() < deadline, name + ": backend never blocked"
        time.sleep(0.05)

def close(*procs):
    for p in procs:
        if p is not None and p.poll() is None:
            p.kill()
            p.wait(timeout=5)

def restore():
    if sql(f"SELECT status FROM public.events WHERE id='{EVENT}';") == "finalized":
        # Reuse the real audited RPC; direct state reversal must stay forbidden.
        sql(AUTH + f"SELECT public.reopen_koshien_results('{EVENT}');")
    sql("UPDATE public.matches SET team1_score=2,"
        "updated_at=updated_at-interval '10 seconds' "
        f"WHERE event_id='{EVENT}' AND round_key='F' AND team1_score=3;")
    # This is a disposable test fixture, not the production audit ledger.
    sql(f"DELETE FROM public.koshien_result_reopens WHERE event_id='{EVENT}';")

assert sql("SELECT status FROM public.events WHERE id='test-finalize';") == "resultWait"
baseline_version = sql("SELECT public.koshien_result_version('test-finalize');")
a=b=None
try:
    # A result writer first locks the event via its BEFORE trigger. B must
    # wait on the parent and then reject the stale version after A commits.
    a=start()
    send(a,"SELECT pg_backend_pid();")
    pid=int(line(a))
    send(a,"BEGIN;"+AUTH+EDIT)
    assert line(a)=="3"
    b=start()
    send(b,"SET application_name='yoso_admin_finalize_waits_writer';"
           "SET statement_timeout='15s';"+AUTH+
           "SELECT public.finalize_koshien_admin_results('test-finalize',"+
           baseline_version+");")
    blocked("yoso_admin_finalize_waits_writer",pid,b)
    send(a,"COMMIT;")
    a.stdin.close()
    a.wait(timeout=10)
    assert a.returncode==0,a.stderr.read()
    out,err=b.communicate(timeout=10)
    assert b.returncode!=0 and "40001" in err,err
    assert sql("SELECT status FROM public.events WHERE id='test-finalize';")=="resultWait"
    print("PASS: saved result wins; admin finalize rejects stale version (40001)")
finally:
    close(a,b)
    restore()

a=b=None
try:
    # Finalization owns the parent and match read locks. An edit after the
    # finalization commit must fail, not silently change published scores.
    a=start()
    send(a,"SELECT pg_backend_pid();")
    pid=int(line(a))
    send(a,"BEGIN;"+AUTH+FIN)
    response=json.loads(line(a))
    assert response["event_status"]=="finalized",response
    b=start()
    send(b,"SET application_name='yoso_admin_match_waits_final';"
           "SET statement_timeout='15s';"+AUTH+EDIT)
    blocked("yoso_admin_match_waits_final",pid,b)
    send(a,"COMMIT;")
    a.stdin.close()
    a.wait(timeout=10)
    assert a.returncode==0,a.stderr.read()
    out,err=b.communicate(timeout=10)
    assert b.returncode!=0 and "42501" in err,err
    assert sql("SELECT status FROM public.events WHERE id='test-finalize';")=="finalized"
    assert sql("SELECT team1_score FROM public.matches "
               "WHERE event_id='test-finalize' AND round_key='F';")=="2"
    print("PASS: finalized result blocks later match edit (42501)")
finally:
    close(a,b)
    restore()

a=b=None
try:
    # Aborted finalization must leave the event writable and without a
    # dangling permit; an already-waiting editor may then complete normally.
    a=start()
    send(a,"SELECT pg_backend_pid();")
    pid=int(line(a))
    send(a,"BEGIN;"+AUTH+FIN)
    response=json.loads(line(a))
    assert response["event_status"]=="finalized",response
    b=start()
    send(b,"SET application_name='yoso_admin_edit_after_rollback';"
           "SET statement_timeout='15s';"+AUTH+EDIT)
    blocked("yoso_admin_edit_after_rollback",pid,b)
    send(a,"ROLLBACK;")
    a.stdin.close()
    a.wait(timeout=10)
    assert a.returncode==0,a.stderr.read()
    out,err=b.communicate(timeout=10)
    assert b.returncode==0 and out.strip().splitlines()[-1]=="3",err
    assert sql("SELECT status FROM public.events WHERE id='test-finalize';")=="resultWait"
    print("PASS: rolled-back finalization allows waiting edit to complete")
finally:
    close(a,b)
    restore()

assert sql("SELECT public.koshien_result_version('test-finalize');")==baseline_version
assert sql("SELECT count(*) FROM yoso_admin_finalize_private.permits;")=="0"
print("PASS: three two-session races restore the original disposable fixture")
