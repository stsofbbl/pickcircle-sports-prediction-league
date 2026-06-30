# Supabase 手動タスクとCodexで代行できること

## 結論

Supabase管理画面の操作は、あなたのSupabaseアカウント権限が必要です。Codexはリポジトリ側の準備、SQLの整備、設定ファイル作成補助、検証手順の整理まで対応できます。

## あなたの手動が必須

1. Supabaseで新規プロジェクトを作る
2. Project Settings > API で `Project URL` と `anon public key` を確認する
3. SQL Editorで `supabase/schema.sql` を実行する
4. SQL Editorで `supabase/rls-policies.sql` を実行する
5. Authentication > Providers で Email Auth を有効にする
6. 最初の管理者ユーザーを作る
7. 管理者ユーザーのUser IDを確認する
8. `supabase/seed.sql` の `ADMIN_USER_ID` をそのUser IDに置き換えて実行する

`service_role` keyは絶対にCodex、GitHub、フロントエンド、チャットへ貼らないでください。

## Codexが代行できる

1. `schema.sql`、`rls-policies.sql`、`seed.sql` の内容確認
2. `ADMIN_USER_ID` を受け取って、実行用のseed SQLをローカルで作る
3. `Project URL` と `anon public key` を受け取って、ローカルの `supabase-config.js` を作る
4. `auth.enabled: true` と `sync.autoSaveKoshien: true` の設定
5. `service_role` keyが混入していないか確認
6. アプリ側の構文チェック
7. Supabase接続後のログイン/保存エラー文の改善

## Codexへ渡してよい情報

- Project URL
- anon public key
- 管理者ユーザーのUser ID

## Codexへ渡してはいけない情報

- service_role key
- Supabaseアカウントのパスワード
- メール認証リンク
- ワンタイムパスコード

## 最短手順

1. あなたがSupabaseプロジェクトを作る
2. あなたが `schema.sql` と `rls-policies.sql` をSQL Editorで実行する
3. あなたがEmail Authを有効化する
4. あなたが管理者ユーザーを作る
5. Project URL、anon public key、管理者User IDをCodexへ渡す
6. Codexが `supabase-config.js` とseed用SQLを整える
7. あなたがseed用SQLをSQL Editorで実行する
8. アプリでログイン、甲子園保存、RLS確認を進める
