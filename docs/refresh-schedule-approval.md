# Koshien refreshの承認revision接続（隔離試作）

2026-11-18、本番catalogから `refresh_koshien_phase_schedule(text)` と呼出元を確認。
`get_koshien_later_phase_state` の表示処理はrefreshを呼び、期限でroundとdraftの状態を変更する。
SECURITY DEFINER・active league member権限・状態遷移4種類・元のEXECUTE ACLを維持。

認証確認後、eventを最初にFOR UPDATEし、待機後に所属とmemberを再認証。Koshienに限りrevisionを子行より先にロックする。
更新した行数を4件のUPDATEで集計し、変更があればrevisionを1回だけ進める。
**write_permitは発行しない。** 一般memberも利用できるRPCに結果テーブルの編集許可を発行すると権限を破る。
no-op時も初回revision行の初期化が起こり得るが、番号は増えない。認証、ロールバック、2接続event競合、更新番号、no-op、permit不変を使い捨てDBで検証する。
全本番制約/RLS/所属変更競合、上位get stateの完全な結合動作は未検証。

単独migration/本番適用禁止。本番DB/採点変更なし。復旧はcommit revert。
次は手動prepareと残りのphase writer、共有承認RPC/UI。
