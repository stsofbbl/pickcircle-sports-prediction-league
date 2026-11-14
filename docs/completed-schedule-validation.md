# 完了済み試合の日程取得を抑止

2026-11-14 / 基準 ca53dc38e1266b75fc2ab71e4a7841218f042485。

## 確認した事実
- 本番の甲子園は48試合すべてcompleted（R1 17/R2 16/R3 8/QF 4/SF 2/F 1）、event.statusはresultWait。
- app.jsのresultFlowPanel/resultFlowMessageには管理者の提出と参加者承認による確定フローがある。全試合終了だけを根拠にevent.statusを自動変更しない。
- 本番automation_stateのlast_schedule_attempt_atは2026-08-14、last_result_attempt_atは2026-08-22。現在も外部サイト取得が繰り返されているとは認定していない。
- scheduleDecisionは完了済みR1/R2でも当日の朝確認を要求し、日時欠落ならmissing_scheduleを要求する。隔離Nodeテストで前者のdue:trueを再現。

## 修正
R1/R2の対象行が1件以上あり、全行completedの場合、schedule_completedで日程取得を抑止する。
後続ラウンドの結果取得、結果確定・採点・認証・DB状態は変更しない。
未完了へ戻した試合がある場合は通常判定へ戻り、既存の30分再試行制限/夜間停止を保つ。

## 検証と復旧
対象Nodeテスト9件成功、JS構文確認成功。修正前は追加回帰テスト1件失敗を確認。
CIと本番反映状況はPR本文を最新記録とする。
Supabase Edge Functionの更新はVercelのmerge/deployとは別。更新前に実配備ソースとの差分を確認する。
復旧はこの4行の判定追加を戻した既存配備ソースを再deployする。データmigrationはない。
