-- READ ONLY: stored official feeder references must point to actual
-- upstream winners. R2 17 R1 feeders; R3 16 R2 feeders; F 2 SF feeders.
-- QF/SF use official redraws and are deliberately excluded.
WITH expected(round_key,prior_round,expected_refs) AS (
 VALUES ('R2','R1',17),('R3','R2',16),('F','SF',2)
), games AS (
 SELECT m.* FROM public.matches m
 JOIN public.events e ON e.id=m.event_id WHERE e.preset_type='koshien'
), feed AS (
 SELECT m.event_id,m.round_key,m.match_no,1 AS side,m.team1_id AS team_id,
   m.metadata->>'team1_source_round_key' AS source_round,
   m.metadata->>'team1_source_match_no' AS source_no
 FROM games m WHERE m.round_key IN ('R2','R3','F')
 AND (m.metadata ? 'team1_source_round_key'
   OR m.metadata ? 'team1_source_match_no')
 UNION ALL
 SELECT m.event_id,m.round_key,m.match_no,2,m.team2_id,
   m.metadata->>'team2_source_round_key',
   m.metadata->>'team2_source_match_no'
 FROM games m WHERE m.round_key IN ('R2','R3','F')
 AND (m.metadata ? 'team2_source_round_key'
   OR m.metadata ? 'team2_source_match_no')
)
SELECT e.round_key,e.expected_refs,COUNT(f.round_key) AS actual_refs,
 COUNT(*) FILTER(WHERE f.round_key IS NOT NULL AND (
   f.source_round IS DISTINCT FROM e.prior_round
   OR f.source_no !~ '^[0-9]{1,3}$'
   OR prior.winner_team_id IS DISTINCT FROM f.team_id
   OR (e.round_key IN ('R3','F') AND f.source_no IS DISTINCT FROM
     (2*f.match_no-CASE WHEN f.side=1 THEN 1 ELSE 0 END)::text)
 )) AS mismatched_refs
FROM expected e LEFT JOIN feed f ON f.round_key=e.round_key
LEFT JOIN games prior ON prior.event_id=f.event_id
 AND prior.round_key=f.source_round
 AND prior.match_no=CASE WHEN f.source_no ~ '^[0-9]{1,3}$'
  THEN f.source_no::integer ELSE NULL END
GROUP BY e.round_key,e.expected_refs
ORDER BY CASE e.round_key WHEN 'R2' THEN 1 WHEN 'R3' THEN 2 ELSE 3 END;
