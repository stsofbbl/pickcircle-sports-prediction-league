# YOSO 夏の甲子園2026 フェーズ2ドラフト実装仕様

更新日: 2026-07-21

## 1. 文書の責務

この文書は、夏の甲子園2026「フェーズ2・ベスト16スネークドラフト」の実装仕様の正本である。ゲームルールの正本は [`KOSHIEN_2026_RULES.md`](KOSHIEN_2026_RULES.md) とし、この文書ではルール全文や得点表を重複させない。

フェーズ2の得点計算は正式ルールの固定得点を参照し、平方根オッズ、キャプテン倍率、特典カードを適用しない。本仕様の中心は、順序の固定、1指名の原子的保存、端末間復元、権限制御である。

## 2. 用語と識別子

保存、照合、権限判定には表示名や高校名を使用しない。

| 識別子 | DB型 | 用途 |
| --- | --- | --- |
| `event_id` | `text` | 既存 `events.id` と一致する大会ID |
| `player_id` | `uuid` | 既存 `players.id` と一致する参加者ID |
| `team_id` | `uuid` | 既存 `teams.id` と一致する高校ID |
| `draft_id` | `uuid` | フェーズ2ドラフト本体ID |
| `pick_no` | `integer` | 全体指名番号。1から16 |
| `draft_round` | `integer` | 巡目。1から4 |
| `request_id` | `uuid` | 1回の確定操作に対する冪等キー |

`players.display_name` と `teams.name` はUI表示だけに使用する。表示名の重複や変更は順序、所有者、権限、保存済み指名へ影響させない。

## 3. 状態遷移

`phase2_drafts.status` は次の5状態だけを取る。

| 状態 | 意味 | 移行条件 | 移行主体 |
| --- | --- | --- | --- |
| `not_ready` | 前提情報が未確定 | draft行を作成した直後 | リーグ管理者向けの運用経路。通常参加者は不可 |
| `ready` | 開始前提が全て固定済み | 16校、4人、暫定得点、同点抽選、順序、開始時刻、締切が保存済み | リーグ管理者向けの運用経路。開始UI確定まではレビュー済みSQL運用 |
| `drafting` | 指名受付中 | `ready` かつ開始時刻到達後に明示的開始 | 開始ボタン権限は未確定。今回のUIでは遷移させない |
| `completed` | 16指名完了 | 原子的保存RPCが16件目を成功させた時に自動移行 | DBのみ |
| `locked` | 運用確認後の固定状態 | `completed` の監査・確認後 | リーグ管理者向けの運用経路。今回のUIでは遷移させない |

逆向き遷移、`completed` 後の追加指名、`locked` の更新は通常の指名RPCでは許可しない。取消・再開は未確定事項として別仕様にする。

## 4. ドラフト開始条件

`ready` へ移す前に、次を全て満たす。

- 対象大会のベスト16進出校が16校確定し、`eligible_team_ids` として固定保存されている
- 対象リーグのプレイヤー4人が確定し、全員が `players.profile_id` を通じて認証ユーザーへ対応している
- フェーズ1暫定得点が4人分確定し、監査用スナップショットへ保存されている
- 同点グループの抽選結果を含む順位が一度だけ確定している
- `ordered_player_ids` がフェーズ1暫定順位の下位から上位、つまり4位から1位の順で4人分固定されている
- `starts_at` と `deadline_at` が設定され、`starts_at < deadline_at` である
- 既存指名が0件であり、`current_pick_no = 1` である

同点抽選の乱数は順序を作る時にだけ使用する。確定後は乱数や表示名から再計算せず、DBに保存した `ordered_player_ids` と順位スナップショットを全端末で読む。

## 5. スネーク順

`ordered_player_ids = [P4, P3, P2, P1]` とする。`P4` はフェーズ1暫定4位、`P1` は暫定1位である。同点の場合、この配列には確定済み抽選結果を反映する。

| 巡目 | `pick_no` | 順序 |
| --- | --- | --- |
| 1巡目 | 1-4 | P4, P3, P2, P1 |
| 2巡目 | 5-8 | P1, P2, P3, P4 |
| 3巡目 | 9-12 | P4, P3, P2, P1 |
| 4巡目 | 13-16 | P1, P2, P3, P4 |

`draft_round = floor((pick_no - 1) / 4) + 1` とする。現在手番は `current_pick_no` と固定済み `ordered_player_ids` だけから導出し、指名配列の長さや表示順から推測しない。

## 6. DBモデル

### 6.1 `phase2_drafts`

- `id uuid primary key`
- `event_id text unique not null`
- `status text not null`
- `ordered_player_ids uuid[] not null`。4位から1位の順、重複なし、要素数4
- `eligible_team_ids uuid[] not null`。ベスト16の固定スナップショット、重複なし、要素数16
- `ranking_snapshot jsonb not null`。`players` 4件（`player_id`, `phase1_score`, `resolved_rank`）、`tie_draws` 配列、`resolved_order_player_ids` を持つ監査情報。resolved orderは `ordered_player_ids` と一致させる
- `current_pick_no integer not null`。1から16。完了時も16を保持する
- `starts_at timestamptz`。`not_ready` だけNULL可。それ以外は必須
- `deadline_at timestamptz`。`not_ready` だけNULL可。それ以外は必須
- `version bigint not null`。状態更新ごとに増加
- `created_at`, `updated_at`

### 6.2 既存 `phase2_draft_picks` の拡張

既存テーブルを再利用し、次を追加する。

- `draft_id uuid not null`
- `pick_no integer not null`
- `request_id uuid not null`

既存の `event_id`, `player_id`, `team_id`, `draft_round` は維持する。既存のオッズスナップショット列は互換性のため削除しないが、フェーズ2得点には使わない。

必須制約は次の通り。

- `unique(draft_id, pick_no)`
- `unique(draft_id, team_id)`
- `unique(draft_id, player_id, draft_round)`
- `unique(draft_id, player_id, request_id)`
- `pick_no between 1 and 16`
- `draft_round between 1 and 4`
- `draft_id`、`event_id`、`player_id`、`team_id` のFKと対象整合性
- 頻繁に検索する `draft_id`, `event_id`, `player_id`, `team_id` のindex

既存行が存在する環境では、自動推測で `draft_id` や `pick_no` を割り当てない。migrationは安全に停止し、変換方針を人間が確認してから別migrationを作る。

## 7. 原子的な1指名保存RPC

RPC名は `save_koshien_phase2_draft_pick` とする。入力は `draft_id`, `team_id`, `expected_pick_no`, `request_id` だけとし、`player_id` と `draft_round` はDBが決定する。

処理順は次の通り。

1. `auth.uid()` が存在することを確認する
2. 対象draft行を `FOR UPDATE` でロックする
3. `auth.uid()` から対象リーグ内の `player_id` を解決する
4. 同じ `request_id` の成功済み指名があれば、payload一致を確認して最新状態を返す
5. `status = drafting`、開始時刻、締切、`expected_pick_no = current_pick_no` を確認する
6. 固定済み順序から現在手番と巡目を導出し、認証player本人と一致することを確認する
7. `team_id` が固定済みベスト16に含まれ、同一eventの高校であることを確認する
8. 高校の全体重複、playerの同一巡重複、playerの4校上限、pick_no範囲を確認する
9. 指名を1件insertする
10. 16件目以外は `current_pick_no` と `version` を更新する。16件目は `completed` へ移行する
11. 最新draft、順序、候補校、指名、所有者、viewer playerをJSONで返す

関数は `SECURITY INVOKER`、固定 `search_path` とする。`PUBLIC` と `anon` のEXECUTEをrevokeし、`authenticated` だけへgrantする。クライアントから渡された表示名、player ID、巡目を信用しない。

## 8. 排他制御と冪等性

次を同じDBトランザクションで保証する。

- 現在ターンのplayerだけが指名できる
- 固定済みベスト16だけを指名できる
- 同じ高校はdraft全体で一度しか指名できない
- 同一playerは同じ巡を二度指名できず、最大4校である
- `pick_no` は1から16で連続し、クライアントの疎な配列を信用しない
- 完了後、ロック後、締切後は追加できない
- draft行ロックと一意制約により、二重クリックや別端末同時指名は一方だけが新規成功する
- 同一 `request_id`・同一payloadの再送は既存成功結果を返す
- 同一 `request_id` で異なるpayloadは拒否する
- insertとturn更新は一体で、raw predictionだけが残る部分保存を作らない

RLSはリーグ参加者の読取、本人性、RPC経由の書込境界を担当する。RPCはロック、順序、時刻、候補校、重複、状態遷移、返却状態を担当する。一般のsnapshot保存や `predictions.payload` は正式ドラフトの書込経路にしない。

## 9. Data Service境界

公開APIは次の2つとする。

- `loadPhase2DraftState(eventId)`: DBの最新正式状態を取得する
- `savePhase2DraftPick({ eventId, draftId, teamId, pickNo, requestId })`: 1指名RPCを呼ぶ

同一draft・pickの送信中は二重送信を抑止する。同一payloadの再呼出は同じ処理結果を共有し、異なるpayloadの重複操作はクライアント側でも拒否する。DB conflict時は最新状態を再取得してエラーへ添付し、UIが正式状態へ戻れるようにする。

フェーズ1保存、試合結果保存RPC、汎用snapshot保存と混ぜない。フェーズ2確定操作から `saveSnapshot()` を呼ばない。

## 10. UI状態と失敗時の扱い

- ローカルstateは正式状態として扱わず、初期表示とリロード復元はDBレスポンスから構築する
- ベスト16の固定候補だけを表示する
- 現在の手番、全体pick_no、巡目、指名済み校、所有者、完了状態を表示する
- ログイン中player本人の手番だけ候補選択と確定ボタンを有効化する
- 保存中は操作を無効化する
- DB成功後だけレスポンスで再描画し、先にローカル指名を確定しない
- 失敗時はターンを進めず、エラーを表示し、最新DB状態を再取得して再試行可能にする
- 不正・疎・重複したDBレスポンスは画面状態として受理せず、明示的エラーにする
- スマートフォンで候補選択、確定、現在手番、指名履歴を確認できる最小レイアウトにする
- 既存の表示名キー `prediction.phase2DraftPicks` は正式DB指名へ投影しない。player ID・team ID基準の得点投影が完成するまで、旧ローカル値を正式フェーズ2得点へ加算しない

見た目の最終調整と実機UI完成判定は本仕様の完了条件に含めない。

## 11. 権限

- `authenticated` のみ利用可能、`anon` は不可
- 対象リーグ参加者はdraft状態と指名を閲覧できる
- 対象リーグに `profile_id = auth.uid()` で対応するplayer本人だけが自分のターンに指名できる
- `player_id` はRPC内で解決し、偽装用の入力欄を持たない
- 管理者代理指名は今回実装しない
- draft準備・開始・lockのブラウザUIは今回実装せず、権限決定後に別RPCとして設計する

## 12. テスト境界

- 純粋関数: 順位検証、同点検出、抽選注入、スネーク順、pick導出、候補抽出、payload検証、完了判定、DBレスポンス復元
- Data Service: RPC名・payload、送信中重複抑止、成功状態返却、conflict後の再取得、認証なし拒否
- migration静的検証: 制約、RLS、権限、`FOR UPDATE`、`auth.uid()`、原子的insert/update、非破壊性
- UIソース検証: 専用API利用、保存成功前のローカル確定禁止、保存中disabled、エラー表示

ローカルPostgresが利用できる場合だけRPCの実トランザクション競合テストを追加する。利用できない場合は静的SQL検証と、同時操作を模したData Serviceテストまでを実施し、未実行を明記する。

## 13. 未確定事項

次は推測で正式実装しない。

- 1指名あたりの制限時間
- タイムアウト時の自動指名
- 管理者による代理指名
- 指名取消、巻き戻し、再ドラフト
- draft作成・開始ボタンを誰に表示し、誰が押せるか
- `completed` から `locked` へ移す具体的操作
- push通知、メール通知、Realtime通知
- 4人以外、4巡以外への一般化
- 既存 `phase2_draft_picks` 本番行が存在する場合の変換規則
- 同点抽選のUI、監査表示、乱数生成方式
- 正式DB指名をplayer ID・team IDのまま結果・総合得点へ投影する読取境界

これらが決まるまで、今回のUIは既に準備・開始されたdraftを読み、本人の現在ターンで1校を確定する機能だけを持つ。
