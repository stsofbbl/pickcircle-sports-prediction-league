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
    revision=sql(auth(OWNER)+f"""SELECT public.ranking_v1_api_create_draft(
       '{CLUB}','{event}','{OWNER}','Race','baseball',clock_timestamp()+interval '{duration}',
       (SELECT rules FROM public.events WHERE id='expired'))->>'revision';""")
    assert len(revision)==32
    assert sql(auth(OWNER)+f"SELECT public.ranking_v1_api_open('{CLUB}','{event}','{OWNER}','{revision}')->>'status';")=="open"

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
    create_event("a0000000-0000-4000-8000-000000000011", "1 day")
    a=start()
    send(a,"BEGIN;"+auth(OWNER)+"SELECT id FROM public.events WHERE id='a0000000-0000-4000-8000-000000000011' FOR UPDATE;")
    assert line(a)=="a0000000-0000-4000-8000-000000000011"
    sql(auth(MEMBER)+insert("a0000000-0000-4000-8000-000000000011",MEMBER),error="55P03")
    assert sql("SELECT count(*) FROM public.predictions WHERE event_id='a0000000-0000-4000-8000-000000000011';")=="0"
    send(a,"ROLLBACK;")
    finish(a)
    assert sql(auth(MEMBER)+insert("a0000000-0000-4000-8000-000000000011",MEMBER))=="a0000000-0000-4000-8000-000000000011"
    assert sql("SELECT count(*) FROM public.predictions WHERE event_id='a0000000-0000-4000-8000-000000000011';")=="1"
    print("PASS: event lock rejects conflicting save (55P03), rollback permits exact retry")

    # One accepted save holds a parent lock while the clock crosses deadline.
    # Another transaction started before the deadline cannot exploit now().
    create_event("a0000000-0000-4000-8000-000000000012", "8 seconds")
    a=start()
    send(a,"SELECT pg_backend_pid();")
    holder=int(line(a))
    send(a,"BEGIN;"+auth(MEMBER)+insert("a0000000-0000-4000-8000-000000000012",MEMBER))
    assert line(a)=="a0000000-0000-4000-8000-000000000012"
    late=start()
    send(late,"BEGIN;"+auth(OWNER)+"SELECT public.is_prediction_open('a0000000-0000-4000-8000-000000000012');")
    assert line(late)=="t"
    wait_deadline("a0000000-0000-4000-8000-000000000012")
    send(late,"SELECT public.is_prediction_open('a0000000-0000-4000-8000-000000000012') AND clock_timestamp()>=(SELECT prediction_deadline FROM public.events WHERE id='a0000000-0000-4000-8000-000000000012');")
    assert line(late)=="t","old transaction must reproduce legacy now() bypass"
    send(late,insert("a0000000-0000-4000-8000-000000000012",OWNER))
    finish(late,expected="ranking prediction closed or unauthorized")
    assert sql("SELECT count(*) FROM public.predictions WHERE event_id='a0000000-0000-4000-8000-000000000012';")=="0","uncommitted save unexpectedly visible"
    b=start()
    send(b,"SET application_name='ranking_v1_close_wait';SET statement_timeout='15s';"+auth(OWNER)+
         f"SELECT public.ranking_v1_api_close('{CLUB}','a0000000-0000-4000-8000-000000000012','{OWNER}')->>'status';")
    wait_blocked("ranking_v1_close_wait",holder,b)
    send(a,"COMMIT;")
    finish(a)
    assert finish(b)=="resultWait"
    assert sql(auth(OWNER)+"SELECT count(*) FROM public.predictions WHERE event_id='a0000000-0000-4000-8000-000000000012';")=="1"
    assert sql("SELECT count(*) FROM public.predictions WHERE event_id='a0000000-0000-4000-8000-000000000012' AND user_id='"+OWNER+"';")=="0"
    print("PASS: stale-transaction late save rejected, close waits for accepted save, post-deadline publication correct")

    # Actual production membership removal must serialize with a save.
    create_event("a0000000-0000-4000-8000-000000000013","1 day")
    a=start()
    send(a,"SELECT pg_backend_pid();")
    holder=int(line(a))
    send(a,"BEGIN;"+auth(MEMBER)+insert("a0000000-0000-4000-8000-000000000013",MEMBER))
    assert line(a)=="a0000000-0000-4000-8000-000000000013"
    b=start()
    send(b,"SET application_name='ranking_v1_remove_wait';SET statement_timeout='15s';"+auth(OWNER)+
         f"SELECT public.remove_club_member('{CLUB}','{MEMBER}')->>'removed';")
    wait_blocked("ranking_v1_remove_wait",holder,b)
    send(a,"COMMIT;")
    finish(a)
    assert finish(b)=="true"
    assert sql(auth(MEMBER)+"SELECT count(*) FROM public.predictions WHERE event_id='a0000000-0000-4000-8000-000000000013';")=="0"
    assert sql("SELECT count(*) FROM public.predictions WHERE event_id='a0000000-0000-4000-8000-000000000013';")=="1"
    sql(auth(MEMBER)+f"UPDATE public.predictions SET payload={PICK} WHERE event_id='a0000000-0000-4000-8000-000000000013';")
    assert sql("SELECT count(*) FROM ranking_v1_private.prediction_players WHERE event_id='a0000000-0000-4000-8000-000000000013';")=="1"
    # Restore synthetic membership for the other independent cases.
    sql(f"UPDATE public.league_members SET membership_status='active' WHERE league_id='{CLUB}' AND user_id='{MEMBER}';")
    print("PASS: removal waits for accepted save, old access revoked, historical binding retained")

    # Two same-ID create requests from independent sessions must create
    # exactly one draft and return one recovery. The deadline is frozen.
    create_id="a0000000-0000-4000-8000-000000000014"
    deadline=sql("SELECT (clock_timestamp()+interval '1 day')::text;")
    create=f"""SELECT public.ranking_v1_api_create_draft(
        '{CLUB}','{create_id}','{OWNER}','Concurrent Cup','baseball','{deadline}'::timestamptz,
        (SELECT rules FROM public.events WHERE id='expired'))->>'recovered';"""
    a=start()
    send(a,"SELECT pg_backend_pid();")
    holder=int(line(a))
    send(a,"BEGIN;"+auth(OWNER)+create)
    assert line(a)=="false"
    b=start()
    send(b,"SET application_name='ranking_v1_create_wait';SET statement_timeout='15s';"+auth(OWNER)+create)
    wait_blocked("ranking_v1_create_wait",holder,b)
    send(a,"COMMIT;")
    finish(a)
    assert finish(b)=="true"
    assert sql(f"SELECT count(*) FROM public.events WHERE id='{create_id}' AND status='draft';")=="1"
    assert sql("SELECT count(*) FROM ranking_v1_private.management_permits;")=="0"
    print("PASS: concurrent same-ID creates produce one draft and one exact recovery")

    # The draft edit owns the row until commit. A previously reviewed
    # revision may not open the changed draft after waiting for that edit.
    old_rev=sql(auth(OWNER)+f"SELECT public.ranking_v1_api_draft_review('{CLUB}','{create_id}','{OWNER}')->>'revision';")
    edit=f"""SELECT public.ranking_v1_api_edit_draft(
      '{CLUB}','{create_id}','{OWNER}','{old_rev}','Edited Cup','soccer','{deadline}'::timestamptz,
      (SELECT rules FROM public.events WHERE id='{create_id}'))->>'revision';"""
    open_old=f"SELECT public.ranking_v1_api_open('{CLUB}','{create_id}','{OWNER}','{old_rev}')->>'status';"
    a=start()
    send(a,"SELECT pg_backend_pid();")
    holder=int(line(a))
    send(a,"BEGIN;"+auth(OWNER)+edit)
    new_rev=line(a)
    assert len(new_rev)==32 and new_rev!=old_rev
    b=start()
    send(b,"SET application_name='ranking_v1_open_wait';SET statement_timeout='15s';"+auth(OWNER)+open_old)
    wait_blocked("ranking_v1_open_wait",holder,b)
    send(a,"COMMIT;")
    finish(a)
    finish(b,expected="ranking draft stale")
    assert sql(f"SELECT status FROM public.events WHERE id='{create_id}';")=="draft"
    assert sql(auth(OWNER)+f"SELECT public.ranking_v1_api_open('{CLUB}','{create_id}','{OWNER}','{new_rev}')->>'status';")=="open"
    sql(auth(OWNER)+edit,error="42501")
    assert sql(f"SELECT name||':'||sport_type FROM public.events WHERE id='{create_id}';")=="Edited Cup:soccer"
    assert sql("SELECT count(*) FROM ranking_v1_private.management_permits;")=="0"
    print("PASS: concurrent draft edit rejects stale open; reviewed open locks settings")

    # Two independent admin requests with the same reviewed inputs must
    # serialize on the event and return one creation plus one recovery.
    revision=sql(auth(OWNER)+"SELECT public.ranking_v1_review_revision('finalize-case');")
    assert len(revision)==32
    finalize=f"SELECT public.ranking_v1_finalize('finalize-case','{revision}',{PICK})->>'recovered';"
    a=start()
    send(a,"SELECT pg_backend_pid();")
    holder=int(line(a))
    send(a,"BEGIN;"+auth(OWNER)+finalize)
    assert line(a)=="false"
    assert sql("SELECT count(*) FROM public.scores WHERE event_id='finalize-case';")=="0"
    b=start()
    send(b,"SET application_name='ranking_v1_finalize_wait';SET statement_timeout='15s';"+auth(OWNER)+finalize)
    wait_blocked("ranking_v1_finalize_wait",holder,b)
    send(a,"COMMIT;")
    finish(a)
    assert finish(b)=="true"
    assert sql("SELECT count(*) FROM public.scores WHERE event_id='finalize-case';")=="2"
    assert sql("SELECT count(*) FROM public.results WHERE event_id='finalize-case';")=="1"
    assert sql("SELECT count(*) FROM ranking_v1_private.finalize_receipts WHERE event_id='finalize-case';")=="1"
    assert sql("SELECT count(*) FROM ranking_v1_private.finalize_permits;")=="0"
    assert sql("SELECT status FROM public.events WHERE id='finalize-case';")=="finalized"
    print("PASS: concurrent identical finalize requests produce exactly one result, two scores and one receipt")
finally:
    for p in PROCS:
        if p.poll() is None:
            p.kill()
            p.wait(timeout=5)
