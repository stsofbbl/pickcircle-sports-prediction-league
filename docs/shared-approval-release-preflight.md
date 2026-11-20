# YOSO 2.0 共有結果承認 — 本番統合・公開前チェック（設計案）

更新：2026-11-21。**この文書は実行用migrationではない。** SQLファイルの結合・本番適用・deployは未承認。

## 確認済みの本番基準（読み取り専用）
- Supabase project `gubsrwaxpifhvwommpos`、PostgreSQL **17.6**。既存 `events/leagues/league_members/players/koshien_result_reopens` の存在、実FK/CHECK・RLS・更新トリガーを確認。
- `yoso_approval_private` schemaおよび共有読取・提出・本人投票・承認方式変更RPCは**未導入**。既存公開アプリは現行のまま。
- 既存 `events.rules` は `jsonb`。管理者更新RLSあり。DBの承認方式変更は必ず専用revision付きRPCへ収束させ、他のAPIによる直接更新をトリガーで拒否する。
- 公開用ブランチ `codex/vercel-release-candidate` へのpush・PR #47のマージは未実施。

## 原子的な導入に必要な依存関係（実施前に独立レビュー）
1. イベント・結果保存の既存RPCとRLS/FKをバックアップ／比較する。**既存の得点・会員権限の振る舞いを維持**する。
2. private revisions、event identity/approval-state guard、single-use transition permits、結果書込みpermit/確定保護を準備する。後続SQLが既存関数を `CREATE OR REPLACE` する場合、実本番定義との差分を事前確認する。
3. private submissions / votes とread RPC、資格変更用のleague_members / playersトリガーを一括導入する。ロック順は**league → event → revision → submission**。加入・退会・admin変更・アカウント削除・クラブ削除の組合せが対象。
4. submit / approve / set-policy RPCと、reopen・結果保存のversion/transition guardを接続する。実行時の権限をauthenticated本人に限定し、anon / 無関係リーグを拒否する。
5. 状態遷移・ルール・RLS・permissions・トリガー・関数定義が想定どおりであることを確認する。**公開機能をDBだけ・UIだけ先行有効化しない。**

※ 上記は依存関係の概略であり、正式な適用順序・ロールバックSQLはまだ設計審査中。現在の `supabase/prototypes/` は再実行可能性や全本番DDL互換性を保証したmigrationではない。

## 必須の隔離検証
- 本番から取得した最新のRLS/CHECK/FK/default/trigger/function定義を採用した**使い捨てDB**で初期導入と既存データの読込・更新を行い、非対象大会と既存score計算の差分がないことを確認。
- 2接続でsubmit / vote / policy更新 / reopen / 結果編集、加入/退会/role変更/プレイヤー作成、アカウント・クラブ削除の競合順序と、deadlock / stale revision / 完全ROLLBACKを確認。
- 48試合の勝敗整合、対象者ごとのscores、admin/half/unanimousの必要票数、冪等再送、承認後の旧票・再提出の扱いを確認。
- 承認・取消操作が成功したが再取得だけ失敗する場合に、端末上の確定状態がDBと矛盾しないことを確認。
- 全変更は差分のある関連テストのみを追加する。独立レビューと実認証複数端末E2EはCIとは別の完了条件。

## ロールバック設計で守ること
- **実運用後はprivate提出・票・監査記録を即時DROPしない。** データの破棄は別途明示的許可が必要。
- まずオンライン承認操作を停止し、該当公開RPCのEXECUTE権限を撤回／必要なら旧UIへ戻す。既存の参加・予想・得点・大会情報を保持する。
- 既存関数へ `CREATE OR REPLACE` したものは、取得して保存した**導入前の本番定義**を基に戻す。元のRLS・トリガー・権限と、DB migration履歴を突合する。
- DB側に提出／投票の実データが存在する場合、migrationを物理的に逆転するだけでは監査記録が失われるため、保全・無効化・再公開方針を事前承認する。
- 切戻し試験が確実に済むまで、PR #47はDraftを維持し、本番適用しない。

## 未解決ゲート
本番相当の全DDL統合、ルール変更と得点計算の結合監査、負荷とロック影響、正式な適用・逆順切戻しSQL、認証済み実2端末以上のE2E、独立レビュー。**GitHub Actions successのみでは本番公開可能と判定しない。**
