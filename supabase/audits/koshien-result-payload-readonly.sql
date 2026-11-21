-- READ ONLY: compare Koshien results.payload with public.matches.
-- Payload team_a_id/team_b_id/winner_id/loser_id are school NAMES, not UUIDs.
WITH payload AS (
 SELECT r.event_id,j.entry
 FROM public.results r JOIN public.events e ON e.id=r.event_id
 CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(r.payload->'matches') AS j(entry)
 WHERE e.preset_type='koshien'
), compared AS (
 SELECT p.event_id,p.entry,m.event_id AS match_event,
    t1.name AS team_a,t2.name AS team_b,tw.name AS winner,tl.name AS loser,
    m.team1_score,m.team2_score,m.status
 FROM payload p
 LEFT JOIN public.matches m ON m.event_id=p.event_id
   AND m.round_key=p.entry->>'round'
   AND to_jsonb(m.match_no)=p.entry->'match_no'
 LEFT JOIN public.teams t1 ON t1.id=m.team1_id
 LEFT JOIN public.teams t2 ON t2.id=m.team2_id
 LEFT JOIN public.teams tw ON tw.id=m.winner_team_id
 LEFT JOIN public.teams tl ON tl.id=m.loser_team_id
)
SELECT event_id,
 COUNT(*) AS entries,
 COUNT(DISTINCT pg_catalog.jsonb_build_array(entry->'round',entry->'match_no')) AS unique_slots,
 COUNT(*) FILTER(WHERE match_event IS NULL) AS missing_slots,
 COUNT(*) FILTER(WHERE entry->>'team_a_id' IS DISTINCT FROM team_a
    OR entry->>'team_b_id' IS DISTINCT FROM team_b) AS team_mismatches,
 COUNT(*) FILTER(WHERE entry->>'winner_id' IS DISTINCT FROM winner
    OR entry->>'loser_id' IS DISTINCT FROM loser) AS outcome_mismatches,
 COUNT(*) FILTER(WHERE entry->'score_a' IS DISTINCT FROM to_jsonb(team1_score)
    OR entry->'score_b' IS DISTINCT FROM to_jsonb(team2_score)) AS score_mismatches,
 COUNT(*) FILTER(WHERE entry->>'status' IS DISTINCT FROM status) AS status_mismatches
FROM compared GROUP BY event_id ORDER BY event_id;
