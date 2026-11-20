# YOSO 2.0 — 提出後の得点設定と承認票の整合性（隔離試作）

調査：2026-11-21。本番DBは読み取りのみ。**この試作単独のデプロイは禁止。**

## 本番定義からの確認事項
- `events.rules` と `events.rules_config` は別々のjsonb列。後者には大会のフェーズ・得点設定が保存され得る。UIの甲子園得点設定は `rules.config` から復元され、`stagePoints`・`phase2Points`・`captainMultiplier` などを持つ。
- `teams` には `start_round`・`odds`・`sqrt_odds`・`game_multiplier`・`metadata` 等がある。いずれも競技結果や採点結果に関わり得る。
- 本番RLSでは認証済みクラブ管理者が`events` と `teams` を更新できる。以前の共有承認試作は提出時`matches/results/scores`のみをprivate snapshotへ入れ、未変更のscoresだけで提出時の得点設定まで同一とは証明できなかった。

## 今回の保護
1. `protect_shared_approval_event_status` を `events` のすべてのUPDATEに適用する。**未確定の共有提出がある場合と大会がfinalizedの場合**、`rules`（`approvalPolicy`・`resultFlow`を除く）、`rules_config`、`current_phase`、`prediction_deadline`、`sport_type`、`season` の変更を拒否する。結果提出前・superseded後の編集、無関係な大会名修正、正規のポリシー変更／承認確定／確定取消は維持する。
2. `submit_koshien_shared_results` のprivate audit snapshotに `event_context` と `teams` を含める。`event_context` は上記の得点・フェーズ関連情報を保全するが、正規の状態遷移で変わる`resultFlow`とrevision付きRPCが扱う`approvalPolicy`は分離する。`teams` は意味のない`updated_at/created_at`の差だけでは失効させない。
3. `approve_koshien_shared_results` は**各票を記録する前**にsnapshotの設定・代表校係数と現時点の情報を比較し、変化を確認した場合は提出を`superseded`にして旧票を無効化する。最終票に到達する場合も同じ監査情報を再比較する。
4. PostgreSQL使い捨てDBでpending/finalizedの設定更新拒否、非採点の大会名変更許可、旧票失効後の再編集、提出時の設定・係数記録、係数変化後のstale判定・旧票非再利用、既存承認と再開を検証する。ロール・監査テーブルの本番権限変更はしない。
5. クライアントが`submission_status='stale'` / `requires_resubmission=true`を受けたら**成功通知にしない**。採点設定・代表校・結果・参加者の変更を案内し、管理者による再提出を要求する。既存の成功応答の通知は維持し、専用Nodeテストで区別する。

## 残る制約（重要）
- `teams` の書込みそのものは今回ロック・禁止していない。承認時に係数変更を検知するが、**別トランザクションでの係数更新と最終確定との競合**、確定後の係数書込み、`event_teams` 等の関連表は引き続き監査対象。誤って「全ての採点変更経路が安全」と判断しない。
  本番catalogの追加確認：`public.teams`のユーザー定義トリガーは現時点で0件。`teams_admin_all` RLSは管理者であることを条件とするが、確定済みの編集拒否条件を含まない。一方、`confirm_koshien_start_rounds`、`update_koshien_odds`、`update_koshien_game_multipliers`等の既存RPCはイベント行を先にロックして`teams`を更新する。team行を先にロックした直接DMLトリガーへ後付けでeventロックを追加すると**逆順ロックのデッドロック**を生み得るため、この段階では導入しない。
- 監査記録の `teams` は時刻列を除いた行全体を記録するため、後から更新する機能との両立とロックの順序を本番同等環境で再検証する。
- 本番適用前に一致したFK/default/RLS/各RPC/triggerと結合し、2接続race、実端末E2E、適用と無損失ロールバック、独立レビューが必要。PR #47はDraftのまま。
