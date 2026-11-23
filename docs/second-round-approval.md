# 2回戦枠登録の承認管理接続（隔離試作）

2026-11-17、本番catalogでregister_koshien_official_second_round_slotsの定義/ACLを確認。
SECURITY INVOKER・auth.uid必須・active league admin判定・16枠/15初戦校/17のR1参照・所属検証を保持。

## ロックと書込み
既存のevent FOR UPDATEを処理全体で保持する。既存のR1→results→R2の子ロック順は変更しない。
最初の実書込み直前にbegin_result_writeで管理者を再確認しrevision/permitを1回更新する。
この関数ではrevision取得は子ロックの後になるが、同じ大会の協調writerはすべて先にeventをロックするため、そのeventロックで直列化される。event先行を守らないwriterの単独混在は不可。

既存の無変更再登録はno-opを維持。ON CONFLICTで更新0件でもBEFORE INSERTトリガーは動くので、既存rowと新team/metadataが同一ならINSERT文自体をスキップ。
結果JSONだけ変わる経路にも同じwriter処理を適用する。完了試合/異なる組合せの既存保護は保持。

## 検証
使い捨てPostgreSQLで実RPC/実R1進出トリガーを使用。
権限拒否、16枠/17参照/初戦校検証、最後のJSONスロット不整合の部分挿入rollback、16枠生成と再送no-op、実R1勝者→R2とJSON反映、異なる組合せ拒否、結果JSONのみ修復と2接続ロック待ち、確定後の実書込み拒否/no-op許可を検証。
fixtureの予想締切は過去で、管理者の枠登録は既存仕様どおり可能。
結果はPR #47 / Issue #42。全RLS/制約/所属変更競合は未検証。

## 適用・復旧
migrationではなく単独本番適用禁止。本番DB/得点変更なし。復旧はcommit revert。
残る再抽選登録、手動prepare/refresh、承認UI等を接続する必要がある。
次の1件: register_koshien_official_redraw_slotsのwriter境界接続。
