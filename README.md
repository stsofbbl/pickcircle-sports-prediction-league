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
- フェーズ状態管理
- 締切後の予想公開
- 結果入力/承認
- ポイントランキング
- GitHub Pages公開

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

## 共同作業するとき

最初に読むもの:

1. `CLAUDE.md`
2. `docs/WORKFLOW.md`
3. このREADME

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
