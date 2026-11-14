-- Design regression, not a migration. Run ONLY in the disposable CI database.
-- Captured public.koshien_result_version definition on 2026-11-15.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.matches (
  id integer PRIMARY KEY, event_id text NOT NULL, status text NOT NULL,
  team1_score integer, updated_at timestamptz NOT NULL
);
CREATE OR REPLACE FUNCTION public.koshien_result_version(p_event_id text)
RETURNS bigint LANGUAGE sql STABLE SET search_path TO ''
AS $function$
  select coalesce(sum(extract(epoch from m.updated_at)::bigint), 0)
  from public.matches m
  where m.event_id = p_event_id and m.status = 'completed';
$function$;

CREATE FUNCTION pg_temp.check_case(ok boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF;
  RAISE NOTICE 'PASS: %', label;
END;
$$;

INSERT INTO public.matches VALUES
 (1, 'target', 'completed', 3, '2026-01-01 00:00:00.100+00'),
 (2, 'target', 'completed', 5, '2026-01-01 00:00:02.100+00'),
 (3, 'other', 'completed', 8, '2026-01-01 00:00:04+00');
DO $$
DECLARE original bigint; before_empty bigint;
BEGIN
  original := public.koshien_result_version('target');
  PERFORM pg_temp.check_case(original > 0, 'completed rows produce a version');
  UPDATE public.matches SET team1_score = 4, updated_at = '2026-01-01 00:00:00.200+00' WHERE id=1;
  PERFORM pg_temp.check_case(public.koshien_result_version('target') = original,
    'different score and subsecond timestamp collide');
  -- Aggregate has no association with row identity.
  UPDATE public.matches SET updated_at = CASE id
    WHEN 1 THEN '2026-01-01 00:00:02.100+00'::timestamptz
    ELSE '2026-01-01 00:00:00.100+00'::timestamptz END WHERE event_id='target';
  PERFORM pg_temp.check_case(public.koshien_result_version('target') = original,
    'swapped per-match timestamps collide');
  UPDATE public.matches SET team1_score = 10 WHERE id=3;
  PERFORM pg_temp.check_case(public.koshien_result_version('target') = original,
    'other events do not affect the version');
  INSERT INTO public.matches VALUES (4,'target','scheduled',NULL,'2026-01-01 00:00:06+00');
  PERFORM pg_temp.check_case(public.koshien_result_version('target') = original,
    'adding an incomplete match is invisible to the version');
  before_empty := public.koshien_result_version('empty');
  INSERT INTO public.matches VALUES (5,'empty','scheduled',NULL,'2026-01-01 00:00:06+00');
  PERFORM pg_temp.check_case(public.koshien_result_version('empty') = before_empty,
    'empty and incomplete schedules both produce zero');
  -- now() is fixed for a transaction, as used by save_koshien_result_snapshot.
  UPDATE public.matches SET team1_score=11, updated_at=now() WHERE id=1;
  original := public.koshien_result_version('target');
  UPDATE public.matches SET team1_score=12, updated_at=now() WHERE id=1;
  PERFORM pg_temp.check_case(public.koshien_result_version('target') = original,
    'two result saves in one transaction collide');
END;
$$;
ROLLBACK;
