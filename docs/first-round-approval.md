# 1回戦公式組合せ登録の承認管理接続

2026-11-17、本番catalogのregister_koshien_official_first_round_matches定義とACLを読取確認。
SECURITY INVOKER、auth.uid必須、active league admin判定、17試合/34校の一意性・所属・開始ラウンド検証を保持。
event FOR UPDATEと管理者確認・入力検証の後、resultsのロック前に既存begin_result_writeを呼ぶ。管理者を再確認しrevision/permitを1回更新する。

## 再登録の意味
本番関数のidempotentは「INSERT件数0」の意味。再登録でもresultsをUPDATEする。
今回はこの動作を維持し、成功した再登録もrevisionを1回進める。no-opへ仕様変更しない。
失敗時は追加試合・結果JSON・revision/permitを同一transactionでrollbackする。

## 検証
既存CIの使い捨てDBで実RPCを実行。匿名、UIDなしservice、member、他league、inactive admin拒否。
17試合/34校条件、最後のスロット不整合による16件挿入後rollback、17カードとJSON整合、再登録の非重複・revision更新、異なる組合せ/完了試合拒否、予想締切後の管理者登録、2接続のeventロック待ち、確定後拒否を確認する。
実行結果はPR #47 / Issue #42に記録。全本番RLS/制約/所属変更競合は未再現。

## 適用と復旧
supabase/prototypes/koshien-first-round-write.sqlはmigrationではなく本番単独適用禁止。
本番データ・得点ルール変更なし。復旧は当該commitのrevert、隔離DBはCIで破棄。
残る試合登録2本、手動prepare/refresh、全RLS/所属競合/承認UIは未接続。
次の1件はregister_koshien_official_second_round_slotsのwriter境界接続。
