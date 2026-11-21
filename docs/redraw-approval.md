# QF/SF再抽選枠の承認writer接続（隔離試作）

2026-11-18、本番catalogの`register_koshien_official_redraw_slots`定義/ACLを読取確認し試作。
SECURITY DEFINER・空search_path・service_role専用を維持。R3→QF、QF→SFの勝者検証、4/2試合枠、参照URL、完了済みの変更拒否を保持。

既存event FOR UPDATEを先行取得し、revision→results→matchesの順にロックする。初回の実match更新または結果JSONだけの修復時、同じtransactionでrevisionを1回進めpermitを発行する。service専用RPCはUID不要なので、管理者用begin_result_writeを流用せず、既存service日程同期と同じ内部方式で接続する。UIDを偽装しない。

INSERTのBEFORE guardはON CONFLICT no-opでも起動するため、同一内容のmatch upsert自体を省略。再送でrevisionを増やさず、確定後の実書込みは既存guardが拒否する。

既存使い捨てPostgreSQL CIにサービスACL、入力検証、QF4試合/SF2試合、最後のJSON不整合後の12表rollback、結果JSONだけの修復、2接続event待機、再送no-op、異なる組合せ拒否、確定後拒否を追加。CI結果は検証後に記録。全本番RLS/制約/実サービス呼出し経路は未再現。

これはmigrationではない。本番DB/採点/デプロイは無変更。PR #47全体の準備前に単独適用しない。復旧はcommit revert。
次: 手動prepare/refresh、全RLS/ACL/制約/所属競合と共有承認RPC/UIを確認。
