# 本番会員RPC実定義の使い捨てDB互換検証（2026-11-20）

本番Supabase `pg_get_functiondef` をREAD ONLYで確認し、`review_club_join_request` / `remove_club_member` / `manage_league_admin` / `is_league_owner` / `archive_deleted_account` / `prevent_owner_account_deletion` の6関数を**原文のまま** `supabase/prototypes/koshien-real-membership-rpcs.sql` に固定。公開先のDBには適用しない。

既存PR #47使い捨てPostgreSQLに最低限の `league_join_requests` / `league_admin_audit` / `profiles` / `auth.users` をトランザクション内に作成し、実関数で加入承認・ロール昇格/降格・削除・アカウント退会の権限、本人識別、履歴、プロフィール匿名化を検証。常に `ROLLBACK`、元イベント・結果・scores・承認テーブルのsnapshot一致とRPCが残らないことを確認する。

主要な未検証事項：2接続で実関数を同時呼出した際のデッドロック・待機/再試行、複数リーグの一括退会、実本番全RLS/FK/ACL、負荷。トリガーは会員・プレイヤーの承認資格が変わるDMLにだけ限定。PR #47 Draft、本番migration/merge/deployなし。

2026-11-20 追加：実RPCを隔離DBへトランザクション外ロードし、shared approval voteとの本物の2接続競合を検証。会員削除RPC、加入承認RPC＋players登録、管理者ロール変更RPC、auth.users退会AFTER DELETEトリガーを別セッションで実行する。いずれも投票のリーグ行ロックが保持されている間はDMLが待機し、コミット後に進む。対象者集合が変わる削除・加入・退会では旧提出を無効化し、単なる権限昇格では対象者集合が変わらず承認を維持する。private・audit・イベント・membership・playersの全後片付けと原状比較を実施。デッドロックの未発生はテストした組合せに限る。

2026-11-20修正：加入承認RPCの実装はmembership追加だけで、players追加は本人の操作。隔離fixtureに本番`players_insert_self_member`相当のINSERT RLSを組み込み、管理者の代理INSERTを42501で拒否。承認後は本人の別セッションでplayersをINSERTする競合を検証する。加入直後でプレイヤー未作成の時点では、投票資格人数を増やさない。
