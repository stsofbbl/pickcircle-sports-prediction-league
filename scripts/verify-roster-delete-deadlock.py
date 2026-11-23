#!/usr/bin/env python3
"""Reproduce production membership RPC versus delete_club lock ordering in disposable PG."""
import pathlib
import selectors
import subprocess
import sys
import time

if sys.argv[1:] != ["yoso_roster_delete_test"]:
    raise SystemExit("Only disposable yoso_roster_delete_test is allowed")
root = pathlib.Path(__file__).resolve().parents[1]
psql = ["sudo", "-u", "postgres", "psql", "-X", "-qAt",
        "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=verbose", "-d", sys.argv[1]]
owner = "00000000-0000-0000-0000-000000000001"
member = "00000000-0000-0000-0000-000000000002"
league = "00000000-0000-0000-0000-000000000010"
auth = "SET request.jwt.claim.sub='" + owner + "';SET ROLE authenticated;"

def sql(query):
    result = subprocess.run(psql, input=query, text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr
    return result.stdout.strip()

def send(proc, query):
    proc.stdin.write(query + "\n")
    proc.stdin.flush()

def line(proc):
    with selectors.DefaultSelector() as sel:
        sel.register(proc.stdout, selectors.EVENT_READ)
        assert sel.select(timeout=10), "session did not return a result"
    value = proc.stdout.readline().strip()
    assert value, "session ended before lock was acquired"
    return value

setup = """
CREATE SCHEMA auth;
CREATE SCHEMA yoso_approval_private;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
CREATE TABLE public.leagues(id uuid PRIMARY KEY,name text,created_by uuid);
CREATE TABLE public.league_members(
 league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
 user_id uuid NOT NULL,role text NOT NULL,membership_status text NOT NULL,
 joined_at timestamptz DEFAULT now());
CREATE TABLE public.players(
 id uuid PRIMARY KEY,league_id uuid NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
 profile_id uuid,display_name text,is_admin boolean DEFAULT false,
 updated_at timestamptz DEFAULT now());
CREATE FUNCTION public.is_league_admin(p_league_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.league_members lm
 WHERE lm.league_id=p_league_id AND lm.user_id=auth.uid()
 AND lm.membership_status='active' AND lm.role IN ('owner','co_owner'))
$$;
CREATE FUNCTION public.is_league_member(p_league_id uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.league_members lm
 WHERE lm.league_id=p_league_id AND lm.user_id=auth.uid()
 AND lm.membership_status='active')
$$;
GRANT USAGE ON SCHEMA public,auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
"""
files = ["supabase/prototypes/koshien-real-membership-rpcs.sql",
         "supabase/prototypes/koshien-real-delete-club.sql",
         "supabase/prototypes/koshien-shared-approval-roster-lock.sql"]
sql(setup + "\n".join((root / f).read_text() for f in files) + """
ALTER TABLE public.league_join_requests ADD CONSTRAINT ci_request_league_fk
 FOREIGN KEY(league_id) REFERENCES public.leagues(id) ON DELETE CASCADE;
INSERT INTO public.leagues(id,name,created_by) VALUES
 ('00000000-0000-0000-0000-000000000010','Delete race',
  '00000000-0000-0000-0000-000000000001');
INSERT INTO public.league_members(league_id,user_id,role,membership_status) VALUES
 ('00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001','owner','active'),
 ('00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000002','member','active');
INSERT INTO public.players(id,league_id,profile_id,display_name) VALUES
 ('80000000-0000-4000-8000-000000000002',
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000002','Member');
INSERT INTO public.league_join_requests(id,league_id,requester_id) VALUES
 ('49000000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000010',
  '59000000-0000-4000-8000-000000000001');
""")
def race(label, child_lock, mutation):
    a = b = None
    try:
        a = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, bufsize=1)
        send(a, "SELECT pg_backend_pid();")
        a_pid = int(line(a))
        send(a, "BEGIN;SELECT 1 " + child_lock + ";")
        assert line(a) == "1"
        b = subprocess.Popen(psql, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True, bufsize=1)
        send(b, "SELECT pg_backend_pid();")
        b_pid = int(line(b))
        send(b, "BEGIN;SELECT 1 FROM public.leagues WHERE id='" + league + "' FOR UPDATE;")
        assert line(b) == "1"
        send(a, auth + mutation)
        deadline = time.monotonic() + 8
        while sql("SELECT " + str(b_pid) + "=ANY(pg_blocking_pids(" + str(a_pid) + "));") != "t":
            assert a.poll() is None, a.stderr.read()
            assert time.monotonic() < deadline, "membership RPC did not wait on league"
            time.sleep(0.05)
        send(b, auth + "SELECT public.delete_club('" + league + "','Delete race');")
        a.stdin.close()
        b.stdin.close()
        a.wait(timeout=12)
        b.wait(timeout=12)
        a_out, a_err = a.stdout.read(), a.stderr.read()
        b_out, b_err = b.stdout.read(), b.stderr.read()
        errors = a_err + b_err
        assert "40P01" in errors, (label, a_out, a_err, b_out, b_err)
        assert (a.returncode == 0) != (b.returncode == 0), (label, a_err, b_err)
        assert sql("SELECT count(*) FROM public.leagues WHERE id='" + league + "';") == "1"
        print("PASS: real " + label + " versus delete_club reproduces 40P01 and rolls back")
    finally:
        for proc in (a,b):
            if proc and proc.poll() is None:
                proc.kill()
                proc.wait()

race("manage_league_admin",
     "FROM public.league_members WHERE league_id='" + league +
     "' AND user_id='" + member + "' FOR UPDATE",
     "SELECT public.manage_league_admin('" + league + "','" + member + "',true);")
race("remove_club_member",
     "FROM public.league_members WHERE league_id='" + league +
     "' AND user_id='" + member + "' FOR UPDATE",
     "SELECT public.remove_club_member('" + league + "','" + member + "');")
race("review_club_join_request",
     "FROM public.league_join_requests WHERE id=" +
     "'49000000-0000-4000-8000-000000000001' FOR UPDATE",
     "SELECT count(*) FROM public.review_club_join_request(" +
     "'49000000-0000-4000-8000-000000000001',true);")
