# 後半日程同期の承認revision接続（隔離試作）

対象: `auto_sync_koshien_late_schedule(text,jsonb,text,timestamptz)`。
2026-11-17、本番catalogの関数定義を読み取り、既存のevent→results→matchesロック順序と日程検証を保持した。

- eventをロックした後、resultsより先にapproval revisionをロック。
- 最初の実書込み直前にrevisionを1回進め、同一transaction/actorのwriter permitを発行。
- 試合更新が0でも結果JSONの取得時刻が変わる場合は実書込みとして扱う。従来の日程同期の意味を変えない。
- 同一入力・同一取得時刻の再実行はrevision/permitを変更しない。未作成revisionの初期化は既存helperの仕様。
- SECURITY DEFINER・空search_path・service_role限定ACLを保持。UIDを偽装しない。
- 既存finalized guardにより試合と結果JSONの両経路を拒否。完全no-opは許容。

## 検証
既存の使い捨てPostgreSQL CIで、実RPC、実zombie遅延トリガー、実eligibility生成を接続。
anon/authenticated拒否、2行目不存在の全体rollback（12テーブル）、過去締切で準備なし、未来SF時刻でopen/eligibility生成、結果JSONとの時刻一致、1回のrevision更新、同一再送no-op、取得時刻のみ変更、2接続の実ロック待ち、確定後の両書込み経路拒否を検証する。
実行結果はPR #47 / Issue #42に記録。Python構文確認のみではSQL成功と扱わない。

## 制限と復旧
migrationではなく単独本番適用禁止。日程同期のもう1本、試合登録3本、手動prepare/refresh、全RLS/ACL/所属競合と公開承認UIは未接続。
本番DBや実ユーザーデータは変更しない。試作の復旧は当該commitのrevert、隔離DBはCIで破棄。
次は `auto_sync_koshien_official_schedule` を同じwriter境界へ接続する。
