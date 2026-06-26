# Supabase セットアップ手順

YOSO のオンライン化第1段階は、GitHub Pages の静的フロントエンドから Supabase Auth と Supabase Postgres を使う構成です。既存の localStorage 保存とGoogle Sheets同期UIはフォールバックとして残します。

手動必須タスクとCodexで代行できる作業は `docs/SUPABASE_MANUAL_TASKS.md` も参照してください。

## 1. Supabase プロジェクト

1. Supabase でプロジェクトを作成します。
2. Project Settings > API で以下を確認します。
   - Project URL
   - anon public key
3. `service_role` key はブラウザ側に置かないでください。RLSを無視できる管理者キーなので、GitHub Pages、`supabase-config.js`、`app.js`、README、Issue、PRに貼ってはいけません。

## 2. SQL

Supabase SQL Editor で次の順番に貼り付けて実行します。

1. `supabase/schema.sql`
2. `supabase/rls-policies.sql`
3. 必要なら `supabase/seed.sql`

SQL Editorではブラウザ翻訳をオフにしてください。SQLが `create extension if not exists pgcrypto;` ではなく「pgcrypto が存在しない場合は、拡張機能を作成します。」のような日本語文に変わると実行できません。

`profiles.display_name` は `auth.users` 作成時のトリガーで保存します。フロント側は登録時に Supabase Auth の `data.display_name` へ表示名を渡します。

## 3. Email Auth

Authentication > Providers で Email provider を有効にします。

このブランチでは Confirm Email をONのまま使います。登録直後はログイン済みにならず、「確認メールを送信しました」と表示します。ユーザーはメール内の確認リンクを開いた後に、同じ画面からメールアドレスとパスワードでログインします。

## 4. URL Configuration

Supabase管理画面の Authentication > URL Configuration を設定します。

### ローカル検証

- Site URL: `http://127.0.0.1:4173/`
- Redirect URLs:
  - `http://127.0.0.1:4173/`
  - `http://localhost:4173/`

`supabase-config.js` も同じ戻り先を指定します。

```js
window.YOSO_SUPABASE_CONFIG = {
  url: "https://YOUR_PROJECT_REF.supabase.co",
  anonKey: "YOUR_SUPABASE_ANON_PUBLIC_KEY",
  inviteCode: "g-unit-koshien-2026",
  leagueName: "G-UNIT YOSO League",
  sdkUrl: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  redirectTo: "http://127.0.0.1:4173/",
  emailRedirectTo: "http://127.0.0.1:4173/",
  passwordResetRedirectTo: "http://127.0.0.1:4173/",
  auth: {
    enabled: true
  },
  sync: {
    autoSaveKoshien: true
  }
};
```

### GitHub Pages公開URLの例

GitHub Pagesで公開する場合は、以下のように実際の公開URLを使います。

- Site URL: `https://stsofbbl.github.io/pickcircle-sports-prediction-league/`
- Redirect URLs:
  - `https://stsofbbl.github.io/pickcircle-sports-prediction-league/`
  - `http://127.0.0.1:4173/`
  - `http://localhost:4173/`

メール確認後の戻り先URL:

```js
emailRedirectTo: "https://stsofbbl.github.io/pickcircle-sports-prediction-league/"
```

パスワード再設定後の戻り先URL:

```js
passwordResetRedirectTo: "https://stsofbbl.github.io/pickcircle-sports-prediction-league/"
```

GitHub Pagesへ反映するまでは、`gh-pages` ブランチには入れずローカルの `supabase-config.js` で検証してください。

## 5. ローカルで使う

1. `supabase-config.example.js` を `supabase-config.js` にコピーします。
2. `url` と `anonKey` を入力します。
3. `auth.enabled` を `true` にします。
4. 甲子園データの自動保存を試す場合は `sync.autoSaveKoshien` を `true` にします。

`supabase-config.js` は `.gitignore` に入っています。ローカルで実キーを入れても通常のコミット対象にはなりません。ブラウザに入れてよいのは anon public key だけです。

## 6. 動作確認

設定が無い場合:

- 既存のローカル認証が動きます。
- `yoso-league-state-v1` のlocalStorage保存が動きます。
- Google Sheets設定画面は削除されず、保留扱いで残ります。

設定がある場合:

- 新規登録フォームは、表示名、メールアドレス、パスワード、パスワード確認を使います。
- 登録後は確認メール送信の案内を表示します。
- メール確認前のログイン失敗時は、確認メールを開くよう案内します。
- メール確認後はログイン、ログアウト、再ログイン、セッション維持ができます。
- パスワード再設定メールを送信できます。
- `profiles.display_name` に表示名が保存されます。
- `sync.autoSaveKoshien` を `true` にすると、甲子園イベントだけSupabase保存を試みます。Adminは `events`、`event_teams`、`results`、自分の `predictions`、memberは自分の `predictions` だけを保存します。

## 7. RLSの最低確認

Supabase管理画面で2ユーザーを作り、次を確認します。

1. Adminユーザーで登録/ログインする。
2. Adminが甲子園イベントを保存できる。
3. memberユーザーで登録/ログインする。
4. memberが自分の予想を保存できる。
5. memberが `events`、`event_teams`、`results` を更新できない。
6. 締切前は、memberが他メンバーの `predictions` をSELECTできない。
7. 締切後または `resultWait` / `finalized` では、同じリーグの `predictions` をSELECTできる。

RLS検証が終わるまで、`service_role` keyを使った動作確認結果を「ユーザー側でも動いた」と見なさないでください。`service_role` はRLSを迂回します。
