# Yoso League

身内用のスポーツ予想・ポイント管理アプリです。

このアプリはリアルマネーのベット、決済、送金、ブックメーカー連携を行いません。仲間内の予想をポイント制で記録するためのアプリです。

## 今の状態

- HTML / CSS / JavaScriptだけで動くUIモックです。
- `github-index.html` をブラウザで開くと、1ファイル版のアプリを確認できます。
- 元ファイルは `index.html`, `styles.css`, `app.js` です。
- `scripts/build-github-index.js` を実行すると、元ファイルから `github-index.html` を再生成できます。

## 画面

- ホーム
- 試合一覧
- ベット/予想入力
- 確認モーダル
- 結果表示
- ベット履歴
- ランキング

## デザインコンセプト

テーマは「映画的なマフィアの隠し部屋」です。

- 暗い背景
- 煙っぽい質感
- 深い赤
- 古びた金
- ガンメタル
- 古い木、革、真鍮の雰囲気
- 会員制の裏部屋で静かに勝負している空気

ただし、違法サイトっぽくなりすぎないように、リアルマネー機能は入れていません。

## ローカルで見る方法

特別なサーバーは不要です。

1. このフォルダを開く
2. `github-index.html` をダブルクリック
3. ブラウザで表示を確認

元ファイルで確認したい場合は `index.html` を開いてもOKです。

## 1ファイル版を再生成する方法

Node.jsが使える環境で、以下を実行します。

```bash
node scripts/build-github-index.js
```

これで `index.html`, `styles.css`, `app.js` の内容をまとめた `github-index.html` が更新されます。

## 初めて作業する人向け: GitHubの流れ

### 1. 最新版を取得

```bash
git pull
```

### 2. 作業用ブランチを作る

ブランチ名は内容がわかる名前にします。

```bash
git checkout -b feature/button-design
```

### 3. ファイルを編集

主に触るファイルはこの3つです。

- `index.html`
- `styles.css`
- `app.js`

`github-index.html` も更新したい場合は、編集後に以下を実行します。

```bash
node scripts/build-github-index.js
```

### 4. 変更を確認

```bash
git status
git diff
```

### 5. コミット

```bash
git add .
git commit -m "Update button design"
```

### 6. GitHubへpush

```bash
git push origin feature/button-design
```

### 7. Pull Requestを作る

GitHubを開くと、pushしたブランチからPull Requestを作るボタンが出ます。

Pull Requestでは以下を書くとわかりやすいです。

- 何を変えたか
- なぜ変えたか
- 確認した画面

例:

```text
## 変更内容
- LOCK INボタンの色を調整
- スマホ表示で余白を調整

## 確認
- github-index.htmlをChromeで開いて確認
```

### 8. マージ

内容を確認して問題なければ、GitHub上で `Merge pull request` を押します。

## 注意

- いきなり `main` に直接pushしないでください。
- まず作業用ブランチを作り、Pull Request経由で反映してください。
- 他の人の変更を消さないように、作業前に `git pull` してください。
- リアルマネー、決済、送金、ブックメーカー登録導線は入れない方針です。
