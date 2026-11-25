#!/usr/bin/env python3
"""Isolated PostgreSQL races. Never connect to a hosted database."""
import os
import selectors
import subprocess
import sys
import time

if os.environ.get("GITHUB_ACTIONS") != "true" or sys.argv[1:] != ["yoso_ranking_v1_test"]:
    raise SystemExit("Use only disposable hosted CI database")
DB = sys.argv[1]
PSQL = ["sudo", "-u", "postgres", "psql", "-h", "/var/run/postgresql",
        "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", DB]
OWNER = "00000000-0000-0000-0000-000000000001"
MEMBER = "00000000-0000-0000-0000-000000000002"
CLUB = "00000000-0000-0000-0000-000000000010"
PICK = """'{"version":1,"candidateIds":["a","b","c","d"]}'::jsonb"""
PROCS = []

def auth(uid):
    return f"SET request.jwt.claim.sub='{uid}'; SET ROLE authenticated;"

def sql(statement, error=None):
    p = subprocess.run(PSQL, input=statement, text=True, capture_output=True, timeout=15)
    if error:
        assert p.returncode != 0 and error in p.stderr, p.stderr
    else:
        assert p.returncode == 0, p.stderr
    return p.stdout.strip()

def start():
    p = subprocess.Popen(PSQL, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.PIPE, text=True, bufsize=1)
    PROCS.append(p)
    return p

def send(p, statement):
    p.stdin.write(statement + "\n")
    p.stdin.flush()

def line(p):
    with selectors.DefaultSelector() as sel:
        sel.register(p.stdout, selectors.EVENT_READ)
        assert sel.select(timeout=12), "backend did not respond"
    value = p.stdout.readline().strip()
    assert value, p.stderr.read() if p.poll() is not None else "empty backend output"
    return value

def finish(p, expected=None):
    out, err = p.communicate(timeout=15)
    if expected:
        assert p.returncode != 0 and expected in err, err
    else:
        assert p.returncode == 0, err
    return out.strip()

def create_event(event, duration):
    sql(auth(OWNER) + f"""INSERT INTO public.events
       SELECT '{event}','{CLUB}','Race','ranking_v1','draft',
       clock_timestamp()+interval '{duration}',rules,'{OWNER}','baseball'
       FROM public.events WHERE id='expired';
       UPDATE public.events SET status='open' WHERE id='{event}';""")

def insert(event, uid):
    return f"INSERT INTO public.predictions(event_id,user_id,payload) VALUES('{event}','{uid}',{PICK}) RETURNING event_id;"

def wait_deadline(event):
    end = time.monotonic()+20
    while sql(f"SELECT clock_timestamp()>=prediction_deadline FROM public.events WHERE id='{event}';") != "t":
        assert time.monotonic() < end, "deadline did not arrive"
        time.sleep(0.1)

def wait_blocked(name, holder_pid, waiter):
    end = time.monotonic()+8
    while sql(f"SELECT count(*) FROM pg_stat_activity WHERE application_name='{name}' AND {holder_pid}=ANY(pg_blocking_pids(pid));") != "1":
        assert waiter.poll() is None, "waiter exited unexpectedly"
        assert time.monotonic() < end, "event update never waited for prediction"
        time.sleep(0.05)

try:
    # Exact NOWAIT error, followed by a successful retry with no extra row.
    create_event("race-lock", "1 day")
    a=start()
    send(a,"BEGIN;"+auth(OWNER)+"UPDATE public.events SET name='Locked' WHERE id='race-lock' RETURNING id;")
    assert line(a)=="race-lock"
    sql(auth(MEMBER)+insert("race-lock",MEMBER),error="55P03")
    assert sql("SELECT count(*) FROM public.predictions WHERE event_id='race-lock';")=="0"
    send(a,"ROLLBACK;")
    finish(a)
    assert sql(auth(MEMBER)+insert("race-lock",MEMBER))=="race-lock"
    assert sql("SELECT count(*) FROM public.predictions WHERE event_id='race-lock';")=="1"
    print("PASS: event lock rejects conflicting save (55P03), rollback permits exact retry")

    # One accepted save holds a parent lock while the clock crosses deadline.
    # Another transaction started before the deadline cannot exploit now().
    create_event("race-close", "8 seconds")
    a=start()
    send(a,"SELECT pg_backend_pid();")
    holder=int(line(a))
    send(a,"BEGIN;"+auth(MEMBER)+insert("race-close",MEMBER))
    assert line(a)=="race-close"
    late=start()
    send(late,"BEGIN;"+auth(OWNER)+"SELECT public.is_prediction_open('race-close');")
    assert line(late)=="t"
    wait_deadline("race-close")
    send(late,"SELECT public.is_prediction_open('race-close') AND clock_timestamp()>=(SELECT prediction_deadline FROM public.events WHERE id='race-close');")
    assert line(late)=="t","old transaction must reproduce legacy now() bypass"
    send(late,insert("race-close",OWNER))
    finish(late,expected="ranking prediction closed or unauthorized")
    assert sql("SELECT count(*) FROM public.predictions WHERE event_id='race-close';")=="0","uncommitted save unexpectedly visible"
    b=start()
    send(b,"SET application_name='ranking_v1_close_wait';SET statement_timeout='15s';"+auth(OWNER)+
         "UPDATE public.events SET status='resultWait' WHERE id='race-close' RETURNING status;")
    wait_blocked("ranking_v1_close_wait",holder,b)
    send(a,"COMMIT;")
    finish(a)
    assert finish(b)=="resultWait"
    assert sql(auth(OWNER)+"SELECT count(*) FROM public.predictions WHERE event_id='race-close';")=="1"
    assert sql("SELECT count(*) FROM public.predictions WHERE event_id='race-close' AND user_id='"+OWNER+"';")=="0"
    print("PASS: stale-transaction late save rejected, close waits for accepted save, post-deadline publication correct")
finally:
    for p in PROCS:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=5)
