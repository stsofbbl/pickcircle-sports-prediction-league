# 実本番RLS 4表の隔離適用・権限検証（PR #47）
2026-11-19、Supabase catalog の `pg_policies` をSELECTし、events / matches / results / scores の実定義11件を `tests/sql/result-production-rls-policy-fixture.sql` へ転記。SQLは**隔離DBのトランザクション内で適用→ROLLBACKのみ**。本番migrationではない。
従来の結果保存fixtureはresultsの権限をadmin一条件に簡略化していたが、本番は`updated_by=auth.uid()`もINSERT/UPDATEのWITH CHECKで要求する。今回はこの漏れを埋める。
anonの閲覧は0件、他リーグownerは0件、同リーグactive memberは閲覧可能・更新不可、ownerは本人でないupdated_byによる更新不可、本人updated_byと正規result-write permitの更新は成功、最後に全体ROLLBACKと元policyの復元を比較。
対象のRLS式は本番のcatalog SELECTに基づくが、既存fixtureは合成スキーマ／権限helperであり、本番データ・全制約・全トリガーや接続APIは未再現。結果が成功してもPR #47全体の本番適用はできない。
次：本番CHECK/FK制約と実triggerの組合せ、共有承認RPCとUI。
