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
3. private submissions / votes とread RPC、承認待ちの状態巻き戻し・確定済みINSERT拒否ガード、資格変更用のleague_members / playersトリガーを一括導入する。**teams・event_teamsの直接INSERT/UPDATE/DELETEも同じ大会単位のadvisory lockで保護し、提出時に監査記録へ含める。** ロック順は原則**league → team専用advisory → event → revision → submission**。team行トリガーは逆順ロック時に待たず即時失敗する。加入・退会・admin変更・アカウント削除・クラブ削除の組合せが対象。
4. submit / approve / set-policy RPCと、reopen・結果保存のversion/transition guardを接続する。実行時の権限をauthenticated本人に限定し、anon / 無関係リーグを拒否する。
5. 状態遷移・ルール・RLS・permissions・トリガー・関数定義が想定どおりであることを確認する。**公開機能をDBだけ・UIだけ先行有効化しない。**

※ 上記は依存関係の概略であり、正式な適用順序・ロールバックSQLはまだ設計審査中。現在の `supabase/prototypes/` は再実行可能性や全本番DDL互換性を保証したmigrationではない。

## 必須の隔離検証
- 本番から取得した最新のRLS/CHECK/FK/default/trigger/function定義を採用した**使い捨てDB**で初期導入と既存データの読込・更新を行い、非対象大会と既存score計算の差分がないことを確認。
- 2接続でsubmit / vote / policy更新 / reopen / 結果編集、**teams / event_teamsの直接更新と確定、削除時のFK CASCADE**、加入/退会/role変更/プレイヤー作成、アカウント・クラブ削除の競合順序と、deadlock / stale revision / 完全ROLLBACKを確認。
- 48試合の勝敗整合、対象者ごとのscores、admin/half/unanimousの必要票数、冪等再送、承認後の旧票・再提出の扱いを確認。
- **READ ONLY大会構造監査** `supabase/audits/koshien-bracket-topology-readonly.sql`で49校/48試合、R1=17/R2=16/R3=8/QF=4/SF=2/F=1、同一ラウンド重複、勝者進出漏れ、別大会の学校ID、全試合完了を確認。2026-11-21本番読み取り監査では対象大会の`topology_passed=true`。**ただし公式の各試合組合せ・シード位置を完全検証するものではなく、これだけで本番公開判定しない。**
- 承認・取消操作が成功したが再取得だけ失敗する場合に、端末上の確定状態がDBと矛盾しないことを確認。
- 旧提出／票が有効なままイベントを「resultWait→open/archive/draft」に変更する直接UPDATE、**statusを変更せずarchived_atだけ書き換えるUPDATE**、Koshienイベントを確定済みで直接INSERTする経路を拒否。票が失効した後や確定後の通常アーカイブは維持し、承認によるresultWait→finalizedおよび取消も維持する。
- 全変更は差分のある関連テストのみを追加する。独立レビューと実認証複数端末E2EはCIとは別の完了条件。

## ロールバック設計で守ること
- **実運用後はprivate提出・票・監査記録を即時DROPしない。** データの破棄は別途明示的許可が必要。
- まずオンライン承認操作を停止し、該当公開RPCのEXECUTE権限を撤回／必要なら旧UIへ戻す。既存の参加・予想・得点・大会情報を保持する。
- 既存関数へ `CREATE OR REPLACE` したものは、取得して保存した**導入前の本番定義**を基に戻す。元のRLS・トリガー・権限と、DB migration履歴を突合する。新設したteams / event_teamsの行トリガーは公開RPCの停止後にのみ解除する。
- DB側に提出／投票の実データが存在する場合、migrationを物理的に逆転するだけでは監査記録が失われるため、保全・無効化・再公開方針を事前承認する。
- 切戻し試験が確実に済むまで、PR #47はDraftを維持し、本番適用しない。

## 未解決ゲート
本番相当の全DDL統合、ルール変更と得点計算の結合監査、負荷とロック影響、正式な適用・逆順切戻しSQL、認証済み実2端末以上のE2E、独立レビュー。さらに**公開テーブルのTRUNCATE強権限**（現在anon16/30、authenticated24/30）を見直す必要がある。SupabaseのData APIは直接TRUNCATEを提供しないためAPIからの実行可能性は未確認だが、SQL実行経路と将来のdefault ACLを分けて審査する。読み取り専用の一覧と未実行の是正案は`docs/public-truncate-privilege-preflight.md`。**GitHub Actions successのみでは本番公開可能と判定しない。**
