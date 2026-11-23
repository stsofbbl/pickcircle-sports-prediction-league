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
- **結果payloadとの一致**：payloadの`team_a_id/team_b_id/winner_id/loser_id`はUUIDではなく**学校名**。試合の各UUIDから`teams.name`をJOINして48個のキー（round, match_no）の一意性、出場校・勝敗・点数・状態の整合を提出RPCで検証する。READ ONLYの`supabase/audits/koshien-result-payload-readonly.sql`は2026-11-21本番で48件すべて一致。追加メタデータや開始時刻の完全一致、公式抽選表の検証とは区別する。
- **公式勝者の送り先**：2回戦17件・3回戦16件・決勝2件の`matches.metadata`進出元参照を、指定された前の試合の勝者と照合する。3回戦・決勝では決定的な対戦枠番号も確認し、準々決勝・準決勝の公式再抽選は固定せず尊重する。本番READ ONLYの`supabase/audits/koshien-official-feeders-readonly.sql`で不一致0。隔離DBで参照先改ざん・欠損を拒否する。
- **トーナメント構造**：`submit_koshien_shared_results`に49校・各ラウンド規定数・学校重複なし・各勝者の次ラウンド進出を検証するprivate helperを接続。隔離DBの合成データも49校48試合に置き換え、重複・進出漏れを拒否する。READ ONLY大会構造監査`supabase/audits/koshien-bracket-topology-readonly.sql`は2026-11-21本番で`topology_passed=true`。**ただし公式の各試合組合せ・シード位置・results.payload整合性を完全検証するものではなく、これだけで本番公開判定しない。**
- 承認・取消操作が成功したが再取得だけ失敗する場合に、端末上の確定状態がDBと矛盾しないことを確認。
- 旧提出／票が有効なままイベントを「resultWait→open/archive/draft」に変更する直接UPDATE、**statusを変更せずarchived_atだけ書き換えるUPDATE**、Koshienイベントを確定済みで直接INSERTする経路を拒否。票が失効した後や確定後の通常アーカイブは維持し、承認によるresultWait→finalizedおよび取消も維持する。
- 全変更は差分のある関連テストのみを追加する。独立レビューと実認証複数端末E2EはCIとは別の完了条件。

## 導入後の安全ゲートと「無損失の一時停止」（2026-11-23追加）

- 導入前：`supabase/audits/shared-approval-release-preflight-readonly.sql`を**SELECTのみ**実行。2026-11-23の本番実測で**21項目すべてpassed=true**。既存6関数の定義ハッシュ（既存の確定取消RPC、イベント更新トリガー実装2件を含む）、既存イベントトリガー2件、必要9テーブル、4つの新設RPCの不在、private schemaの不在を確認。これは導入可否の一条件にすぎず、現行スキーマを凍結しない。
- 導入後：`supabase/audits/shared-approval-postinstall-readonly.sql`の**62項目の読み取り監査**を通す。公開4RPCの存在・`SECURITY DEFINER`・`authenticated`のみのEXECUTE権限、**内部4ヘルパーの存在・実行主体・anon/認証済みユーザーのEXECUTE境界**、既存結果保存RPC（invoker）に必要なprivate schemaの`USAGE`、private 5表のクライアントDML/`TRUNCATE`拒否、必要な4表のRLS、主要8トリガーの有効状態を検査する。構造・権限の静的ゲートであり、実認証E2Eや負荷の代わりにはならない。
- 一時停止（**本番適用SQLではない**）：4つの**新設**public共有承認RPCの`EXECUTE`を`authenticated`から取り消す案を使い捨てDBで検証する。`tests/sql/shared-approval-pause-resume.sql`は受付拒否と、既存private提出・票・監査snapshotの不変を確認し、元の4権限のみを再付与して再開できることを確認する。テストは全体を`BEGIN/ROLLBACK`で囲む。
- **一時停止は完全なロールバックではない。** 既存の結果保存/確定取消RPC、チーム編集、既存イベントの状態遷移は残る。停止中の新旧ルート混在とデータ不整合を防ぐには、UIの機能フラグ切替、既存RPCの権限・トリガー依存、操作中ユーザー、監査保存期間を別途審査する。旧版コードへ復元するための`CREATE OR REPLACE`実行順や権限復元は、導入前に本番定義の原本を保存してから設計する。
- 既存の`public.reopen_koshien_results`などは**`CREATE OR REPLACE FUNCTION`時に既存の関数権限を保持する**。どの権限を止めて何を復元するかは本番カタログ実測に基づく一覧で扱う。事故防止のため新規監査・隔離試験のSQLを、そのまま本番migrationとして貼り付けない。参考：[PostgreSQL 17 CREATE FUNCTION](https://www.postgresql.org/docs/17/sql-createfunction.html)。

## ロールバック設計で守ること
- **実運用後はprivate提出・票・監査記録を即時DROPしない。** データの破棄は別途明示的許可が必要。
- まずオンライン承認操作を停止し、該当公開RPCのEXECUTE権限を撤回／必要なら旧UIへ戻す。既存の参加・予想・得点・大会情報を保持する。
- 既存関数へ `CREATE OR REPLACE` したものは、取得して保存した**導入前の本番定義**を基に戻す。元のRLS・トリガー・権限と、DB migration履歴を突合する。新設したteams / event_teamsの行トリガーは公開RPCの停止後にのみ解除する。
- DB側に提出／投票の実データが存在する場合、migrationを物理的に逆転するだけでは監査記録が失われるため、保全・無効化・再公開方針を事前承認する。
- 切戻し試験が確実に済むまで、PR #47はDraftを維持し、本番適用しない。

## 未解決ゲート
本番相当の全DDL統合、ルール変更と得点計算の結合監査、負荷とロック影響、正式な適用・逆順切戻しSQL、認証済み実2端末以上のE2E、独立レビュー。さらに**公開テーブルのTRUNCATE強権限**（現在anon16/30、authenticated24/30）を見直す必要がある。SupabaseのData APIは直接TRUNCATEを提供しないためAPIからの実行可能性は未確認だが、SQL実行経路と将来のdefault ACLを分けて審査する。読み取り専用の一覧と未実行の是正案は`docs/public-truncate-privilege-preflight.md`。**GitHub Actions successのみでは本番公開可能と判定しない。**
