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
