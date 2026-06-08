# 参加メンバーへの引き継ぎメモ

YOSOアプリの共同開発に参加するときは、まず以下を読んでください。

1. `README.md`
2. `CLAUDE.md`
3. `docs/WORKFLOW.md`

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

## 最低限の確認

```bash
node --check app.js
git diff --check
```

画面を触ったら、PCとスマホ幅の両方で見てください。

## 相談してほしい変更

- 認証方式を変える
- localStorageのキーを変える
- W杯の得点計算を変える
- デザイン全体を変える
- 公開URLの設定を変える

迷ったらPull Requestに「相談」と書いて止めてください。
