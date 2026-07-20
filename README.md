# YOSO

友達同士のスポーツ予想をポイントで記録し、締切後に共有してランキングを楽しむ静的Webアプリです。リアルマネー、決済、送金、換金、ブックメーカー連携は扱いません。

公開ページ: https://stsofbbl.github.io/pickcircle-sports-prediction-league/

## ローカルで見る

ビルドは不要です。`index.html` を直接ブラウザで開くか、リポジトリ直下で静的サーバーを起動します。

```powershell
python -m http.server 4173
```

その後、`http://127.0.0.1:4173` を開きます。

## 主な構成

- `index.html`: 画面の土台
- `styles.css`: 見た目とレスポンシブレイアウト
- `app.js`: アプリ状態、画面描画、予想・結果・得点処理
- `js/`: Supabase接続、データ保存、甲子園結果処理
- `assets/`: ロゴ、アイコン、ルールガイド画像
- `supabase/`: schema、RLS、migration
- `tests/`: JavaScriptのテスト
- `yoso-koshien-sim/`: 甲子園ルールのバランス検証用シミュレーター

## 文書の正本

| 文書 | 役割 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | リポジトリ全体のAIエージェント共通作業規則 |
| [CONTEXT.md](CONTEXT.md) | YOSO全体の短い製品・ドメインコンテキスト |
| [docs/KOSHIEN_2026_RULES.md](docs/KOSHIEN_2026_RULES.md) | 夏の甲子園2026正式ルールの唯一の正本 |
| [docs/KOSHIEN_2026_PHASE2_DRAFT_SPEC.md](docs/KOSHIEN_2026_PHASE2_DRAFT_SPEC.md) | フェーズ2・ベスト16スネークドラフトの実装仕様 |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | 人間向けの共同開発手順 |
| [docs/KOSHIEN_2026_DELIVERY_PLAN.md](docs/KOSHIEN_2026_DELIVERY_PLAN.md) | 夏の甲子園2026のリリース計画 |
| [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) | Supabase Auth/Postgresのセットアップ手順 |
| [docs/SUPABASE_MIGRATION_PLAN.md](docs/SUPABASE_MIGRATION_PLAN.md) | Supabase移行方針 |
| [docs/SUPABASE_KOSHIEN_MATCH_RESULTS_RUNBOOK.md](docs/SUPABASE_KOSHIEN_MATCH_RESULTS_RUNBOOK.md) | 甲子園試合結果保存migrationの本番確認手順 |
| [docs/SUPABASE_KOSHIEN_PHASE2_DRAFT_RUNBOOK.md](docs/SUPABASE_KOSHIEN_PHASE2_DRAFT_RUNBOOK.md) | フェーズ2ドラフトmigrationと競合確認の運用草案 |

`CLAUDE.md` と `docs/ANTIGRAVITY_KOSHIEN_2026_CONTEXT.md` は互換用の参照案内です。エージェント規則や甲子園ルールの正本として扱いません。

## 現在の保存構成

- ブラウザ内の `localStorage` をフォールバックとして維持します。
- 共有保存の主経路は Supabase Auth + Supabase Postgres です。
- ブラウザコードで使えるのは承認済みのanon public keyだけです。特権キーやDBパスワードは保存・公開しません。
- Google Sheets同期は試作・保留ルートとして残しています。

## 夏の甲子園2026

実装・レビュー・テストでは、得点表やフェーズ条件をこのREADMEへ複製せず、必ず [正式ルール](docs/KOSHIEN_2026_RULES.md) を参照してください。

進行中の実装計画は [リリース計画](docs/KOSHIEN_2026_DELIVERY_PLAN.md)、試合結果保存の本番作業は [運用手順](docs/SUPABASE_KOSHIEN_MATCH_RESULTS_RUNBOOK.md) を参照してください。

## 共同開発

AIエージェントは最初に [AGENTS.md](AGENTS.md) を読みます。人間向けのGit・Pull Request・公開手順は [docs/WORKFLOW.md](docs/WORKFLOW.md) を参照してください。

既存の未コミット変更を保持し、対象ファイルだけを明示してステージしてください。秘密情報、無関係な変更、生成物をコミットへ混ぜないでください。
