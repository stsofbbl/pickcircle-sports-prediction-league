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

仲間内テストに向けて、設定画面にGoogle Sheets同期欄を追加しています。Apps Script URL、Spreadsheet ID、League IDを保存し、`Sheetsへ保存` / `Sheetsから読込` を実行できます。

Google側のスプレッドシート作成とApps ScriptのWebアプリ公開だけは、ユーザーのGoogleアカウントで行う必要があります。テンプレートは `scripts/google-sheets-web-app.gs` にあります。詳細は `docs/GOOGLE_SHEETS_SYNC_PLAN.md` を見てください。

## 直近の開発方針

W杯2026のUIはプロトタイプとして残し、直近は夏の甲子園までの実用化を優先します。

優先順位:

1. Google Sheets連携
2. 友達同士で同じリーグデータを共有できるWebアプリ化
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
