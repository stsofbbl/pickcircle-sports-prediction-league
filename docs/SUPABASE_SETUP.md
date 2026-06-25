# Supabase セットアップ手順

YOSO のオンライン化第1段階は、GitHub Pages の静的フロントエンドから Supabase Auth と Supabase Postgres を使う構成です。既存の localStorage 保存は残します。

## 1. Supabase プロジェクトを作る

1. Supabase で新規プロジェクトを作成します。
2. Project Settings > API で以下を確認します。
   - Project URL
   - anon public key
3. service_role key はブラウザ側に置かないでください。RLSを無視できる管理者キーなので、GitHub Pages、`supabase-config.js`、`app.js`、README、Issue、PRに貼ってはいけません。

## 2. SQLを実行する

Supabase SQL Editor で次の順番に貼り付けて実行します。

1. `supabase/schema.sql`
2. `supabase/rls-policies.sql`
3. 必要なら `supabase/seed.sql`

`seed.sql` は `ADMIN_USER_ID` を Supabase Auth > Users のユーザーIDに置き換えてから実行します。未置換のまま実行すると停止します。

## 3. Auth設定

Authentication > Providers で Email provider を有効にします。

初期テストを簡単にする場合は、Authentication > Sign In / Providers のメール確認設定を確認してください。メール確認が必須のままだと、登録直後にセッションが作られないことがあります。

YOSOのログインフォームは現時点ではユーザーID入力です。Supabase接続時は、`@` を含まないユーザーIDを `ユーザーID@users.yoso.local` としてSupabase Authへ送ります。次の段階でメール入力UIに変えるか判断します。

## 4. ローカルで使う

1. `supabase-config.example.js` を `supabase-config.js` にコピーします。
2. `url` と `anonKey` を入力します。
3. Auth接続を試す場合は `auth.enabled` を `true` にします。
4. 甲子園データの自動保存はまだ既定で無効です。次の作業で接続するまでは `sync.autoSaveKoshien` は `false` のままにします。

`supabase-config.js` は `.gitignore` に入っています。ローカルで実キーを入れても通常のコミット対象にはなりません。

## 5. GitHub Pagesで使う

GitHub PagesでSupabaseへ接続するには、公開ページから読み込める場所に `supabase-config.js` が必要です。

選択肢:

- `gh-pages` ブランチに `supabase-config.js` を置く
- deploy時に `supabase-config.js` を生成する
- `index.html` より前に `window.YOSO_SUPABASE_CONFIG` を定義する別の公開スクリプトを読み込む

anon public key はブラウザで使う公開キーです。ただし、公開してよいのは anon key だけです。DB保護はRLSで行います。service_role key は絶対に公開しません。

## 6. 設定例

```js
window.YOSO_SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_PUBLIC_KEY",
  inviteCode: "g-unit-koshien-2026",
  leagueName: "G-UNIT YOSO League",
  auth: {
    enabled: true
  },
  sync: {
    autoSaveKoshien: false
  }
};
```

## 7. 動作確認

設定が無い場合:

- 既存のローカル認証が動きます。
- `yoso-league-state-v1` のlocalStorage保存が動きます。
- Google Sheets設定画面は削除されず、保留扱いで残ります。

設定がある場合:

- Supabase Authで登録・ログイン・ログアウトできます。
- ログイン中ユーザー情報を `window.YosoDataService.auth.currentUser()` で取得できます。
- `sync.autoSaveKoshien` を `true` にすると、甲子園イベントだけ `events`、`event_teams`、自分の `predictions` へ保存する土台が動きます。
