# YOSO

友達同士のスポーツ予想リーグを、ポイント制で管理するWebアプリです。

このアプリはリアルマネー、決済、送金、ブックメーカー連携を扱いません。仲間内の予想をポイントとして記録し、締切後に公開し、結果確定後にランキングへ反映するためのアプリです。

## 公開URL

GitHub Pages:

https://stsofbbl.github.io/pickcircle-sports-prediction-league/

## いまの構成

- `index.html`: 画面の土台
- `styles.css`: 見た目
- `app.js`: アプリの状態管理、ルール、スコア計算、ログイン処理
- `assets/`: ロゴ、アイコン、画像
- `CLAUDE.md`: Claude Code / Codex などAI開発メンバー向けの作業ルール
- `docs/WORKFLOW.md`: GitHubが分からない人向けの共同作業手順
- `docs/GOOGLE_SHEETS_SYNC_PLAN.md`: Google Sheets同期の設計メモ
- `docs/KOSHIEN_2026_DELIVERY_PLAN.md`: 夏の甲子園リリース計画
- `docs/SUPABASE_SETUP.md`: Supabase Auth/Postgres セットアップ手順
- `docs/SUPABASE_MIGRATION_PLAN.md`: Supabase移行計画
- `docs/SUPABASE_MANUAL_TASKS.md`: Supabase管理画面で必要な手動作業とCodex代行範囲

ビルドツールはありません。HTML/CSS/JavaScriptだけで動きます。

## ローカルで見る方法

一番簡単な方法:

1. このフォルダを開く
2. `index.html` をブラウザで開く

ローカルサーバーで見る場合:

```powershell
python -m http.server 4173
```

その後、PCで以下を開きます。

```text
http://127.0.0.1:4173
```

## 重要方針

- UI、ロゴ、石鹸透かし、ナビの見た目は、明示指定がない限り触らない。
- 予想入力は原則「自分のYOSOだけ」表示する。
- 他メンバーの予想は締切後に公開する。
- ルールプリセットは必ずYOSOアプリの利用目的に沿って実装する。
- リアルマネー、決済、送金、ギャンブル登録導線は入れない。
- W杯2026は専用プリセットとして扱う。

## 現在の主な機能

- ローカル簡易ログイン/ユーザー登録
- 初回登録ユーザーをAdmin扱い
- 大会作成/管理
- 複数ルールプリセット
- W杯2026 3フェーズ予想
- 夏の甲子園8校ピック予想
- フェーズ状態管理
- 締切後の予想公開
- 結果入力/承認
- ポイントランキング
- 設定画面のGoogle Sheets同期MVP
- GitHub Pages公開

## データ保存

現在の実データ保存は端末内の `localStorage` です。

仲間内テストに向けて、主方針を Supabase Auth + Supabase Postgres へ切り替えています。第1段階では既存の `localStorage` を残したまま、Supabase Auth、リーグ/参加者/大会/予想/結果テーブル、RLS、夏の甲子園データ保存の土台を追加しています。

Google Sheets同期は試作・保留ルートとして残しています。テンプレートは `scripts/google-sheets-web-app.gs` にあります。

## 直近の開発方針

W杯2026のUIはプロトタイプとして残し、直近は夏の甲子園までの実用化を優先します。

優先順位:

1. Supabase接続とAuth/RLS検証
2. 夏の甲子園プリセットのオンライン保存
3. 夏の甲子園向けプリセット
4. スマホで使える予想入力、結果入力、ランキング

詳細なスケジュールは `docs/KOSHIEN_2026_DELIVERY_PLAN.md` を見てください。

## W杯2026プリセット

W杯2026は通常の複合型ではなく、専用の3フェーズプリセットです。

- 第1回: グループリーグ予想
- 第2回: 決勝トーナメント、複勝10枠、個人賞
- 第3回: 決勝スコア予想

フェーズ状態:

- ロック中
- 受付中
- 結果待ち
- 確定済み

ランキングは確定済みフェーズだけを合算します。

## 夏の甲子園プリセット

夏の甲子園2026向けに、固定トーナメント表ではなく8校ピック方式を採用します。

- 49代表校から8校を選ぶ
- 8校のうち1校をキャプテン校にする
- キャプテン校は得点2倍
- 決勝戦の合計得点予想を同点決着用に持つ
- 管理者が各校の勝ち上がり結果を入力する

得点は、32強1pt、16強2pt、8強4pt、4強8pt、決勝16pt、優勝32ptを累積します。

## 共同作業するとき

最初に読むもの:

1. `CLAUDE.md`
2. `docs/WORKFLOW.md`
3. `docs/GOOGLE_SHEETS_SYNC_PLAN.md`
4. このREADME

基本の流れ:

```bash
git pull
git checkout -b feature/your-change
# 編集する
git status
git diff
git add .
git commit -m "Describe your change"
git push origin feature/your-change
```

GitHub上でPull Requestを作り、内容確認後に反映します。

GitHubが分からない場合は、`docs/WORKFLOW.md` を見てください。

## Supabase migration phase 1

The online direction is now GitHub Pages + Supabase Auth + Supabase Postgres.

- Setup: `docs/SUPABASE_SETUP.md`
- Migration plan: `docs/SUPABASE_MIGRATION_PLAN.md`
- Schema: `supabase/schema.sql`
- RLS policies: `supabase/rls-policies.sql`
- Optional Koshien seed: `supabase/seed.sql`

Google Sheets files are still kept as paused/trial infrastructure. Do not put a Supabase `service_role` key in browser code. Use only the anon public key.

## YOSO Summer Koshien 2026 QA Notes

YOSO Summer Koshien 2026 is a points-only prediction game for a private club. It does not handle real money, settlement, payment, payout, or cash betting.

### Basic Flow

1. Create or open a Koshien 2026 event.
2. Enter 49 schools with `start_round` set to `1` or `2`.
3. Set odds for each school. The app uses `sqrt_odds_capped = min(sqrt(odds), 50)` for scoring.
4. Phase 1: each player picks 8 schools and selects 1 captain.
5. Manager enters school finishes as the tournament progresses.
6. Revenge card: only players whose Phase 1 schools are all eliminated by Best 16 can make a revenge pick.
7. Phase 2: after Best 16 is fixed, run the 4-school snake draft.
8. Zombie mode: if enabled, players whose Phase 2 schools are all eliminated by Best 4 can pick one opponent-owned Best 4 school to lose in the semifinal.
9. Phase 3: after the final card is fixed, players predict the final score.
10. Ranking shows total score plus Phase 1, revenge, Phase 2, zombie impact, and Phase 3 breakdowns.

### Manager Order

1. Confirm participants.
2. Confirm all 49 schools and odds.
3. Confirm Phase 1 picks are complete.
4. Enter match and finish results.
5. Open revenge card only when Best 16 is known.
6. Run Phase 2 draft after Best 16 is known.
7. Enable zombie mode only after Best 4 is known.
8. Enter final score after the final ends.
9. Check ranking and score breakdown before archiving the event.

### Supabase SQL Editor Order

Run these files in this order:

1. `supabase/schema.sql`
2. `supabase/rls-policies.sql`
3. Optional: `supabase/seed.sql`

`schema.sql` uses `create table if not exists` and `alter table ... add column if not exists` for the Koshien additions, so rerunning it is intended to be safe for existing data. The compatibility views `phase3_predictions`, `zombie_picks`, and `score_snapshots` map to the current physical tables `final_score_predictions`, `zombie_predictions`, and `scores`.

### LocalStorage QA Mode

For local-only QA, leave Supabase configuration unset and open `index.html` directly or through a local static server. The app continues to save state to browser `localStorage`; Supabase structured saves are skipped or gracefully ignored when the schema has not been applied.

### Current Known Gaps

- Full browser click-through QA still needs a human pass on the target browser/device.
- Supabase read-back for every Koshien structured table should be verified after SQL is applied to the real project.
- Tournament result entry is still manager-driven; no official result API integration is included.
- Revenge and zombie eligibility should be rechecked with real bracket data once the 49 schools and matches are finalized.
- Final score inputs are integer fields and tied scores are ignored by scoring, but the UI still needs an explicit warning when a tie is entered.
