# 結果更新と本番トリガーの統合検証
2026-11-16、基準5c5a9e8。PR #47の隔離fixture拡張。製品SQL・migration・本番データは変更しない。

## 取り込んだ定義
本番カタログをSELECTし、次の関数本体を改変せず tests/sql/result-downstream-scoring-fixture.sql に保存:
- sync_koshien_late_round_advancement
- recompute_koshien_current_scores
- koshien_arrival_points / koshien_team_current_stage / koshien_team_finish / koshien_phase3_points
trigger定義も確認し、後続試合更新はDEFERRABLE INITIALLY DEFERRED、得点再計算はBEFORE INSERT OR UPDATEを維持する。
既存fixtureのscoresはintegerだったため本番計算の小数を失わないnumericへ変更。依存表は必要な列だけを追加し、本番データはコピーしない。

## 検証ケース
既存のwriter/identity/承認状態/reopen/finalized gatesと共存させる。
- 一般参加者の結果保存を拒否し10表不変。
- 締切経過後の管理者によるR2保存から、commit時のR3作成・results内のカード同期までを確認。
- フェーズ1の実採点で到達点1.5 × multiplier2 × captain1.2 = 3.6。
- R2取消でR3の該当枠を空にし、クライアント指定999を実採点2.4に上書き。
- R3完了後は実採点4.8。R2取消はcommit時に実トリガーが拒否し、試合/結果/得点/監査/revision/permit等10表全体をrollback。
- 確定後の拒否で後続カードと実計算得点が維持されることを確認。
実行結果はIssue #42/PR #47を参照。

## 限界
これは全本番schemaの再現ではない。今回の新規組込みは後続更新1本と採点1本。外部import同期は既存fixtureの実定義を継続。
公式R1→R2、zombie自動準備、opened-later保護、completed-downstream保護、全RLS/制約/所属競合は未統合。
決勝30点関数は本番の定義をコピーしただけで条件を変更せず、今回の入力は決勝なし。正式ルールとの不一致を解決・承認したことにはしない。
次の1件: 残りのmatchesトリガーを同じ隔離fixtureへ組込み、遅延更新の全経路と整合性を検証。
本番migration/merge/deployなし。復旧はこのテスト追加のrevert。
