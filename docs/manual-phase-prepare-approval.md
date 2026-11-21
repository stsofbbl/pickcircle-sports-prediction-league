# 手動Zombie準備と共通prepare入口のevent先行ロック（隔離試作）

2026-11-19、本番の `prepare_koshien_zombie_phase` と `prepare_koshien_later_phase` の定義・ACLを読み取り、直接管理者RPCと共通入口を試作。
現行のactive admin認証、SECURITY DEFINER、空search_path、準備条件、return形式を維持。両方でeventを最初に FOR UPDATE して再認可し、子round/資格の書込みより先にrevisionを取得。
直接Zombie準備は成功後にrevisionを1回進める。共通入口ではnested RPC側でrevisionが進んだら追加で進めず、best16/phase3など未接続の内側関数から戻った場合のみ1回進める。一般メンバー向けresult-write permitは発行しない。

隔離DBの本番由来内部prepareにより、管理者権限拒否・不正期限・round/資格作成・重複拒否・rollback・2接続でのevent待機/二重登録拒否を検証。大きなget state JSONは隔離側の最小スタブが本物のrefreshを呼ぶ形で、全ての読取り項目を再現していない。
**未完**: direct best16/phase3のevent先行・revision、予想保存やstatus変更からのget state経路、所属変更同時競合、全本番RLS/制約。別入口からの子ロック先行が残る間は本番適用禁止。

Migrationではない。本番書込み/得点/公開変更なし。復旧はcommit revert。次は直接best16/phase3とstatus/update/prediction RPCのevent先行ロック。
