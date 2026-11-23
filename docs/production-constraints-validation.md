# 本番CHECK/FK制約の限定的な隔離再現

2026-11-19、Supabase `pg_constraint`をSELECTし、events/matches/results/scores/koshien_later_roundsの14件の実定義を `tests/sql/result-production-constraints-fixture.sql` に固定。既存fixtureは合成スキーマのため、制約を `NOT VALID` でトランザクション中だけ追加し、**新たな不正書込みの拒否**だけを検証してROLLBACKする。

events/matchesの不正statusは23514、存在しないチームIDは23503、正しい参照のscheduled試合は受理。最後に既存events/matches/results/scoresと承認内部表を比較して変更ゼロを確認する。

NOT VALIDのため既存合成データが本番全制約を満たす証明ではない。profiles/leagues FK、全トリガー、全RLSの同時実行や公開承認UIも未検証。本番migration/本番データ変更なし。PR #47 Draft維持。復旧は試作commit revert。
