# YOSO 2.0 — publicテーブルのTRUNCATE権限・安全な是正計画

更新：2026-11-21。**本番への権限変更、migration、公開は未承認・未実施。** この文書と隔離テストは変更許可を意味しない。

## 読み取り専用の本番監査（実測）
- PostgreSQL 17.6／公開テーブル（通常・partitioned）30件。**anon:16件、authenticated:24件、service_role:30件**で`TRUNCATE`実行権限を持つ（`has_table_privilege`で検証）。対象30件のownerはすべて`postgres`、anon/authenticatedの該当付与は`relacl`に存在する**直接GRANT**であり、GRANT OPTIONは0件。以前の「9テーブル」は代表例であり全件数ではない。
- `teams`・`event_teams`・`events`・`results`・`scores`はanon/authenticatedの双方が該当。
- `postgres`と`supabase_admin`の**両方**で、`public`に将来作成するテーブルへ`anon/authenticated/service_role`の`TRUNCATE`を付与するデフォルトACLがある。
- 公開関数本体を検索した範囲ではTRUNCATEを使用する関数はなかった（見落としのない網羅的監査、外部接続経路の排除を保証するものではない）。
- Supabase公式文書では、**Data APIがTRUNCATE権限を直接使うわけではない**。認証トークンだけで通常のRESTから任意のテーブルをTRUNCATEできるという検証結果ではない。一方、SQLを`anon/authenticated`権限で実行できる関数/別経路がある場合、PostgreSQLは`TRUNCATE`にRLSを適用せず、行DELETEトリガーも発火させない。権限を残す必要があるかは独立に審査する。

公式資料：
- [Supabase — Securing your API](https://supabase.com/docs/guides/api/securing-your-api)
- [PostgreSQL 17 — Row Security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- [PostgreSQL 17 — TRUNCATE](https://www.postgresql.org/docs/17/sql-truncate.html)
- [PostgreSQL 17 — ALTER DEFAULT PRIVILEGES](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html)
- [Supabase — supabase_adminのデフォルト権限変更制約](https://supabase.com/kb/troubleshooting/cant-change-the-default-privileges-of-supabase_admin-in-the-public-schema-448af9)（公式記事の正確なURL/適用範囲は本番前に再確認）

## 実施前のゲート
1. **READ ONLY**：`supabase/audits/public-truncate-acl-readonly.sql`で全テーブル名・owner/role別の対象権限を抽出し、差分記録を残す。切戻し候補は`has_table_privilege`の実効権限で機械生成せず、`aclexplode(relacl)`の**直接付与情報のみ**から作成する。アプリの実API/Edge/cron/DB関数がTRUNCATEを必要とするかレビュー。
2. **隔離実証**：`tests/sql/public-truncate-privileges.sql`で、RLS下でもTRUNCATEが許可されること、REVOKE後は拒否されること、SELECT/DELETEが維持されること、作成者別のデフォルト権限は将来テーブルに別途反映されることを確認する。
3. **既存テーブル**：必要な承認・レビュー・バックアップと対象ownerの実施権限を確保した後、下記候補を**本番トランザクションとして別途承認**する。対象はpublicだけで、`service_role`の付与権限はこの候補では変更しない。
4. **将来テーブル**：`postgres`のdefault ACLは対象作成者として変更できるか別途検証する。**`supabase_admin`のdefault ACLは通常`postgres`から直接変更できない**制約があるため、無理にSET ROLEで書き換えない。将来テーブルが作成された際の明示REVOKE運用、Supabaseプラットフォーム設定・サポート手順を検討する。
5. **復旧**：事前に抽出した実際の付与先・テーブル一覧に従って`GRANT TRUNCATE`を選択的に戻す。全テーブルに無条件にGRANTしない。権限以外のユーザーデータ、監査票、得点やRLSは一切変更しない。権限変更後、必要なアプリAPI/実端末動作と権限一覧を再確認する。

### 未実行の権限是正候補（適用SQLではなくレビュー用）
```sql
-- 必ず事前にREAD ONLY監査とオーナー確認を行い、適用許可を得る
BEGIN;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
-- CREATEされた新規テーブルのdefault ACLはこの文では変わらない
-- 管理側が承認したSELECTによる権限検証後にのみCOMMITすること
ROLLBACK; -- ドキュメント例は意図的にROLLBACK。実行用migrationではない
```

`ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE TRUNCATE ON TABLES FROM anon, authenticated`は別審査項目。将来の作成者が`supabase_admin`の場合はこの行で解決できない。

## 適用を止める条件
- SQLの権限実行主体・テーブル所有者が確認できない
- CI・隔離DBで変更対象とアプリ/DB関数の動作が裏付けられない
- 本番に実利用されるTRUNCATE依存処理があり、代替がない
- バックアップ・安全な切戻し・独立レビュー・ユーザー許可がない

**完了の定義：** userロールが不要なTRUNCATE権限を保持しないことを確認し、許可された範囲の実運用で重大な機能劣化がなく、今後の新規テーブルでも自動付与を検出・是正できる状態。現段階は未達。
