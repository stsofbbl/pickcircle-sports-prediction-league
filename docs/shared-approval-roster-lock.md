# 共有承認のリーグ単位ロック：新規加入を含む競合（隔離試作）

本番catalog確認：会員承認RPC `review_club_join_request` は `league_members` にINSERT/復帰UPDATEを行い、`players` もauthenticatedクライアントからINSERT/UPDATE可能。既存会員行のFOR SHAREでは新規行に対応できず、確定の対象者と必要票数がすり抜ける。

設計：`public.leagues` の対象league行を共有の排他境界とする。承認RPCはKoshien eventをFOR UPDATE後、league行をFOR SHAREし、会員/プレイヤー資格を取得・検証する。会員・プレイヤーの**すべてのINSERT/UPDATE/DELETE**のBEFOREトリガーが、旧新リーグ（異なる場合はUUID順）をFOR UPDATEする。こうして新規INSERTにもロック境界を与える。登録経路が直接DMLでも必ず発火する。SECURITY DEFINER＋空search_path。`TRIGGER`は**2表に一括導入**を前提とし、一部だけの本番適用は禁止。

前提/制約：既存の他のevent-first書込みとリーグ更新の順序でデッドロックが起こらないか、全呼出経路の独立監査が必要。本番の`players` UPDATEを含め、会員が多いリーグのロック競合・性能影響も測定前。作成/参加/退会・新規入会だけを覆い、元の認可/RLS・得点処理は変更しない。今回のSQLは試作であり、本番migrationではない。PR #47 Draftを維持。

検証計画：実PostgreSQL 2セッションで（1）投票がリーグ行共有ロックを保持中、存在しなかった会員のINSERT/players追加が待機する、（2）新規入会側が先にリーグ行排他ロックを保持している場合、投票は待機し、会員集合の変化を検出して旧提出を確定しない、（3）既存会員無効化も待機、（4）rollbackとデータ残留を確認。
