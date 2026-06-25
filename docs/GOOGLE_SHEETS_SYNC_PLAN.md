# Google Sheets 同期計画

最終更新: 2026-06-18

## 目的

今月末までの仲間内テストでは、GitHub Pagesで配信しているYOSOアプリからGoogle Apps Scriptを呼び出し、Google Sheetsを共有データ置き場として使います。

本格的な認証基盤を作る前に、友達同士で同じ大会、予想、結果、ランキングを共有できる状態を目指します。

## 想定構成

```text
GitHub Pages
  -> Google Apps Script Web App
    -> Google Sheets
```

アプリ本体は静的HTML/CSS/JSのままです。サーバーの代わりにApps Scriptを小さなAPIとして使います。

## 現在入っている足場

- 設定画面に「データ接続」セクションを追加済み
- 保存モードは `この端末のみ` と `Google Sheets準備`
- Apps Script URLとSpreadsheet IDを保存可能
- ホーム画面の保存先表示が接続設定に連動
- 現在のローカルデータをJSONとしてコピー可能
- `Sheetsへ保存` と `Sheetsから読込` のMVP導線を追加済み
- `接続テスト` でApps Scriptから対象Spreadsheetを開けるか確認可能
- Apps Scriptテンプレートを `scripts/google-sheets-web-app.gs` に追加済み

保存は `no-cors POST`、読み込みと接続テストはJSONPで行います。GitHub Pagesの静的アプリからApps Scriptへ直接アクセスするためのMVP方式です。保存後は読み戻し確認を行い、リクエストを送っただけで成功扱いにしないようにします。

## Google側で必要な手動作業

この部分だけは、ユーザーのGoogleアカウントで行う必要があります。

1. Google Sheetsを新規作成
2. スプレッドシートIDを控える
3. Apps Scriptを開く
4. `scripts/google-sheets-web-app.gs` の内容を貼り付ける
5. Webアプリとしてデプロイ
6. 実行ユーザー: 自分
7. アクセスできるユーザー: リンクを知っている全員、または全員
8. 発行されたWebアプリURLをYOSOの設定画面に貼る
9. Spreadsheet IDとLeague IDを入力
10. `接続テスト` を実行
11. `Sheetsへ保存`、別端末で `Sheetsから読込` を確認

Apps Scriptエディタ上部の「実行」ボタンは、URLパラメータなしで関数を直接実行するため、同期テストには使いません。確認は必ずデプロイ後のWebアプリURL、またはYOSOアプリ側の `接続テスト` から行います。

接続テストで失敗する場合、まずApps Scriptのデプロイ設定を確認します。

- 実行ユーザー: 自分
- アクセスできるユーザー: 全員
- URLは編集画面URLではなく `/macros/s/.../exec` で終わるWebアプリURL
- スクリプト更新後は「デプロイを管理」から新しいバージョンとして再デプロイ

## 現在のMVP制約

- Googleログイン認証とは連動しません
- Apps Script URLを知っている人はAPIを呼べるため、仲間内テスト向けです
- 保存は状態全体を1レコードとして上書きします
- 複数人が同時編集した場合は、最後に保存した内容が勝ちます
- 本格運用やApp Store展開ではSupabaseなどへの移行を検討します

## 最初のAPI案

まずはシンプルに、アプリ状態を丸ごと読み書きする方式で始めます。

### `GET ?action=getState&spreadsheetId=...&leagueId=...&callback=...`

返すもの:

```json
{
  "ok": true,
  "version": 1,
  "updatedAt": "2026-06-18T00:00:00.000Z",
  "state": {}
}
```

### `POST action=saveState`

送るもの:

```json
{
  "leagueId": "g-unit",
  "clientId": "browser-generated-id",
  "updatedAt": "2026-06-18T00:00:00.000Z",
  "state": {}
}
```

返すもの:

```json
{
  "ok": true,
  "updatedAt": "2026-06-18T00:00:00.000Z"
}
```

## スプレッドシートの最小タブ案

最初は壊れにくさを優先して、正規化しすぎず、JSON保存を中心にします。

- `state`: リーグ単位の最新アプリ状態
- `audit_log`: 保存履歴
- `members`: 参加者の表示名、権限、メモ

将来、細かい集計や監査が必要になったら以下を分離します。

- `events`
- `predictions`
- `results`
- `phase_status`

## 競合ルール

初期版は `updatedAt` の新しい方を採用します。

管理者が結果やフェーズ状態を更新する操作は、将来的に `audit_log` に必ず残します。

## 注意点

- 現在のローカル認証は本物のオンライン認証ではありません。
- メールアドレスは任意で、現時点ではパスワードリセットメールを送りません。
- Google Sheets同期を入れても、強い本人確認や権限管理が必要ならSupabase/Firebaseなどの認証基盤を検討します。
- App Store公開を見据える場合、オンライン同期を有効にした段階でプライバシーポリシーとデータ削除方針を用意します。

## 次の実装タスク

1. 実Google Sheetsで同期MVPを確認
2. 保存前バックアップを強化
3. 競合表示を追加
4. 甲子園プリセットで端末A/Bの共有テスト
5. GitHub Pagesへデプロイしてスマホで確認
