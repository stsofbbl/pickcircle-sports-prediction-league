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

## 条件不足とrevision境界の追加検証
実際の遅延トリガーをSET CONSTRAINTS ALL IMMEDIATEで実行してから、
ドラフト未完・設定無効・QF不足・SF時刻なし・SFカードなし・SFに非勝者を含む6条件を検査。
各ケースでround/資格が作られず、元のwriterによるrevision増加は1回、rollbackで12表とドラフトが元へ戻ることを確認する。
不正SFは合成fixtureへの管理者INSERTで作成する。通常UIから作れると主張するテストではない。

内部prepareを特権fixtureから単独実行するとround/資格は作成されるが承認revisionは増えない。
これは内部関数本体にrevision更新がないことの再現であり、認証ユーザーからの迂回や本番脆弱性の認定ではない。
今回の自動経路は外側begin_result_writeのeventロック/revisionに依存する。
全公開呼出元・service経路・schedule RPCがその条件を満たすかは未確認。
次の1件: 内部prepareの本番ACLと呼出元をcatalogで列挙し、event先行ロック/revisionの不足経路を特定する。
製品SQL・得点・本番データ変更なし。追加テストと資料のみ。
