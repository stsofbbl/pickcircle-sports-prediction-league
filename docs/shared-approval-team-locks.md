# YOSO 2.0 — 共有承認と代表校更新の競合保護（試作・公開前レビュー用）

2026-11-21。**このSQLは本番migrationではない。本番適用・権限変更・デプロイは禁止（事前承認が必要）。**

## 実証した問題
本番の `public.teams` は RLS `teams_admin_all` により管理者のINSERT/UPDATE/DELETEを許し、既存の係数変更RPCは `events FOR UPDATE` → `teams UPDATE` の順でロックする。一方、共有承認の最終票は `events FOR UPDATE` 後に `teams` を検査していた。別端末から `teams` を直接書き換えると、提出時の監査スナップショットと確定直後の係数が食い違う可能性があった。

## 試作したロック順
- 提出と投票：既存の **league FOR KEY SHARE → 大会ID専用 advisory transaction lock → event FOR UPDATE → revision → submission → 監査情報比較**。最終確定も同じトランザクションのまま行う。
- teams / event_teams INSERT/UPDATE/DELETE：**行更新中の BEFORE ROW トリガー**が大会ID専用 advisory transaction lock を `pg_try_advisory_xact_lock` で試行。取得できない場合は SQLSTATE 55P03 で**即時失敗**させる。成功した場合も、共有提出がpendingまたは大会がfinalizedなら SQLSTATE 55000 で拒否。
- 同じイベントで既存RPCが先に event row をロックし、別接続の投票が advisory lock を持ちつつ event を待つ場合、既存RPC側の teams 更新は即時失敗する。**team行ロック中に承認待ちのロックを待たない**ため、既存の event→teams とのデッドロック循環を断つ。
- 代表校の編集が承認より先に完了した場合、提出・投票は advisory lock 解放後に**新しい係数・表示メタデータ**でスナップショットを検査する。**`teams` と `event_teams` の両方**を時刻列を除いて監査する。
- タイムスタンプだけの更新は採点結果に無関係として許容する。別大会へのteam移動では旧・新両イベントのロックをID順に試す。
- advisory lockはトランザクション終了時に自動解放される。失敗した変更はUIで再読込して再試行する想定。

## 隔離検証項目
1. pending中およびfinalized後、通常のteams / event_teams UPDATE/INSERT/DELETEは拒否。提出・失効前の更新は許可。タイムスタンプのみの更新は許可。
2. 係数更新を先に終えた提出は新しい係数を監査記録へ取り込む。旧提出を人為的に残した場合、投票時のスナップショット不一致で失効。
3. **2接続の逆順ロック競合**：Aがevent行を保持、Bが承認advisoryを取得してevent行を待つ→Aのteam更新は55P03で即時失敗→Bは待機解除後に正常に処理。
4. 会員・クラブ削除の競合、ポリシー変更、admin/half/unanimous、48試合、採点変更なし、完全ROLLBACKを既存の隔離CIで再確認。

## 権限の別途是正が必要
本番カタログ（READ ONLY）では、`teams`、`event_teams`、`events`、`matches`、`results`、`scores`、`players`、`leagues`、`league_members` で `anon`/ `authenticated` に **TRUNCATE** 権限が付与されている。PostgreSQLの TRUNCATE はRLSの対象外で、DELETE行トリガーも実行しない。これは本試作のチーム行ガードを回避しうる広いSQL権限である。

**公開前のレビュー案**（未実行・未承認）：

```sql
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
-- 必要なら、同一所有者の将来テーブルに対する default privileges も確認
```

ただし**Supabaseの通常のREST APIからTRUNCATEが直接実行できることは確認していない**。カタログ上の過剰権限を確認したものであり、外部からの実行可能性の断定ではない。ACL変更はサービスへの影響を調べてから別途明示的承認を得る。

## 未解決の公開ゲート
- `teams` / `event_teams`以外の採点・表示データの書込経路の精査、**TRUNCATE権限の是正**、外部SQLからの実行可能性の確認
- 本番と同一のRLS/FK/trigger/default、ロック競合・性能、2台以上の実ログイン端末のE2E
- 正式な**原子的migrationとデータを失わないrollback**。private提出・票・監査記録を無断でDROPしない
- Draft PR #47の独立レビュー。承認なしの本番DB更新、デプロイ、PRマージは禁止

参照：PostgreSQL 17 [Explicit Locking](https://www.postgresql.org/docs/17/explicit-locking.html)、[TRUNCATE](https://www.postgresql.org/docs/17/sql-truncate.html)、[RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)。
