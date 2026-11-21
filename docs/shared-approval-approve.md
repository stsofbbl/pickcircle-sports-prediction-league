# 共有結果承認の投票・確定RPC（隔離試作）
2026-11-19。共有提出データと既存の厳密な状態遷移許可`transition_permits`を再利用する`approve_koshien_shared_results(event_id,submission_id,expected_revision)`を追加。SECURITY DEFINER＋空search_path、authenticated限定。event→revision→submissionの順でロックし、所属本人・提出ID・revision・現在の承認対象集合とapprovalPolicyを再検証する。本人UIDで票を一意化し、再送では増加しない。
所属/方式変更時は旧提出をsupersededへ無効化して再提出を要求。必要票数に達したら提出時の試合・結果・得点監査snapshotと現DBを再比較し、一致時だけ本人/transaction/旧新状態/旧新flowが一致するpermitを発行。イベントとsubmissionを同一transactionでfinalizedにしてpermitを消費する。既存reopenがrevisionを進めた後は古い承認を再表示しない。
隔離DBの合成48試合と4有効会員で、匿名・他リーグ・対象外ユーザー拒否、所属変化、重複投票、4票での確定、permit消費、確定後再送、reopenを検証。
**未完**：所属の同時INSERT/DELETEの完全直列化、実サービス全経路/本番RLS・制約、得点検証、認証済み実UI、admin単票の自動確定仕様。PR #47はDraft維持、本番migration/merge/deployなし。