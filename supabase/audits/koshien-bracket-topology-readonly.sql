-- READ ONLY: Koshien bracket topology preflight. No user data is updated.
-- This is an audit, not yet an enforcement gate in the shared submission RPC.
WITH koshien_events AS (
  SELECT id FROM public.events WHERE preset_type='koshien'
),
round_slots(round_key,required_matches,next_round) AS (
  VALUES ('R1',17,'R2'),('R2',16,'R3'),('R3',8,'QF'),
         ('QF',4,'SF'),('SF',2,'F'),('F',1,NULL::text)
),
games AS (
  SELECT m.* FROM public.matches m JOIN koshien_events e ON e.id=m.event_id
),
appearances AS (
  SELECT event_id,round_key,team1_id AS team_id FROM games WHERE team1_id IS NOT NULL
  UNION ALL
  SELECT event_id,round_key,team2_id AS team_id FROM games WHERE team2_id IS NOT NULL
),
metrics AS (
  SELECT e.id AS event_id,
    (SELECT COUNT(*) FROM games m WHERE m.event_id=e.id) AS match_count,
    (SELECT COUNT(*) FROM games m WHERE m.event_id=e.id AND m.status='completed') AS completed_count,
    (SELECT COUNT(*) FROM games m WHERE m.event_id=e.id AND (
      m.status='completed'
      AND m.team1_id IS NOT NULL AND m.team2_id IS NOT NULL
      AND m.team1_id<>m.team2_id
      AND m.team1_score>=0 AND m.team2_score>=0 AND m.team1_score<>m.team2_score
      AND m.winner_team_id=(CASE WHEN m.team1_score>m.team2_score THEN m.team1_id ELSE m.team2_id END)
      AND m.loser_team_id=(CASE WHEN m.team1_score>m.team2_score THEN m.team2_id ELSE m.team1_id END)
    ) IS NOT TRUE) AS invalid_completed_rows,
    (SELECT COUNT(*) FROM round_slots r WHERE
       (SELECT COUNT(*) FROM games m WHERE m.event_id=e.id AND m.round_key=r.round_key)
       <>r.required_matches) AS wrong_round_counts,
    (SELECT COUNT(*) FROM (
      SELECT a.round_key,a.team_id FROM appearances a WHERE a.event_id=e.id
      GROUP BY a.round_key,a.team_id HAVING COUNT(*)>1
    ) repeats) AS repeated_team_rounds,
    (SELECT COUNT(*) FROM games m LEFT JOIN public.teams t1 ON t1.id=m.team1_id
      LEFT JOIN public.teams t2 ON t2.id=m.team2_id
      WHERE m.event_id=e.id AND (
        (m.team1_id IS NOT NULL AND t1.event_id IS DISTINCT FROM e.id) OR
        (m.team2_id IS NOT NULL AND t2.event_id IS DISTINCT FROM e.id)
      )) AS foreign_event_matches,
    (SELECT COUNT(*) FROM games m JOIN round_slots r ON r.round_key=m.round_key
      WHERE m.event_id=e.id AND r.next_round IS NOT NULL
      AND (m.winner_team_id IS NULL OR
        (SELECT COUNT(*) FROM appearances a
         WHERE a.event_id=e.id AND a.round_key=r.next_round
         AND a.team_id=m.winner_team_id)<>1)
    ) AS missing_or_duplicate_advances,
    (SELECT COUNT(DISTINCT a.team_id) FROM appearances a
     WHERE a.event_id=e.id AND a.round_key IN ('R1','R2')) AS unique_entrants,
    (SELECT COUNT(*) FROM public.teams t WHERE t.event_id=e.id) AS registered_teams,
    (SELECT COUNT(*) FROM public.teams t WHERE t.event_id=e.id
       AND t.start_round IS DISTINCT FROM CASE WHEN EXISTS (
         SELECT 1 FROM appearances a WHERE a.event_id=e.id
           AND a.round_key='R1' AND a.team_id=t.id
       ) THEN 1 ELSE 2 END
    ) AS start_round_mismatches
  FROM koshien_events e
)
SELECT metrics.*,
  (match_count=48 AND completed_count=48 AND invalid_completed_rows=0
    AND wrong_round_counts=0 AND repeated_team_rounds=0
    AND foreign_event_matches=0 AND missing_or_duplicate_advances=0
    AND unique_entrants=49 AND registered_teams=49
    AND start_round_mismatches=0) AS topology_passed
FROM metrics ORDER BY event_id;
