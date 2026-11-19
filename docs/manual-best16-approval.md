# 直接ベスト16準備のevent先行ロック（隔離試作）

2026-11-19、本番catalogの `prepare_koshien_best16_phases` の関数定義とACLを読取確認。SECURITY DEFINER、管理者認証、16校/4人の提出者・各8校、順位snapshot、リベンジ資格の生成ロジックは変更しない。
event FOR UPDATEを認可より前に取るのではなく認可判定時に同時取得し、子行の読取・登録より先に承認revisionをロックする。成功した準備で1回advance、結果書込みpermitは発行しない。上位 `prepare_koshien_later_phase` は子関数によるversion増加を検知して二重更新しない。

隔離DBにR3の16校と4人×8校の選択を構成し、本番関数をそのまま実行して認証拒否、不正時刻、R3欠員、成功後のdraft/round/資格、ロールバック、再実行拒否、上位manual入口との整合を検証。
出場校・順位・資格の本番ロジック自体は変更なし。全本番制約/RLSと所属変更同時競合、上位state全フィールド返却は未検証。本番未適用・PR #47全体を単独公開しない。試作復旧はcommit revert。
