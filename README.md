# YOSO

友人同士でスポーツ大会の予想を行い、ポイントとランキングを共有するWebアプリです。

リアルマネー、決済、送金、換金、ブックメーカーへの誘導は扱いません。外部オッズを使用する場合も、ゲーム内の強さ評価・得点倍率としてのみ利用します。

## 公開URL

- Vercel: https://yoso-murex.vercel.app
- GitHub Pages（旧公開・予備）: https://stsofbbl.github.io/pickcircle-sports-prediction-league/

## 現在の開発状況

現在は「夏の甲子園2026」を最優先対象として開発しています。

実装済み・整備済みの主な領域:

- Supabase Authによるログイン基盤
- Supabase Postgresによる共有保存
- フェーズ1・大会前8校指名
- 試合結果入力と得点・ランキング再計算
- フェーズ2・ベスト16スネークドラフト基盤
- Vercel向け静的デプロイ設定
- 甲子園ルールのシミュレーターと自動テスト
- AIエージェント向けの作業規則・文書体系

検証・運用準備中:

- フェーズ2用migrationの実環境適用
- 複数端末・同時指名の競合試験
- フェーズ2指名結果の正式な得点投影
- Supabase AuthのVercel向けRedirect URL確認

## 開発ブランチ

- `main`: GitHub上の基準ブランチ
- `codex/supabase-mvp`: Supabase対応MVPの開発基盤
- `codex/phase2-draft-foundation`: フェーズ2ドラフト基盤
- `codex/vercel-release-candidate`: Vercel公開用の統合候補
- `gh-pages`: GitHub Pages公開用

共同開発やAIエージェントによる作業では、対象ブランチと正本文書を確認してから変更してください。

## ローカルで見る

ビルドは不要です。リポジトリ直下で静的サーバーを起動します。

```powershell
python -m http.server 4173
```

その後、次を開きます。

```text
http://127.0.0.1:4173
```

## 主な構成

- `index.html`: 画面の土台
- `styles.css`: レイアウトとレスポンシブ表示
- `app.js`: 画面描画、アプリ状態、予想・結果・得点処理
- `js/`: Supabase接続、保存処理、甲子園ドメインロジック
- `assets/`: ロゴ、アイコン、ルールガイド画像
- `supabase/`: schema、RLS、migration
- `tests/`: JavaScriptテスト
- `yoso-koshien-sim/`: 甲子園ルールのバランス検証用シミュレーター
- `docs/`: 正式ルール、実装仕様、運用手順

## 文書の正本

| 文書 | 役割 |
| --- | --- |
| [AGENTS.md](AGENTS.md) | リポジトリ全体のAIエージェント共通作業規則 |
| [CONTEXT.md](CONTEXT.md) | YOSO全体の製品・ドメインコンテキスト |
| [docs/KOSHIEN_2026_RULES.md](docs/KOSHIEN_2026_RULES.md) | 夏の甲子園2026正式ルールの唯一の正本 |
| [docs/WORKFLOW.md](docs/WORKFLOW.md) | 人間向けの共同開発・Git運用手順 |

フェーズ2仕様、Supabase運用手順、Vercel手順などは、開発対象ブランチ上の`docs/`を確認してください。READMEへルール本文を複製せず、必ず正本文書を参照します。

## 保存構成

- ブラウザ内の`localStorage`をフォールバックとして維持
- 共有保存の主経路はSupabase Auth + Supabase Postgres
- フロントエンドで使用するのは承認済みの公開設定のみ
- `service_role`、DBパスワード、秘密鍵などの特権情報はリポジトリへ保存しない

## 共同開発

AIエージェントは最初に[AGENTS.md](AGENTS.md)を読み、甲子園固有の変更前には正式ルールと関連仕様を確認してください。

- 依頼範囲外の変更を混ぜない
- 既存の未コミット作業を保持する
- 対象ファイルだけを明示してステージする
- 得点、保存、ランキング、状態遷移にはテストを追加する
- commit、push、merge、deploy、本番DB操作は明示承認後に行う
- 秘密情報、生成物、無関係な差分をコミットへ含めない

## App Store / Google Playに向けた方針

将来的なiOS・Androidアプリ化を想定しています。審査・安全性を優先し、次の方針を維持します。

- アプリ内で掛け金や支払いを徴収しない
- 決済・送金・換金機能を実装しない
- 外部ブックメーカーへの登録・入金を誘導しない
- 表現は「予想」「ポイント」「リーグ」「ランキング」に統一する
