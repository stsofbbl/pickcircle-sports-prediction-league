"""Exercise the cron gate migration against a disposable PostgreSQL mock."""
import hashlib
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
migration = (ROOT / "supabase/migrations/20261124060000_record_koshien_cron_active_gate.sql").read_text()
match = re.search(r"v_gate constant text := '((?:''|[^'])*)';", migration)
assert match, "gate literal missing"
gate = match.group(1).replace("''", "'")
originals = {
    "yoso-koshien-auto-sync": "SELECT net.http_post('auto');",
    "yoso-koshien-bracket-sync": "SELECT net.http_post('bracket');",
}
hashes = {
    "6b9eedee73509f1a34ad185c3dacc0a4": hashlib.md5(originals["yoso-koshien-auto-sync"].encode()).hexdigest(),
    "b9df7387cab892f60a0c0711b2ed8703": hashlib.md5(originals["yoso-koshien-auto-sync"].replace(";", gate + ";").encode()).hexdigest(),
    "aa4978c896a4efd23bc9220825757119": hashlib.md5(originals["yoso-koshien-bracket-sync"].encode()).hexdigest(),
    "0945ab570267b611c67b8ecda2fbc9a8": hashlib.md5(originals["yoso-koshien-bracket-sync"].replace(";", gate + ";").encode()).hexdigest(),
}
for old, new in hashes.items():
    assert migration.count(old) == 2, old
    migration = migration.replace(old, new)

db = "yoso_cron_gate_disposable"
def command(*args, input_text=None):
    return subprocess.run(args, input=input_text, text=True, check=True, capture_output=True).stdout

command("sudo", "-u", "postgres", "createdb", db)
try:
    fixture = """
CREATE SCHEMA cron;
CREATE SCHEMA net;
CREATE TABLE cron.job (
  jobid bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  jobname text UNIQUE NOT NULL,
  schedule text NOT NULL,
  active boolean NOT NULL,
  username text NOT NULL,
  command text NOT NULL
);
CREATE FUNCTION cron.schedule(p_name text, p_schedule text, p_command text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO cron.job(jobname,schedule,active,username,command)
  VALUES(p_name,p_schedule,true,'postgres',p_command)
  ON CONFLICT(jobname) DO UPDATE
    SET schedule=excluded.schedule, command=excluded.command
  RETURNING jobid INTO v_id;
  RETURN v_id;
END $$;
CREATE TABLE public.events(preset_type text, status text, archived_at timestamptz);
CREATE TABLE public.http_queue(label text);
CREATE FUNCTION net.http_post(p_label text) RETURNS integer LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.http_queue VALUES(p_label);
  RETURN 1;
END $$;
INSERT INTO cron.job(jobname,schedule,active,username,command) VALUES
  ('yoso-koshien-auto-sync','*/15 * * * *',true,'postgres',
   'SELECT net.http_post(''auto'');'),
  ('yoso-koshien-bracket-sync','*/15 * * * *',true,'postgres',
   'SELECT net.http_post(''bracket'');');
"""
    command("sudo", "-u", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", db, input_text=fixture)
    for _ in range(2):
        command("sudo", "-u", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", db, input_text=migration)
    checks = """
DO $checks$
DECLARE j record; v_count integer; row record;
BEGIN
  IF (SELECT count(*) FROM cron.job) <> 2
     OR (SELECT count(DISTINCT jobid) FROM cron.job) <> 2
     OR (SELECT count(*) FROM cron.job
         WHERE command LIKE '%yoso_cron_active_koshien_gate_v1%') <> 2 THEN
    RAISE EXCEPTION 'gate did not preserve both jobs idempotently';
  END IF;
  FOR row IN SELECT * FROM (VALUES
    (NULL::text,NULL::text,false,0),
    ('koshien','open',false,2),
    ('koshien','resultWait',false,2),
    ('koshien','finalized',false,0),
    ('koshien','archive',false,0),
    ('koshien','open',true,0),
    ('worldCup','open',false,0)
  ) scenarios(preset_type,status,archived,expected) LOOP
    DELETE FROM public.events;
    IF row.preset_type IS NOT NULL THEN
      INSERT INTO public.events VALUES
        (row.preset_type,row.status,
         CASE WHEN row.archived THEN now() ELSE NULL END);
    END IF;
    TRUNCATE public.http_queue;
    FOR j IN SELECT command FROM cron.job LOOP
      EXECUTE j.command;
    END LOOP;
    SELECT count(*) INTO v_count FROM public.http_queue;
    IF v_count <> row.expected THEN
      RAISE EXCEPTION 'wrong HTTP count for %/%/%: %',
        row.preset_type,row.status,row.archived,v_count;
    END IF;
  END LOOP;
END $checks$;
"""
    command("sudo", "-u", "postgres", "psql", "-X", "-v", "ON_ERROR_STOP=1", "-d", db, input_text=checks)
    print("PASS: migration idempotency and seven isolated cron scenarios")
finally:
    command("sudo", "-u", "postgres", "dropdb", "--if-exists", db)
