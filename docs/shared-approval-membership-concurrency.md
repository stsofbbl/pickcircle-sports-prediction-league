# 共有結果承認：所属更新とのロック競合（隔離検証）

2026-11-19。提出/投票RPCのevent FOR UPDATE後、同リーグの全既存membership行（inactiveを含む）とplayers行をFOR SHAREし、その後に管理者/会員権限を再判定する。管理者が既存会員を削除・無効化・ロール変更するUPDATE/DELETEが同時実行されても、投票の参加者集合取得と確定処理の間に割り込まない。ロック順はevent→membership→players→revision→submission。

既存使い捨てPostgreSQLで、1接続目の投票RPCを未commitで保持し、2接続目のmembership_status更新がpg_blocking_pidsで実際に待機することを確認。rollback後に更新が完了し、承認revision/私有テーブル作成が巻戻されることを検証する。

**未解決**：新規membership/player INSERTは既存行FOR SHAREではブロックできない。会員参加承認・プロフィール紐付け変更の同時競合には、membership書込み入口との共通リーグ単位ロックなど別途設計が必要。全て安全と判断して本番適用しない。PR #47はDraft、本番変更なし。
