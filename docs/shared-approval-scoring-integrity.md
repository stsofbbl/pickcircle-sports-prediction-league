# YOSO 2.0 — 提出後の得点設定と承認票の整合性（隔離試作）

調査：2026-11-21。本番DBは読み取りのみ。**この試作単独のデプロイは禁止。**

## 本番定義からの確認事項
- `events.rules` と `events.rules_config` は別々のjsonb列。後者には大会のフェーズ・得点設定が保存され得る。UIの甲子園得点設定は `rules.config` から復元され、`stagePoints`・`phase2Points`・`captainMultiplier` などを持つ。
- `teams` には `start_round`・`odds`・`sqrt_odds`・`game_multiplier`・`metadata` 等がある。いずれも競技結果や採点結果に関わり得る。
- 本番RLSでは認証済みクラブ管理者が`events` と `teams` を更新できる。以前の共有承認試作は提出時`matches/results/scores`のみをprivate snapshotへ入れ、未変更のscoresだけで提出時の得点設定まで同一とは証明できなかった。

## 今回の保護
1. `protect_shared_approval_event_status` を `events` のすべてのUPDATEに適用する。**未確定の共有提出がある場合と大会がfinalizedの場合**、`rules`（`approvalPolicy`・`resultFlow`を除く）、`rules_config`、`current_phase`、`prediction_deadline`、`sport_type`、`season` の変更を拒否する。結果提出前・superseded後の編集、無関係な大会名修正、正規のポリシー変更／承認確定／確定取消は維持する。
2. `submit_koshien_shared_results` のprivate audit snapshotに `event_context`・`teams`・`event_teams` を含める。`event_context` は上記の得点・フェーズ関連情報を保全するが、正規の状態遷移で変わる`resultFlow`とrevision付きRPCが扱う`approvalPolicy`は分離する。`teams` は意味のない`updated_at/created_at`の差だけでは失効させない。
3. `approve_koshien_shared_results` は**各票を記録する前**にsnapshotの設定・代表校係数・画面用メタデータと現時点の情報を比較し、変化を確認した場合は提出を`superseded`にして旧票を無効化する。最終票に到達する場合も同じ監査情報を再比較する。
4. PostgreSQL使い捨てDBでpending/finalizedの設定更新拒否、非採点の大会名変更許可、旧票失効後の再編集、提出時の設定・係数記録、係数変化後のstale判定・旧票非再利用、既存承認と再開を検証する。ロール・監査テーブルの本番権限変更はしない。
5. クライアントが`submission_status='stale'` / `requires_resubmission=true`を受けたら**成功通知にしない**。採点設定・代表校・結果・参加者の変更を案内し、管理者による再提出を要求する。既存の成功応答の通知は維持し、専用Nodeテストで区別する。

## 代表校の直接更新も含む追加保護（開発試作）

- `public.teams` と `public.event_teams` の行変更に共通の大会ID専用advisory transaction lockを導入。submit/vote RPCがイベント行をロックする**前**に取得し、DML行トリガーはロック取得を待たずに失敗させる。既存の`event FOR UPDATE → teams UPDATE`とのデッドロック循環を断つ。
- 提出時に両テーブルの意味のある列を保存し、承認前に比較する。pending/finalized中の直接INSERT/UPDATE/DELETEは拒否し、提出前・失効後の変更を許可する。
- 2026-11-21の使い捨てPostgreSQL 2接続競合では`teams`更新と承認の逆順ロックケースを再現し、更新側が即時失敗して承認側が完了することを確認した。`event_teams`も同じトリガー・ロックキーを利用する。

## 残る制約（重要）

- 本番にはまだ一切適用していない。本番catalogでは両テーブルにユーザー定義トリガーがなく、RLSは管理者の直接編集を許している。
- 本番の`anon`と`authenticated`には、`teams`・`event_teams`を含む複数の公開テーブルへの**TRUNCATE**権限が付与されている。TRUNCATEはRLSおよび行DELETEトリガーの対象外であり、権限の是正が本番公開前のゲートとなる。通常REST経由の実行可能性は未確認。
- 未調査の関連テーブルや既存RPC経路、性能/デッドロックの網羅的検証、本番同等のFK/default/RLS、実端末E2E、原子的migrationと無損失rollback、独立レビューが残る。PR #47はDraftのまま。

詳しいロック順と権限是正案は`docs/shared-approval-team-locks.md`に記載。

## 追加：大会をまたぐ学校IDの誤登録を拒否（開発試作）
- 本番の`matches.team1_id`/`team2_id`の外部キーは`teams(id)`を参照するが、学校行の`event_id`と試合の`event_id`を複合FKで照合していない。異なる大会の学校IDが入っていても、**FKだけでは防げない**。
- `submit_koshien_shared_results`は48試合の完了・得点・勝敗チェックに加えて、両出場校が**提出対象と同じ大会**に所属することを必須にする。対象外のイベントに対する書込み条件は変更しない。
- 隔離テストでは、別大会の実在する学校IDを`R1`の1試合に混入させ、winner/loserと得点を矛盾なく設定したうえで提出拒否を確認する。修正前なら既存のカード検証を通過してしまうケースを対象とする。
- 本番48試合について読み取り専用の所属集計では、**大会をまたぐ学校参照は0件**。本番データの変更は行っていない。
- 注意：この確認だけでは49代表の網羅・組合せの一意性・全ラウンドの勝者進出関係までは証明しない。それらは別の公開前検証項目。

## 追加：49校・全ラウンドの勝者進出を必須化（開発試作）
- `yoso_approval_private.koshien_bracket_topology_valid`を追加し、共有承認の提出RPCから呼び出す。**49校登録・R1/R2初出場校の重複なし（計49校）・48試合の各ラウンド規定数・同一ラウンドの学校重複なし・各勝者が次ラウンドに1回進出・各校の`start_round`（1回戦出場/2回戦から登場）の一致**の全条件を確認する。既存の48試合の完了・スコア・勝敗整合検査は保持。
- 使い捨てDBの提出・本人投票テスト用データを、2校を繰り返す不正なものから**49校・48試合の進出が成立する組合せ**へ変更。あわせて、同一ラウンドの学校重複とR1勝者をR2から外す改ざんをそれぞれ拒否し、ROLLBACK後に正当な提出が成功することを検証する。
- 本番READ ONLY監査の`supabase/audits/koshien-bracket-topology-readonly.sql`では`topology_passed=true`（49校、48試合、重複・進出漏れ・異なる大会ID参照は0）。このSQLは本番変更・本番RPC導入ではない。
- **残る範囲外**：公式抽選表で指定された各試合の送り先・対戦ペアの完全一致、`results.payload`と構造化matchesの完全一致、得点計算式の正式な照合。それらは独立して確認する。

- 本番のREAD ONLY実測では`start_round=1`が34校で全校R1出場、`start_round=2`が15校で全校R1非出場。変更した試作の検証式・読み取り監査の両方に反映。隔離DBでは係数だけ誤って2回戦開始にした学校を提出拒否し、ロールバック後に正常判定へ戻ることを確認する。

## 追加：保存結果payloadと試合レコードの一致を検証（開発試作）
- 本番READ ONLY調査では`results.payload.matches[*].team_a_id/team_b_id/winner_id/loser_id`には**学校名**が保存されており、`matches.team1_id/team2_id/winner_team_id/loser_team_id`には`teams.id`のUUIDが格納されている。UUIDどうしで比較するのは誤り。試合テーブルから学校名をJOINして照合する。
- 48件の`(round, match_no)`を重複なく一意に突合し、両出場校・勝者・敗者・両校得点・statusが一致することを結果提出の条件に追加。**不正な型や欠損値はSQLキャストで落とさず不一致として拒否**。合致しない場合はSQLSTATE `55000`。
- 隔離DBでも保存結果を実際の学校名と点数で生成し、得点改ざん、勝者名改ざん、同一試合スロット重複のいずれも提出拒否、ROLLBACK後の正当提出/承認が可能かを検証。
- **対象外**：追加メタデータや試合開始時刻、公式の組合せ表との一致など。本番READ ONLY監査用に`supabase/audits/koshien-result-payload-readonly.sql`を追加。

## 追加：公式進出元メタデータとの照合（開発試作）
- 本番の試合登録/勝者進出トリガーは、`matches.metadata.team1_source_round_key`・`team1_source_match_no`、同様のteam2側の値を利用して勝者を次の対戦枠へ転記する。2回戦の1回戦勝者17件、3回戦の2回戦勝者16件、決勝の準決勝勝者2件を照合する。**QFとSFは公式再抽選なので固定の送り先を推測・強制しない。**
- 共有結果提出のトーナメント検証は、参照数17/16/2、参照先ラウンド、参照先の勝者UUIDと実際の出場校UUIDの一致、3回戦・決勝の決定的な送り先番号まで照合する。メタデータを丸ごと削除して確認を回避することも拒否する。
- 本番READ ONLY監査では35件の進出元参照がすべて一致（不整合0）。隔離DBの49校合成組合せにもメタデータを整備し、間違った参照先と欠損を提出拒否する回帰テストを追加する。
- 読み取り監査SQL：`supabase/audits/koshien-official-feeders-readonly.sql`。これは本番の資料を確認するだけで、DB変更や公式試合表との外部照合はしていない。

## 追加：中間承認票の監査スナップショット検証
- 以前の試作では、各票の前には採点設定・代表校メタデータだけを比較し、`matches/results/scores`の完全一致は定足数に達する最終票の直前に限っていた。中間票でも古い提出を承認してしまう余地があった。
- 新試作は**各票を記録する前に** `matches/results/scores/event_context/teams/event_teams` の監査snapshot全体を比較する。不一致なら提出を`superseded`にし、`stale`と`requires_resubmission=true`を返す。最終票の再照合は残す。
- 使い捨てDBで旧式・外部更新によるpayload改ざんを模擬し、2票目が追加されず提出が失効することを確認する。意図的なROLLBACK後は正常な提出・本人投票へ復帰する。
- 本番RPCは未変更。公開前に48試合・実際の参加者数で応答時間を確認する必要がある。

## 追加：表示用49校と採点用49校の一対一照合
- `js/data-service.js`は画面用の`event_teams`と得点計算用の`teams`を、`representative_key`または学校名で対応付けて読み込む。提出RPCの49校検証は従来`teams`のみだったため、表示用データの欠落や重複があっても結果確定に進める余地があった。
- 提出前に表示用49行・学校名49種類・seed49種類・対応した採点用学校ID49種類を**単一結合で確認**し、欠落・曖昧な複数対応・重複をSQLSTATE `55000`で拒否する。代表校キーの対応と名前一致の両経路を扱う。
- 本番READ ONLYの実測では結合49件・表示用49件・学校名49種類・seed49種類・対応学校ID49種類で未対応0件。
- 隔離テストでは表示用学校を1件削除、または存在しない学校名に変更した場合に提出を拒否し、ROLLBACK後の正常提出を維持する。**本番DBおよび得点式は変更しない**。
