# 参加メンバーへの引き継ぎメモ

YOSOアプリの共同開発に参加するときは、まず以下を読んでください。

1. `README.md`
2. `CLAUDE.md`
3. `docs/WORKFLOW.md`
4. `docs/GOOGLE_SHEETS_SYNC_PLAN.md`
5. `docs/KOSHIEN_2026_DELIVERY_PLAN.md`
6. `docs/SUPABASE_SETUP.md`
7. `docs/SUPABASE_MIGRATION_PLAN.md`

## 作業ブランチ

基本はこのブランチを基準にしてください。

```text
codex/local-app-source
```

公開ページ用ブランチはこれです。

```text
gh-pages
```

## 公開URL

```text
https://stsofbbl.github.io/pickcircle-sports-prediction-league/
```

## 必ず守ること

- UI、ロゴ、石鹸透かし、ナビの見た目は、指定がない限り変えない。
- 予想入力は、締切前は自分のYOSOだけ見せる。
- 他メンバーのYOSOは締切後に公開する。
- リアルマネー、決済、送金、ブックメーカー連携は入れない。
- W杯2026は専用プリセットとして扱う。
- 直近はW杯UIの完成より、Supabase移行と夏の甲子園リリースを優先する。
- 夏の甲子園は8校ピック、キャプテン2倍、進出ポイント累積方式を採用する。

## 最低限の確認

```bash
node --check app.js
git diff --check
```

画面を触ったら、PCとスマホ幅の両方で見てください。

## 相談してほしい変更

- 認証方式を変える
- localStorageのキーを変える
- Supabase接続/Auth/RLS方式を変える
- Google Sheets同期方式を変える
- W杯の得点計算を変える
- 夏の甲子園の8校ピック得点計算を変える
- デザイン全体を変える
- 公開URLの設定を変える

## Supabase移行

主方針は GitHub Pages + Supabase Auth + Supabase Postgres です。

```text
docs/SUPABASE_SETUP.md
docs/SUPABASE_MIGRATION_PLAN.md
supabase/schema.sql
supabase/rls-policies.sql
```

ブラウザに入れてよいのはSupabaseのanon public keyだけです。`service_role` keyは絶対にフロント、GitHub Pages、README、Issue、PRへ貼らないでください。

## Google Sheets同期

Apps Scriptテンプレートは以下です。

```text
scripts/google-sheets-web-app.gs
```

Google Sheets作成、Apps Script貼り付け、Webアプリ公開は、ユーザーのGoogleアカウントで行う必要があります。

現在は保留・試作ルートです。削除はユーザーが明示した場合だけにしてください。

迷ったらPull Requestに「相談」と書いて止めてください。
