# #59 汎用順位予想 v1 — 検討用契約（未承認・未接続）

既存の `rankingOdds` の計算を基準にした試作。実アプリには import せず、甲子園ルール・得点・DBを変更しない。

## 確認済みの既存挙動

- 正順位は 10 / 7 / 5 / 3 pt、順位違いでも上位4候補なら2pt、圏外0pt。それぞれ予想に保存された倍率を掛ける。空の予想は0。現行ローカルUIでは予想者の倍率入力も可能。
- 本番 events / predictions / results / scores は競技非限定の event_id を持つ。predictions は event_id + user_id、results は event_id、scores は event_id + player_id が一意。現存eventはkoshienのみ。
- events.status は draft/open/resultWait/finalized/archive を許容。現行 is_prediction_open は open、締切NULLまたは未来、現クラブ所属。is_prediction_public は所属かつ resultWait/finalized/archive または締切到達。よって管理者が締切前にstatusを変更すると公開条件が成立する。新形式では絶対締切を必須にし、受付開始後の変更と早期公開をDBで防ぐ必要がある。
- predictions は本人・受付中RLSでDML可能だがpayloadの候補・点数・倍率の検証なし。results と scores はadmin直接DML可。既存のfinalization guardと得点再計算はkoshien限定。これらを汎用化したと見なさない。RLSのみでは不十分。
- スコア保存は player_id を要求するが予想は user_id を使用。新形式のランキングはサーバーで所属・参加者を照合し、会員の改名・退会を含めた保持仕様が必要。

## 提案（承認前・実装本体に反映しない）

- event.rules 内に version付き設定: 候補 {id,label,multiplierTenths}。候補の名称をIDにしない。4〜128候補、ID最大64文字、表示名100文字、重複禁止。倍率0.1〜100（整数tenths）。これら上限は暫定で変更可。
- 管理者が倍率を受付前に設定して固定する方式を提案。旧ローカルUIの自由入力とは異なるため要承認。予想者から倍率・得点・所有者を受け付けない。
- predictions.payload: {version:1,candidateIds:[4つの異なる候補ID]}。結果も同型。4枠完了必須は新形式の提出条件案であり、旧ローカルの部分入力は変更しない。
- 得点基礎は既存式のまま。小数誤差を避け scoreTenths に整数化。検証コードは既存式を抽出して比較し、正常入力の点数一致を検証する。
- 今回は純粋関数のみ。サーバー側を実装する場合は確定済みルール・倍率・締切・候補の不変性、revision、同一クラブの本人ID、ロックと権限の検証を原子的に実行する。ブラウザから送られたscoreを正本にしない。
- 受付前のルール編集、受付後の締切変更不可、結果確定・再開・退会の監査、同点順位、未提出者の扱い、公開範囲は次段階で仕様決定。現状の直接DML経路を放置してオンライン化しない。
- 実DB変更とデプロイはバックアップ確認・明示承認後のみ。新しい有料サービスなし。

検証: `node --test tests/ranking-v1-contract.test.js`。試作は `prototypes/ranking-v1/contract.cjs` に隔離。

## 保存・公開制御の隔離試作（未承認）
`prototypes/ranking-v1/save-visibility.sql` は migration ではない。新しい識別子 ranking_v1 のみ対象とし、既存 rankingOdds ローカル型や甲子園を切り替えない。draft→open→締切後resultWait の最小範囲。直接INSERT/UPDATEでも締切・候補・倍率・本人・所属を検査し、受付開始後はルール・締切を固定する。既存公開RLSにrestrictive SELECTを重ねる。結果・得点の書込および大会削除は暫定的に拒否し、未実装の確定・再開・退会を許可した扱いにしない。
実際の本番RLS条件を反映した合成fixtureで検証。完全な本番schema、並行トランザクション・ロック競合・退会やクラブ削除、実HTTP、確定処理は未検証。draft→open時のレビューrevisionや安定IDによる冪等作成も次段階。新規受付制御の時計はDBのclock_timestampを使用するが、既存RLSのnow()により長時間トランザクションでは公開が遅れる可能性がある。実DBに適用しない。

### 並行処理の検証追加
CIで同じ合成fixtureを専用DBにのみコミットし、独立したpsql接続で実際の親行ロック競合(55P03)、再試行、締切前に開始した長時間トランザクションのnow()と実時計の差、受付済み保存と締切後の状態遷移の直列化を検証する。締切判定は保存時点、確定待ち遷移は親行ロックの解放を待つ。所属変更との競合、結果確定、HTTP統合、完全な本番schemaは引き続き未検証。本番接続なし。

## サーバー側結果確定の隔離試作（未承認）
`finalize.sql` は保存制御に追加する試作。既存 scores.player_id は本番の players(league_id,profile_id) 一意制約を利用して解決する。提出者のみ採点し、退会後も歴史的playerが残る場合は集計対象にする案（未承認）。未提出者・同順位の順位表示は別仕様。締切後 resultWait の管理者にのみレビューrevisionと確定RPCを公開。親行・実行者の所属・対応player行をロック。保存された予想と候補倍率でSQL計算し、結果・点数・private receipt・状態変更を同一トランザクションで書込。同一revision+同一結果の再試行は既存receiptを返す。異なる結果や直接DML、早期確定、監査なしの再開は拒否。強制的な途中失敗で全書込とpermitが消えることを隔離テストする。実アプリ、実Auth/HTTP、全本番制約、所属削除/クラブ削除競合、確定競合試験は未完。削除/再開運用は未承認のためブロックしたまま。正式migrationではない。

### 得点実装の照合・確定競合
`verify-ranking-v1-score-parity.cjs` は実SQLと既存JS試作エンジンの全720ケースの得点・明細一致を確認する（6候補から4つの順列360×結果2パターン、倍率境界を含む）。独立DB接続から同一reviewの確定RPCを同時に実行し、後続が親行ロックを待ち、同一receiptを回収することも検証。DBは使い捨てCIのみ。実アプリには未接続。

## 所属変更・履歴保護（隔離試作）
`membership-integrity.sql` は予想の保存時に現在の有効所属行をロックし、historical playerの複合FKをprivate bindingに保存する案。表示名変更や退会時の匿名化を許容しながら、予想を保持したplayerのID・所属・profile付け替えや削除を拒否する。既存のクラブ削除は未承認につきランキング大会がある場合は引き続き拒否し、部分削除は許さない。本番から取得した5関数（退会匿名化、owner退会拒否、会員削除、owner確認、クラブ削除）を合成fixtureに再現。直接SQLによる架空auth.users削除と所属解除の並行試験で確認する。実Auth endpoint、完全schema、全既存FK/triggerとの互換性、監査付き削除/再開は未検証。実DBに適用しない。

## 接続API試作（未承認・本体未接続）
`api.sql` は同一クラブ・大会・期待actor IDをサーバーで照合し、一覧（上限100、超過通知）、本人予想保存、単一statementの表示snapshot、管理者review/finalizeを提供する。既存RLS・トリガーは維持。snapshotは締切前に他者予想を返さず、結果確定後のランキングはDB保存値を使用。公開予想はhistorical player ID/表示名で返し、他者auth UIDを追加返却しない。同点は競技順位方式（1,1,3）を暫定採用、公開snapshot上限200人は暫定で超過時拒否。`api-client.cjs` は既存契約検証を再利用し、選択世代・actor・club・event IDを前後照合。通信失敗時にローカル保存や自動再試行へ切り替えない。実際のRPCは未公開。新規大会作成・受付開始・締切処理の専用API、実Auth/HTTP、画面接続、監査付き再開/削除は今後。既存の直接DML保護は試作の範囲に限る。

## 大会管理API試作（未承認）
`management.sql` を `api.sql` の後に適用する隔離検証。作成用UUID v4/v8は呼出側が保持し、同一ID・作成者・完全一致するdraft内容のみ復旧。異なる内容や他クラブのID衝突は拒否。管理者の編集・受付開始はDB revisionで確認し、直接DMLをprivate permitで拒否。受付開始後は既存ルール固定を維持し、締切到達後のみclose（resultWait）を実行。同じrevisionの受付開始・同じcloseの再試行は既存状態を返す。名前120文字・競技コード32文字は暫定。作成IDは同一操作内で保持する必要があり、別端末の別IDによる重複を自動排除する仕様ではない。編集通信失敗後は再読込して確認する。管理APIを実際のアプリへ接続していない。監査付き再開・削除、実HTTP/Auth、完全な本番schemaの検証は未完。本番適用不可。

管理APIの並行試験を追加。同一UUID・作成入力の同時createでは一つのdraftのみ生成されること、編集トランザクション中に開始された旧revisionのopenは編集commit後に拒否されること、最新revisionで開いた後の編集は拒否されることを実DBの独立接続で検証する。対象は使い捨てCIのみ。

## 実HTTP統合試作
GitHub Actionsの使い捨てDBで、既存の固定バージョンSDK 2.119.0、PostgREST v12.2.3、GoTrue v2.189.0を再利用。GoTrueは別の使い捨てDBとし、実signup/login発行のUIDをランキングfixtureのauth.users/profiles/membership/playerに合成登録する。10 RPCを実SDKから通し、2人の予想、締切、確定、ランキング、同一ID/revision再試行、別クラブ、署名不正・期限切れJWT、匿名、除名後のアクセス、セッションrefresh/再取得を確認する。既存甲子園fixtureの指紋比較も行う。Auth triggerや実本番のメール/OAuth/完全schema、ブラウザUIはこの試験の対象外。外部ネットワークはSDK/固定Dockerイメージの取得のみ。本番接続なし。

初回HTTP CIで以前のPostgREST digestがregistry not found。v12.2.3タグを取得後、実際のRepoDigestをログに記録して同一実行内で固定する方式に変更。取得できない場合は停止する。恒久的なdigest固定は実際の取得結果を確認後に行う。

## HTTP競合エラーの修正
実HTTPで古いrevisionのopenが10秒でタイムアウトしたログと、PostgRESTの40001再試行仕様を照合した。業務上の決定的な競合（作成内容不一致・編集/開始revision不一致・確定review不一致・確定結果不一致）に限り `PT409` を返す。実際のDB serialization failureは変更しない。https://supabase.com/kb/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b および https://docs.postgrest.org/en/v12/references/errors.html を参照。HTTP拒否応答の速度・状態不変・確定後の異なる結果拒否も検証する。本番未適用。既存甲子園コードは対象外。

## 画面接続準備：表示モデルと操作制御
既存 `app.js:renderRankingOddsForm` は全参加者の予想・倍率を入力でき、`confirmSave` はローカル保存、ランキングは端末計算。オンライン形式にそのまま流用しない。`view-model.cjs` はサーバーのsnapshotから候補、本人予想、公開予想、確定得点と内訳、許可された操作だけを生成。名前はHTMLではなくプレーンテキスト。サーバーの確定得点を再計算しない。`controller.cjs` は scope generation、操作中の重複拒否、明示review（結果とrevisionの固定）、サーバー応答後の再読込、失敗時の画面データ無効化を担当。書込応答確認後に再取得が失敗した場合と、書込そのものが未確認の場合を区別し、自動再送やローカル保存に切替えない。選択変更・ログアウト時にselectを呼ぶ必要あり。作成IDは呼出側が保持する従来契約のまま。単体試験と既存GoTrue/SDK/PostgREST統合試験で同じcontrollerを利用する。既存画面、HTML、CSS、本番DBは変更していない。実ブラウザの描画とイベント結線・認証ライフサイクル・作成ID永続化・仕様承認は未完。

### 独立ブラウザ画面の試作
`panel.cjs` は既存画面に未接続の最小DOMパネル。本人予想（4枠・重複拒否）、公開予想、管理者の受付開始確認・締切処理・結果確認・明示確定、確定ランキングの表示に対応。DOMはtextContentで生成し、候補名や表示名をHTMLとして扱わない。画面側の権限制御はサーバー検証の代替ではない。`verify-ranking-v1-browser.cjs` は同じcontrollerを固定module allowlistで読み込み、実Chromeとmock RPCにより操作・表示・ログアウト後の破棄を検証。実HTTPは別の既存統合試験。新規大会作成・設定編集フォーム、実アプリ内ナビゲーション・認証配線・端末実機E2Eは未完。本番HTML/CSS/JSへの接続やデプロイは行わない。

### 設定編集フォーム
`draft-form.cjs` は候補IDを名称と分離した作成/編集フォーム。倍率は整数tenths、日時は明示タイムゾーン。既存候補の改名でIDを変えず、受付開始review中の編集フォームでは開始ボタンを隠し、保存後はreviewを再取得する。描画世代とDOM所属を照合し、取り外したボタンから旧reviewを実行しない。実Chrome mock RPCで編集と既存操作を検証。実アプリへの接続は未完。
