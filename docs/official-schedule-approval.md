# R1/R2公式日程同期の承認管理接続

2026-11-17、本番catalogの `auto_sync_koshien_official_schedule` 定義とACLを読取確認。
service_role限定実行、33行必須（R1=17/R2=16）、入力検証、完了試合の既知時刻維持、取得時刻の既存動作を保持した。

試作はeventロック後、resultsロック前にapproval revisionを取得し、最初の実書込みでrevisionとwriter permitを1回更新する。
結果JSONのみ変わる場合も更新対象。同一入力・同一取得時刻はno-op。取得時刻省略時のclock_timestamp動作は変更しない。
変更は `supabase/prototypes/koshien-official-schedule-write.sql`。migrationではなく、本番適用禁止。

## 隔離検証
既存の使い捨てPostgreSQL上で実RPCを実行する。
- anon/authenticated拒否、32行/重複行拒否
- 最後の結果JSONスロット欠落による途中更新のrollback（12テーブル比較）
- 33試合・JSON整合とrevision1回更新、再送no-op、取得時刻のみ変更
- 完了試合の時刻保持、未完了試合の過去時刻反映とrollback
- 2接続の実ロック待ち、先行rollback後の後続更新
- 確定後の試合更新・JSON更新拒否、完全no-op許可

完了試合の検証fixtureは時刻分岐を切り出した合成カードであり、全本番制約・チーム構成の再現ではない。
結果はPR #47 / Issue #42に記録。実行前に成功扱いしない。

## 残課題と復旧
試合登録3本、手動prepare/refresh、全RLS/所属競合/公開承認UIなどが未接続。
本番変更なし。復旧はこの試作commitのrevert、隔離DBはCI終了で破棄。
次の1件: `register_koshien_official_first_round_matches` の認証・eventロック・revision/permit接続。
