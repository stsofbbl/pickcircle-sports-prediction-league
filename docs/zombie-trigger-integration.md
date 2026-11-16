# ゾンビ自動準備の実処理統合
2026-11-17 JST / 基準ba22c24 / PR #47。製品変更ではなく隔離fixture追加。

本番catalog SELECTでauto_prepare_koshien_zombie_from_sf、
prepare_koshien_zombie_phase_internal、koshien_result_versionの定義を取得し、本体を変更せず保存。
内部prepareは読取りではなく、後続roundと参加資格の書込みを行う。呼出しは隔離DBだけ。
既存の遅延トリガーと同じDEFERRABLE INITIALLY DEFERREDを維持する。

合成大会にQF勝者4校、ドラフト完了、準決勝カード、全滅参加者/生存校保有参加者を準備。
実writer gateからSF開始時刻を更新し、commit時の実自動準備を検証する。
- 一般メンバーのwriter開始拒否、内部prepareの直接実行拒否。
- 内部prepareで開始=締切を拒否。自動triggerでは既に過ぎた締切でround/資格を作らない。
- 資格INSERT後の遅延失敗を注入し、schedule/round/資格/revision/permit等12表を全rollback。
- 将来締切でopen/automatic/automatic/version1、全滅者に候補4校、生存者に候補なし。
- 既存roundがある場合は再実行してもround/資格を上書きしない。
実行結果はIssue #42/PR #47。

これは完全な本番schemaやACLの再現ではない。fixture内の内部関数ACLは明示的に閉じているが、
本番role/default ACL/RLS/全制約の統合検証は別途必要。予想送信はしない。
旧koshien_result_versionは互換目的でコピーし、承認revisionの代わりには使わない。
30点条件/採点規則変更なし。本番migration/merge/deployなし。復旧はテスト追加のrevert。

次: 自動準備の不足条件（ドラフト未完/QF不足/設定無効/不整合SF）を同じ実処理で検証し、
試作の承認revisionが後続round/資格変更を追跡できる範囲を整理する。
