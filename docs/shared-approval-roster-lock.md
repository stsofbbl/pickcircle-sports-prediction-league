# 共有承認のリーグ単位ロック：新規加入を含む競合（隔離試作）

本番catalog確認：会員承認RPC `review_club_join_request` は `league_members` にINSERT/復帰UPDATEを行い、`players` もauthenticatedクライアントからINSERT/UPDATE可能。既存会員行のFOR SHAREでは新規行に対応できず、確定の対象者と必要票数がすり抜ける。

設計：`public.leagues` の対象league行を共有の排他境界とする。承認RPCはleague行をFOR KEY SHAREしてからKoshien eventをFOR UPDATEし（本番delete_clubと同じリーグ先行順）、会員/プレイヤー資格を取得・検証する。会員・プレイヤーの**INSERT/DELETEと、承認資格・所属IDに関係する列のUPDATE**のBEFOREトリガーが、旧新リーグ（異なる場合はUUID順）をFOR UPDATEする。こうして新規INSERTにもロック境界を与える。登録経路が直接DMLでも必ず発火する。SECURITY DEFINER＋空search_path。`TRIGGER`は**2表に一括導入**を前提とし、一部だけの本番適用は禁止。

前提/制約：既存の他のevent-first書込みとリーグ更新の順序でデッドロックが起こらないか、全呼出経路の独立監査が必要。本番の`players` UPDATEを含め、会員が多いリーグのロック競合・性能影響も測定前。作成/参加/退会・新規入会だけを覆い、元の認可/RLS・得点処理は変更しない。今回のSQLは試作であり、本番migrationではない。PR #47 Draftを維持。

検証：実PostgreSQL 2セッションで（1）投票がリーグ行共有ロックを保持中、存在しなかった会員のINSERT/players追加が待機する、（2）新規入会側が先にリーグ行排他ロックを保持している場合、投票は待機し、会員集合の変化を検出して旧提出を確定しない、（3）既存会員無効化も待機、（4）rollbackとデータ残留を確認。

検証追加：会員行だけ先に作成済みのユーザーに対するプレイヤー行の単独INSERTも、投票側リーグ行FOR KEY SHAREがある間は待機。追加後は対象者集合の差分を検出し、旧submissionをsupersededにして票を再利用しない（使い捨てPostgreSQLの2接続）。

ロックの最小化：承認側のリーグロックは`FOR KEY SHARE`。トリガー側の`FOR UPDATE`とは競合して新規加入を止める一方、リーグ名等の非キー更新（`FOR NO KEY UPDATE`）をブロックしない。実2接続テストでロック保持中の非キー更新成功と新規player INSERT待機を同時確認。

ロック対象の最小化：league_membersではleague_id/user_id/role/membership_status、playersではid/league_id/profile_idに関係するUPDATEだけがtrigger対象。表示名・is_admin・joined_at等の非資格更新はロックを取らない。実2接続テストで承認保持中に表示名・joined_atの更新が完了することを確認する。

削除対応（2026-11-20）：本番`delete_club`はleague FOR UPDATE→DELETE→event/members/players ON DELETE CASCADE。承認側をleague→event順に改めてデッドロックのロック順逆転を解消。子行DELETEでcascade済みの親リーグが見えない場合はtriggerでエラーにしない。関連するprivate.revisions/submissions/votesもイベント削除時に連鎖削除する。クラブ削除の競合実検証と他のFK/trigger監査は別途必要。


## 本番catalog照合：削除と会員管理のロック順（2026-11-23、READ ONLY）

対象HEAD `440deef`。本番`pg_get_functiondef`と`pg_constraint`、`pg_trigger`を読み取って、試作trigger導入後の経路を照合した。本番には共有承認triggerがまだ存在せず、以下は**導入後の競合可能性**であり、デッドロックを再現済みと断定しない。

| 経路 | 本番で確認した先行ロック・更新 | 試作導入後の後続ロック |
| --- | --- | --- |
| `review_club_join_request` | `league_join_requests`対象行を`FOR UPDATE`、その後`league_members`をINSERT/UPDATE | 会員BEFORE triggerが`leagues FOR UPDATE` |
| `manage_league_admin` / `remove_club_member` | `league_members`対象行を`FOR UPDATE`、その後role/statusをUPDATE | 同triggerが`leagues FOR UPDATE` |
| `delete_club` | `leagues FOR UPDATE`後にリーグDELETE | 本番FKは`league_join_requests`、`league_members`、`players`をON DELETE CASCADE |
| 共有承認submit/approve試作 | `leagues FOR KEY SHARE`→event`FOR UPDATE` | 資格者を通常SELECTで再評価 |

会員管理側が子行を先に保持し、同時に`delete_club`が親リーグを保持してON DELETE CASCADEで同じ子行を待つと、子行→リーグとリーグ→子行の待機環が成立し得る。とくに加入申請の承認と削除、管理者変更/会員除名と削除を**実2接続で再現または反証するまで、triggerを本番へ適用しない**。既存の承認×削除テスト3順序は、これら会員管理RPCとの組合せを覆わない。

次の検証は使い捨てPostgreSQLで本番関数定義とFKを再現し、(1)会員管理が子行を保持→削除が親を保持、(2)逆順、(3)片方ROLLBACKを2接続で実行する。deadlock発生時はロック順の修正を試作で行い、権限・加入/除名・削除の正常経路も再確認する。本番DBは読み取りのみ。
