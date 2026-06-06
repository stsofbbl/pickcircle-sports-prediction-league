# YOSO

身内用のスポーツ予想・ポイント管理アプリです。
このアプリはリアルマネー、決済、送金、ブックメーカー連携を扱いません。仲間内の予想をポイント制で記録するためのWebアプリです。

## 現在の状態

- HTML / CSS / JavaScriptだけで動くUIモックです。
- 主なファイルは `index.html`, `styles.css`, `app.js` です。
- 画像アセットは `assets/` に入っています。
- 以前の大きな1ファイル版 `github-index.html` は削除済みです。

## デザインコンセプト

テーマは「スモーキーな地下クラブ + ピンク石鹸ブランド」です。

- アプリ正式名は `YOSO`
- ブランドマークは `YOSO CLUB` のピンク石鹸画像
- 映画的な隠し部屋感は残しつつ、真鍮・金属感は弱め
- 煙、泡、湿った光、黒茶系の地下感を優先
- 危うさは出すが、リアルマネーや違法賭博の直接表現には寄せない

## ローカルで見る方法

特別なサーバーは不要です。

1. このフォルダを開く
2. `index.html` をダブルクリック
3. ブラウザで表示を確認する

## 画面

- ホーム
- 今日の試合
- 予想入力
- 確認モーダル
- 結果表示
- 予想履歴
- ランキング

## 初めて作業する人向け: GitHubの流れ

### 1. 最新版を取る

```bash
git pull
```

### 2. 作業用ブランチを作る

ブランチ名は内容がわかる名前にします。

```bash
git checkout -b feature/button-design
```

### 3. ファイルを編集する

主に触るファイルはこの3つです。

- `index.html`
- `styles.css`
- `app.js`

### 4. 変更を確認する

```bash
git status
git diff
```

### 5. コミットする

```bash
git add .
git commit -m "Update button design"
```

### 6. GitHubへpushする

```bash
git push origin feature/button-design
```

### 7. Pull Requestを作る

GitHubを開くと、pushしたブランチからPull Requestを作るボタンが出ます。
Pull Requestには以下を書くとわかりやすいです。

```text
## 変更内容
- 何を変えたか

## 確認したこと
- index.htmlをブラウザで開いて確認
```

### 8. マージする

内容を確認して問題なければ、GitHub上で `Merge pull request` を押します。

## 注意

- いきなり `main` に直接pushしないでください。
- まず作業用ブランチを作り、Pull Request経由で反映してください。
- 他の人の変更を消さないように、作業前に `git pull` してください。
- リアルマネー、決済、送金、ブックメーカー登録導線は入れない方針です。
