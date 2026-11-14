# 決勝予想 SELECT のフェーズ別公開制御（検証待ち）

## 根拠と範囲

基準HEAD: `6236bf5642ea601d037703ff22dc74b46d90d1f8`。
2026-11-14、本番 Supabase `gubsrwaxpifhvwommpos` のカタログを読み取り確認。

- `final_score_predictions_select_owner_or_public` は本人、または `is_prediction_public(event_id)` を許可。
- 同関数は所属確認後、大会 status が resultWait/finalized/archive、または大会予想締切を過ぎると公開。
- `get_koshien_later_phase_state` の phase3.predictions は phase3 の status が locked/completed の場合だけ公開。
- 同RPCは `refresh_koshien_phase_schedule` を呼び、状態を変更し得るため本番確認目的では実行しなかった。
- events/players は所属メンバー向けSELECT、koshien_later_rounds は events 経由の所属確認。今回の参照経路に final_score_predictions への循環なし。
- `final_score_predictions_self_before_deadline` はALLポリシーでありSELECTにもOR合成される。所属確認付きの大会受付中判定＋本人条件。変更しない。
- authenticated に予想INSERT/UPDATE/DELETE権限なし。変更しない。
- PR #31、得点計算、決勝30点の採用条件には触れない。

## 実装案

`supabase/patches/phase3-visibility.sql` は候補SQLであり、自動適用migrationではない。
SELECTポリシー1件を変更し、イベント所属確認＋本人、または同一イベントのphase3がlocked/completedの場合に限定する。
新規SECURITY DEFINER関数、権限付与、データ更新は追加しない。

大会の締切や終了状態だけでは他人の決勝予想を公開しない。
決勝締切を過ぎても保存されたphase3状態がopenなら公開しない。
既存の状態更新処理でlockedになってから公開する（SELECTに更新処理を追加しない）。
手動ロックはRPCと同様に公開される。

## 検証状況

- 実施: 本番ポリシー・関数定義・参照テーブルのRLS・権限を読取り照合。候補SQLとテストの目視レビュー。
- 未実施: PostgreSQL上のテスト、完全な本番同等スキーマでの試験、API/RPC統合試験。
- 現環境にpsql/postgres/Supabase CLIなし。新規有料環境は作成していない。
- `tests/sql/phase3-visibility.sql` は最小の独立RLS契約テスト。既存ALLポリシーも再現し、変更前の早期公開を検出してから候補SQLを読み込む。
- シナリオ: 変更前の再現、phase3未作成、phase2完了＋phase3受付中、大会archive、ALLポリシーとの合成、手動ロック、完了、他クラブ、認証IDなし、退会済み本人、書込み権限不追加。
- 専用の空DB `yoso_phase3_rls_test` のみ許可し、transactionでrollback。実データは不要。テストは未実行であり、CI成功を代用してはならない。

隔離PostgreSQLでの実行方法（このDBの接続先が本番でないことを確認する）:

```sh
psql -X -d yoso_phase3_rls_test -f tests/sql/phase3-visibility.sql
```

## 次の1件と適用ゲート

既存CIの利用可能なPostgreSQLで上記テストを実行し、完全スキーマ/APIでの所属・決勝締切直前/同時/直後・状態更新・他イベント分離を追加検証する。
既存のrefresh処理を含む書込み試験は隔離環境だけで行う。
必要な試験が成功するまでmerge/本番migrationは行わない。
成功後、Supabase CLIのmigration newで正式migrationを作成し、本番履歴との整合を再確認して同じ変更を一度だけ適用する。

適用直前に現行ポリシー定義を再取得して差分がないことを確認する。
適用後はカタログのSELECTポリシーと実アクセス結果を確認する。実ユーザー予想のテスト送信は禁止。

## 復旧

変更対象はポリシー1件のみで、予想データや得点は変更しない。
適用をtransaction内で中断できる段階ならROLLBACKする。
適用後にロールバックする場合の旧定義は以下。ただし早期公開条件も復活するため、アクセス障害と情報公開リスクを評価してから使用する。

```sql
ALTER POLICY final_score_predictions_select_owner_or_public
ON public.final_score_predictions
USING (
  EXISTS (
    SELECT 1 FROM public.players p
    WHERE p.id = final_score_predictions.player_id
      AND p.profile_id = (SELECT auth.uid())
  )
  OR public.is_prediction_public(event_id)
);
```

実行者のユーザー対応は現時点では不要。隔離検証とCI整備はAI側の次作業とし、Todoistには登録しない。
