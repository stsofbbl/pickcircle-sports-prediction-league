#!/usr/bin/env python3
"""Two real sessions, using captured representative RPCs in the disposable CI DB."""
import json
import selectors
import subprocess
import sys
import time

if sys.argv[1:] != ["yoso_koshien_lifecycle_test"]:
    raise SystemExit("Use only the disposable CI database")
PSQL = ["sudo", "-u", "postgres", "psql", "-h", "/var/run/postgresql",
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", sys.argv[1]]
UID = "00000000-0000-0000-0000-000000000001"
AUTH = f"SET request.jwt.claim.sub='{UID}';SET ROLE authenticated;"
EVENT = "lifecycle-race"
OPEN = f"SELECT public.open_koshien_draft('{EVENT}',public.koshien_admin_result_revision('{EVENT}'));"
REPLACE = f"SELECT public.replace_koshien_representatives('{EVENT}',public.fixture_roster(),2027);"

def sql(statement):
    p = subprocess.run(PSQL, input=statement, text=True, capture_output=True, timeout=15)
    assert p.returncode == 0, p.stderr
    return p.stdout.strip()

def start():
    return subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True, bufsize=1)

def send(p, statement):
    p.stdin.write(statement + "\n")
    p.stdin.flush()

def line(p):
    with selectors.DefaultSelector() as selector:
        selector.register(p.stdout, selectors.EVENT_READ)
        assert selector.select(timeout=10), "backend did not respond"
    result = p.stdout.readline().strip()
    assert result, "unexpected empty output"
    return result

def blocked(name, pid, waiter):
    deadline = time.monotonic() + 8
    while sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{name}' AND {pid}=ANY(pg_blocking_pids(pid));") != "1":
        assert waiter.poll() is None, "waiter exited unexpectedly"
        assert time.monotonic() < deadline, "waiter did not block"
        time.sleep(0.05)

def close(*procs):
    for p in procs:
        if p is not None and p.poll() is None:
            p.kill()
            p.wait(timeout=5)

def finish(p, statement):
    send(p, statement)
    p.stdin.close()
    p.wait(timeout=10)
    assert p.returncode == 0, p.stderr.read()

def confirm():
    return sql(AUTH+f"SELECT public.confirm_koshien_start_rounds('{EVENT}',(SELECT jsonb_agg(jsonb_build_object('representative_key',metadata->>'representative_key','start_round',CASE WHEN seed<=15 THEN 2 ELSE 1 END) ORDER BY seed) FROM public.teams WHERE event_id='{EVENT}'));")

sql(AUTH+f"""INSERT INTO public.events(id,league_id,preset_type,status,rules,name,season,prediction_deadline,created_by)
VALUES ('{EVENT}','00000000-0000-0000-0000-000000000010','koshien','draft',
'{{"approvalPolicy":"admin","resultFlow":{{"status":"none"}},"config":{{"teams":[],"startRoundsConfirmed":false,"externalResults":{{"competitionType":"summer","year":2027}}}}}}',
'Race fixture','2027',now()+interval '1 year',auth.uid());"""+REPLACE)
confirm()
rev=sql(AUTH+f"SELECT public.koshien_admin_result_revision('{EVENT}');")
a=b=None
try:
    # Actual roster RPC locks the event; the opening RPC must wait and reject stale review.
    a=start()
    send(a,"SELECT pg_backend_pid();")
    pid=int(line(a))
    send(a,"BEGIN;"+AUTH+REPLACE)
    assert json.loads(line(a))["startRoundsConfirmed"] is False
    b=start()
    send(b,"SET application_name='yoso_open_wait_roster';SET statement_timeout='15s';"+AUTH+
           f"SELECT public.open_koshien_draft('{EVENT}','{rev}');")
    blocked("yoso_open_wait_roster",pid,b)
    finish(a,"COMMIT;")
    out,err=b.communicate(timeout=15)
    assert b.returncode != 0 and "PT409" in err and "draft changed; reload before opening" in err,err
    assert sql(f"SELECT status FROM public.events WHERE id='{EVENT}';")=="draft"
    print("PASS: actual roster write wins; opening rejects stale revision (PT409)")
finally:
    close(a,b)

confirm()
a=b=None
try:
    # Opening wins; the waiting roster RPC must roll back when it tries to clear confirmation.
    a=start()
    send(a,"SELECT pg_backend_pid();")
    pid=int(line(a))
    send(a,"BEGIN;"+AUTH+OPEN)
    assert json.loads(line(a))["status"]=="open"
    b=start()
    send(b,"SET application_name='yoso_roster_wait_open';SET statement_timeout='15s';"+AUTH+REPLACE+"\n\\q")
    blocked("yoso_roster_wait_open",pid,b)
    finish(a,"COMMIT;")
    out,err=b.communicate(timeout=15)
    status=sql(f"SELECT status||':'||(rules->'config'->>'startRoundsConfirmed') FROM public.events WHERE id='{EVENT}';")
    assert b.returncode!=0 and "22023" in err and status=="open:true", (status,out,err)
    print("PASS: opening wins; waiting roster import is rejected and confirmation remains true")
finally:
    close(a,b)

assert sql("SELECT count(*) FROM public.matches WHERE event_id='test-finalize';")=="48"
print("PASS: two-session characterization completed in isolated database")
