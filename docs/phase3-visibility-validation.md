# 決勝予想 SELECT の公開制御

## 変更と根拠
本番の直接SELECTは大会全体の締切/終了で公開する一方、画面RPCは同一イベントのphase3がlocked/completedのときだけ公開していた。PR #45はSELECTポリシー1件だけをRPCに合わせる。本人もイベント所属を確認する。新しい関数、書込み権限、得点変更はない。

## 正式migration
`supabase/migrations/20261114123717_protect_phase3_prediction_visibility.sql`
Supabase CLI 3.1.0のhelp確認後、migration newで生成したファイル（CI run 43595689727）。本番接続なし。従来のpatchを移し、CIではこのmigrationそのものを読み込む。
PR #31、決勝30点条件、過去migrationの再適用・履歴修復は対象外。

## 検証範囲
既存CIの隔離PostgreSQLにてRLS可視性16ケース、実RPC/refresh11ケース、本番制約21件と不正データ拒否5種類、DDL/role rollbackを検証。
本番と同じauthenticated/anon名、NOSUPERUSER/NOBYPASSRLSで検証する。anonにSELECT権限とメンバーidentity claimを付けても非公開であることを確認。
関数は本番カタログから取得した定義。対象2テーブルのCHECK/PK/UNIQUE/FKと関連UUID型を再現する。
他テーブルの完全スキーマ、phase2_draftsのトリガー、HTTP APIは未再現。この変更はSELECTポリシーだけで、HTTP経路・書込み関数は変更しない。
最新CI結果はPR本文を参照。

## 適用手順
1. 最新HEAD/CIと本番定義を再確認。
2. `supabase/patches/phase3-visibility-preflight.sql` を読取り実行し、全項目trueを確認。falseなら適用せず差分を調査。
3. 本番migration履歴とリポジトリの版番号を照合。過去履歴の一括修復や再適用は禁止。
4. 検証済みmigrationだけを一度適用し、適用された版番号・名前と実際の定義を記録する。接続ツールが版番号を自動採番する場合、CLI生成版との対応を明記し、無言で履歴差分を増やさない。
5. RLS/ポリシー/権限と可能な範囲の実読取り結果を確認。実ユーザーの予想をテスト送信しない。状態変更を伴うget_koshien_later_phase_stateを確認のため本番で呼ばない。

## 復旧
予想データは変更しない。適用transactionが未確定ならROLLBACK。
適用後の復旧候補は `supabase/patches/phase3-visibility-rollback.sql`。旧公開条件も復活するため、情報公開リスクを評価してから利用する。
必要な検証や版番号照合が完了するまでは本番適用・mergeを行わない。
