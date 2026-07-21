# Supabase 移行計画

## 方針変更

これまでの短期案は Google Sheets + Google Apps Script でした。今後の主方針は次の構成に変更します。

- フロントエンド: 現在の GitHub Pages
- バックエンド: Supabase
- データベース: Supabase Postgres
- 認証: Supabase Auth
- 最初のオンライン化対象: 夏の甲子園プリセットのみ

Google Sheets関連のコードとドキュメントは削除しません。現時点では試作・保留ルートとして残します。

## 現在の保存形式

既存アプリは次のlocalStorageキーを使います。

- `yoso-league-state-v1`: 大会、参加者、予想、結果、接続設定を含むアプリ状態
- `yoso-auth-users-v1`: ローカル簡易アカウント
- `yoso-auth-session-v1`: ローカル簡易セッション

今回の移行ではこれらを破壊しません。`persist()` は引き続き `yoso-league-state-v1` に保存します。

## 第1段階で実装した範囲

- Supabase用のテーブル定義
- Supabase Authのブラウザ接続ラッパー
- RLSポリシー
- ローカル保存を残す data-service 層
- 甲子園イベントをオンライン保存できる `saveKoshienSnapshot` の土台
- 管理者は甲子園の大会、出場校、結果を保存
- メンバーは自分の甲子園予想だけ保存

## 第1段階でまだ実装しない範囲

- 既存UIの大幅変更
- Google Sheets機能の削除
- W杯など他プリセットのオンライン化
- 全localStorage状態の一括Supabase移行
- 甲子園のオンライン読込UI
- 甲子園の管理画面からのSupabase直接読込/編集UI
- メールアドレス前提のAuth UI刷新

## データ対応方針

既存の `state.event` はSupabaseでは主に次へ分解します。

- `events`: 大会本体。`preset_type = 'koshien'` とし、締切、状態、ルールJSONを保持
- `event_teams`: 甲子園の代表校リスト
- `predictions`: ユーザーごとの予想JSON。`event_id + user_id` を一意にする
- `results`: 管理者が入力する結果JSON

甲子園の `payload` は当面、既存localStorageの予想形に近いJSONを保存します。

```json
{
  "teams": ["校名1", "校名2"],
  "captain": "校名1"
}
```

## 権限制御

RLSは次を満たす方針です。

- authenticatedユーザーだけが利用できる
- 所属リーグだけ閲覧できる
- 管理者だけが大会、出場校、結果を作成・更新できる
- 自分の予想だけ作成・更新できる
- 締切後は予想を更新できない
- 管理者でも他人の予想を更新できない
- 締切前の他メンバー予想はSELECTできない

画面で隠すだけではなく、`predictions_select_owner_or_public` ポリシーでDB側の取得も止めます。

## 次の甲子園オンライン化タスク

1. `supabase-config.js` に実プロジェクトのURLとanon keyを入れる
2. Supabase SQL Editorで `schema.sql`、`rls-policies.sql` を実行する
3. 最初の管理者ユーザーをSupabase Authで作る
4. `seed.sql` の `ADMIN_USER_ID` を置き換えて甲子園リーグと大会を作る
5. 甲子園管理画面から `events` と `event_teams` を読込・更新する
6. 参加者の予想保存を `predictions` に接続する
7. 締切前後で他メンバー予想が取得できない/できることをRLSで検証する
8. 結果入力を `results` に接続する
9. localStorageからSupabaseへ初回移行する明示ボタンを用意する

## 実装メモ

`sync.autoSaveKoshien` を `true` にすると、`persist()` の後に甲子園イベントだけSupabase保存を試みます。

- Admin: `events`、`event_teams`、`results`、自分の `predictions` を保存
- member: 既存の `events` に対して自分の `predictions` だけ保存
- memberが先に保存しようとしてイベントが存在しない場合はスキップ

この分離により、UIで隠すだけでなくRLSとフロント保存処理の両方で「管理者だけ大会・結果」「本人だけ予想」を守ります。
