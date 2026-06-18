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

まだ実際の同期通信は行いません。次の実装でApps Script APIに接続します。

## 最初のAPI案

まずはシンプルに、アプリ状態を丸ごと読み書きする方式で始めます。

### `GET ?action=getState&leagueId=...`

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

1. Apps Scriptの `doGet` / `doPost` を作る
2. `state` と `audit_log` タブを作る
3. フロント側に `syncFromSheets` / `syncToSheets` を追加
4. 設定画面に「同期する」「Sheetsから読み込む」を追加
5. 同期中、成功、失敗、競合の表示を追加
6. GitHub Pagesへデプロイしてスマホで確認
