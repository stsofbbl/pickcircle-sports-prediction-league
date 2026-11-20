# 甲子園オンライン承認方式の保存（隔離試作 / 2026-11-20）

## 原因（実コード・本番catalog確認）
`saveKoshienSnapshot()` の新規イベントINSERTには `rules.approvalPolicy` があるが、既存イベントUPDATEは `name/status/prediction_deadline` のみ。設定画面の承認方式ボタンはローカル状態のみ変更していた。Supabase `events` の実RLSは会員SELECT・管理者UPDATEを許可するが、クライアントによる `rules` 全体のread-modify-writeは他端末の更新や承認状態を上書きし得るため採用しない。

## 今回の対応
- `set_koshien_shared_approval_policy(event_id,policy,expected_revision)` 試作RPCを追加。ポリシー列挙値検証、本人認証・現管理者の再チェック、リーグKEY SHARE→event UPDATEロック、revision CAS、同一値の冪等性、`rules.approvalPolicy` キーのみ更新。
- 変更時は未確定submissionをsupersededへ遷移してrevisionをインクリメント。これまでの投票は再利用されず、管理者による再提出が必要。finalizedは更新拒否（既存の取消手順を使用）。
- 承認状態読取RPCは、提出が存在しない場合も現在の `approval_policy` を返す。既存大会にポリシーが未設定ならUIで選択・保存を要求し、見かけ上の既定値「half」を保存済み扱いしない。
- 設定UIは管理者＋読取RPC成功時だけ編集可能。送信成功前にローカル確定せず、失敗時はエラーを表示しサーバー最新状態を優先。
- CIの使い捨てPostgreSQLで、匿名・一般会員拒否、不正値・古いrevision拒否、同一更新の冪等、既存rules保持、承認票無効化、試験全ROLLBACKを検証。

## 公開前ゲート
本番の共有承認RPC 4本とprivate schema/trigger/permit等は未導入。試作SQLを個別に適用しないこと。実RLS/FK/他イベント・採点・ジョブ統合、migration/rollback、実ログイン複数端末E2E、独立レビューを経てから本番適用を判断する。PR #47はDraft維持。
