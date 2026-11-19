# 共有結果承認：提出RPC（隔離試作）

2026-11-19。本番カタログ・実データを読み取り、登録48試合/完了48試合/結果JSON48スロット/決勝1試合/有効参加者4名/得点行5件を確認。有効投票者は得点全行ではなく`players.profile_id`とactive`league_members`の共通集合（重複排除）で数える。
`submit_koshien_shared_results(event_id,expected_revision)`の試作。SECURITY DEFINER、空search_path、authenticated限定EXECUTE、active管理者本人のイベント行ロック→revision一致→締切後/結果待機状態→48試合全完了・勝者整合・結果JSON48件・有効参加者全員の得点行を確認。対象者・承認方式（admin/half/unanimous）と必要数を固定し、private submissionへ試合・得点・結果JSONの監査snapshotを保存し、提出者本人の1票を保存する。
同じ提出者の同revision再送は同じ提出扱い。結果改訂でrevisionが進んだ後は旧提出をsupersededにし、旧票を再利用せず新規提出とする。異なる提出者による重複開始は拒否。
隔離DBでは合成48試合をseed（setup中だけ自動進行trigger停止、RPC検証前に再有効化）し、anon/他リーグ/非管理者拒否、stale revision、正常提出、同再送、4人と48件の監査snapshot、不完全な結果JSON・不足得点の拒否、revision更新→新提出、巻戻しを検証。
**未実装・本番適用禁止**：承認/投票/確定RPC、再開とsubmission無効化の完全結合、現在の全得点・予想・メンバー変更の同時競合、全本番制約/RLS/trigger・UI。admin=1票もこの段階では自動確定せず、次のapprove/finalizeに委ねる。PR Draft維持、本番DB/得点/デプロイは無変更。復旧は試作commit revert。
