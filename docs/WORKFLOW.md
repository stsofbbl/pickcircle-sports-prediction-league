# YOSO 共同作業ガイド

GitHubに慣れていない人でも、YOSOを壊さず共同作業するための手順です。

## まず覚える言葉

- リポジトリ: アプリ一式が置いてある場所
- ブランチ: 作業用の分岐
- コミット: 変更の保存ポイント
- push: 自分の変更をGitHubへ送ること
- Pull Request: 変更を本体へ入れる前の確認場所
- GitHub Pages: 友達に見せる公開ページ

## 大事なブランチ

- `codex/local-app-source`: 普段の開発ブランチ
- `gh-pages`: 公開URL用ブランチ
- `main`: 古い基準ブランチ。今は直接触らない

公開URL:

```text
https://stsofbbl.github.io/pickcircle-sports-prediction-league/
```

## 参加メンバーに渡す最初の指示

Claude Codeや他の開発者には、最初にこう伝えてください。

```text
まず README.md と CLAUDE.md と docs/WORKFLOW.md を読んでください。
作業ブランチは codex/local-app-source を基準にしてください。
UI、ロゴ、石鹸透かし、ナビの見た目は指定がない限り変えないでください。
リアルマネー、決済、送金、ブックメーカー連携は入れないでください。
```

## 開発者の基本作業

### 1. 最新状態を取る

```bash
git switch codex/local-app-source
git pull
```

### 2. 作業用ブランチを作る

例:

```bash
git switch -c feature/login-polish
```

ブランチ名は内容が分かればOKです。

よい例:

- `feature/ranking-filter`
- `fix/worldcup-phase-score`
- `ui/mobile-login`

### 3. 編集する

主に触るファイル:

- `index.html`
- `styles.css`
- `app.js`

画像やアイコン:

- `assets/`

### 4. 変更内容を見る

```bash
git status
git diff
```

### 5. 最低限の確認

JavaScriptを触った場合:

```bash
node --check app.js
```

表示を触った場合:

- PCブラウザで開く
- スマホ幅でも見る
- ログイン画面、YOSO入力、ランキングが崩れていないか見る

### 6. コミットする

```bash
git add .
git commit -m "変更内容を短く書く"
```

例:

```bash
git commit -m "Improve mobile login layout"
```

### 7. GitHubへ送る

```bash
git push origin feature/login-polish
```

### 8. Pull Requestを作る

GitHubを開くと、pushしたブランチからPull Requestを作るボタンが出ます。

Pull Requestには以下を書くと確認しやすいです。

```text
## 変更内容
- 何を変えたか

## 確認したこと
- どの画面を見たか
- どの操作を試したか

## 注意点
- まだ不安なところ
```

## 公開URLへ反映する方法

`codex/local-app-source` の内容を友達に見せるURLへ反映するときだけ、この手順を使います。

```bash
git switch gh-pages
git checkout codex/local-app-source -- index.html app.js styles.css manifest.json README.md assets
git commit -m "Deploy latest YOSO app"
git push origin gh-pages
git switch codex/local-app-source
```

反映後のURL:

```text
https://stsofbbl.github.io/pickcircle-sports-prediction-league/
```

反映には少し時間がかかることがあります。

## 触ってはいけない/慎重に触るところ

指定がない限り触らない:

- ロゴ
- 石鹸透かし
- ナビの見た目
- 全体のブランドカラー
- 既存UIの大きな再設計

慎重に触る:

- W杯2026のスコア計算
- フェーズ状態
- 締切前/締切後の公開制御
- ログイン/ユーザー登録
- localStorageのキー名

## 迷ったら

Pull Requestに「ここは相談」と書いて止めてください。

勝手に大きく変えるより、途中で見せる方が安全です。
