# オンライン結果承認 × リーグ削除（隔離試作・安全ゲート）

本番SupabaseをREAD ONLYで確認した事実：`delete_club(uuid,text)` はowner本人・確認名を検証し、`public.leagues FOR UPDATE`後にリーグを削除する。events / league_members / players はリーグに対し `ON DELETE CASCADE`。以前の試作ではsubmit/approveがevent→league順なので削除のleague→eventと逆順。加えてprivate.revisionsはevents参照がNO ACTION、private.votesはsubmission参照がRESTRICTであり、削除を妨げ得た。

今回の変更：共有submit/approve RPCは**league FOR KEY SHARE→event FOR UPDATE→revision→submission**の順とし、eventのleague_idをロック前に読み取った値と比較、移動等が起きていれば40001で再試行を要求。正規のリーグ削除が連鎖している際に、子membership/player DELETEトリガーで親リーグが見えなくても拒否しない。INSERT/UPDATEの親存在保護は維持。revisions と votes のFKを`ON DELETE CASCADE`へ変更し、クラブ削除で内部承認の孤立データが残らない。

本番`delete_club`と`is_league_owner`の関数定義を改変せず`supabase/prototypes/koshien-real-delete-club.sql`へ固定。既存使い捨てPostgreSQLに3本の親リーグFKをトランザクション内だけ設定し、実削除RPCの匿名・他人・名前不一致拒否、正当削除によるイベント/会員/プレイヤー/更新番号/提出/票の消滅、別クラブ維持と全体ROLLBACKを検証する。

未検証：delete_clubと承認RPCの**2接続同時実行**、本番全FKと全トリガー、複数リーグ同時削除、性能、独立レビュー。ここまで成功しても単独本番適用は禁止。PR #47 Draft、本番migration/merge/deployなし。
## 2接続競合検証（2026-11-20追加）
使い捨てDBに実FKと本番`delete_club`関数をロードし、(1)投票が先→リーグ削除が待機し承認レコードと一緒に削除、(2)リーグ削除が先→投票が待機し削除確定後は投票拒否、(3)リーグ削除が先でROLLBACK→投票が復帰して正常な1票を保存、の3順序を実PostgreSQL2接続で再現する。いずれも子テーブル・privateデータの孤立確認、他のイベントsnapshot復元、試験DBの関数/制約撤去を実施する。CI成功までは検証結果未確定。
