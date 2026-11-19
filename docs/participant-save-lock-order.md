# 参加者予想保存3RPCのevent先行ロック（隔離試作）

2026-11-19に本番catalogから `save_koshien_zombie_prediction`、`save_koshien_revenge_pick`、`save_koshien_phase3_prediction` を読み取った。
各RPCは従来round FOR UPDATEと参加者予想保存を行った後、`get_koshien_later_phase_state`→`refresh_koshien_phase_schedule`へ入る。後者はPR #47試作でevent先行ロックになったため、従来の子行→event順は競合原因になる。

結果の確定権限や予想仕様は変更せず、auth.uidが存在する場合に既存eventに属するプレイヤーだけがevent FOR UPDATEをroundロックより前に取得できるよう試作。元のround.version比較、受付時間、IDリプレイ、team選択資格、score有効性、更新先、ACLを維持。
**予想データは承認中の試合結果ではないのでapproval revisionを増加させず、結果書込みpermitも発行しない。** 後続refreshが実際にラウンドを移行する場合はその処理自身でrevisionを更新する。

既存CIの使い捨てDBに本番RPCの関数本体・最小依存表をロードして、匿名/他リーグ拒否、3予想の保存とリプレイ、request_id衝突、round version不一致、2接続の実イベント待機、result permit/revision不変を検証。大きなget-state返却・本番全RLS/制約/所属同時変更はfixture上の制限があり、単独本番適用不可。復旧はcommit revert。
次は直接best16準備のロック順、残りの間接呼出元と実本番RLS/権限/競合。
