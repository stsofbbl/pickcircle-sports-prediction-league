-- Record the already deployed #50 cron gate without embedding URL or credentials.
-- Both jobs must already exist with one of the reviewed command fingerprints.
-- On current production this migration is a validated no-op. On an older
-- environment it inserts the gate before the existing command's semicolon.
DO $gate$
DECLARE
  j record;
  v_gate constant text := ' WHERE EXISTS (SELECT 1 FROM public.events e WHERE e.preset_type = ''koshien'' AND e.archived_at IS NULL AND e.status IN (''open'', ''resultWait'')) /* yoso_cron_active_koshien_gate_v1 */';
  v_original_hash text;
  v_gated_hash text;
  v_command text;
BEGIN
  IF (SELECT count(*) FROM cron.job
      WHERE jobname IN ('yoso-koshien-auto-sync', 'yoso-koshien-bracket-sync')) <> 2 THEN
    RAISE EXCEPTION 'both reviewed Koshien cron jobs are required';
  END IF;

  -- Validate both jobs before changing either one.
  FOR j IN SELECT jobid, jobname, schedule, active, username, command
      FROM cron.job
      WHERE jobname IN ('yoso-koshien-auto-sync', 'yoso-koshien-bracket-sync')
      ORDER BY jobname
  LOOP
    IF j.jobname = 'yoso-koshien-auto-sync' THEN
      v_original_hash := '6b9eedee73509f1a34ad185c3dacc0a4';
      v_gated_hash := 'b9df7387cab892f60a0c0711b2ed8703';
    ELSE
      v_original_hash := 'aa4978c896a4efd23bc9220825757119';
      v_gated_hash := '0945ab570267b611c67b8ecda2fbc9a8';
    END IF;
    IF j.schedule <> '*/15 * * * *' OR NOT j.active OR j.username <> 'postgres'
        OR length(j.command) - length(replace(j.command, ';', '')) <> 1 THEN
      RAISE EXCEPTION 'Koshien cron job metadata differs from reviewed state: %', j.jobname;
    END IF;
    IF md5(j.command) = v_gated_hash THEN
      IF md5(replace(j.command, v_gate, '')) <> v_original_hash THEN
        RAISE EXCEPTION 'Koshien cron gate cannot be reversed exactly: %', j.jobname;
      END IF;
    ELSIF md5(j.command) <> v_original_hash THEN
      RAISE EXCEPTION 'Koshien cron command differs from reviewed state: %', j.jobname;
    END IF;
  END LOOP;

  FOR j IN SELECT jobid, jobname, schedule, command
      FROM cron.job
      WHERE jobname IN ('yoso-koshien-auto-sync', 'yoso-koshien-bracket-sync')
      ORDER BY jobname
  LOOP
    IF j.jobname = 'yoso-koshien-auto-sync' THEN
      v_original_hash := '6b9eedee73509f1a34ad185c3dacc0a4';
      v_gated_hash := 'b9df7387cab892f60a0c0711b2ed8703';
    ELSE
      v_original_hash := 'aa4978c896a4efd23bc9220825757119';
      v_gated_hash := '0945ab570267b611c67b8ecda2fbc9a8';
    END IF;
    IF md5(j.command) = v_original_hash THEN
      v_command := left(j.command, position(';' in j.command) - 1)
        || v_gate || substr(j.command, position(';' in j.command));
      PERFORM cron.schedule(j.jobname, j.schedule, v_command);
      IF NOT EXISTS (
        SELECT 1 FROM cron.job updated
        WHERE updated.jobname = j.jobname
          AND updated.jobid = j.jobid
          AND md5(updated.command) = v_gated_hash
          AND updated.active
      ) THEN
        RAISE EXCEPTION 'Koshien cron gate update did not preserve job: %', j.jobname;
      END IF;
    END IF;
  END LOOP;
END
$gate$;
