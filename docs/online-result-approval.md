# オンライン甲子園の結果承認：確認結果と実装境界

基準HEAD d69a64d933da9abce71d2e2c37af5d53692f3d9e / 2026-11-15。

## 確認した問題
app.jsのsubmitResults/approveResults/finalizeResultsIfReadyはローカルstateを変更しrender→persistするだけで、RPCを呼ばない。
approveResultsは渡された参加者名を投票者として扱う。これは端末共有のローカル運用の動作であり、オンライン本人確認ではない。
js/data-service.jsのsaveKoshienSnapshotは、新規event作成時にはrules.resultFlowを含めるが、既存event更新はname/status/prediction_deadlineのみ。承認履歴がオンライン共有されないままstatusだけ保存される経路がある。
本番では48試合完了、status=resultWait、rules.approvalPolicy=admin、rules.resultFlow.status=noneを読取り確認。結果確定を自動実行していない。

## 今回の限定修正
オンライン保存が有効な甲子園では、ローカルだけの提出・承認・自動確定を実行しない。
未確定大会の操作欄には共有未対応を明記し、提出・代理承認のコントロールを出さない。受付中は元どおり非表示。
ローカルモード、他競技、試合結果保存、既存の確定取消RPCは変更しない。
これは誤表示/ローカル不整合の防止であり、DB側の認可実装ではない。既存キャッシュや保存済み状態を自動修復しない。

## 回帰検証
実関数をVMで実行。修正前にオンライン提出・他人名承認の2件でローカル確定を再現。
修正後はオンライン操作の状態不変、キャッシュ投票での自動確定防止、ローカルの承認閾値到達、他競技維持、オンライン操作欄のメッセージとコントロール不在を検証。
実ブラウザでの認証済み画面操作は未実施。PR/CI結果を最新記録とする。

## 次の1件：サーバー側の提出・承認契約
次回は結果提出・承認RPCと保存モデルの具体設計を行う。次の条件を一つのtransactionで扱う:
- eventをロックし、activeな所属とauth.uidを検証。提出/取消は管理者、承認は本人のみ。
- 表示名ではなくprofile UUIDで承認を一意化。参加者名引数を本人識別に使わない。
- 提出時の結果versionと承認対象versionを固定。結果訂正/取消後は古い承認を再利用しない。
- 管理者/半数/全員の閾値、提出者の一票扱いを既存動作に合わせ、所属変更時の母集団を明文化する。
- 全試合/決勝スコア/保存済み得点の整合確認後だけ確定。30点の採用条件は変えない。
- resultWait→submitted→finalized、重複承認、同時実行、退会、他クラブ、未完了試合、結果改訂の隔離DBテスト。
- 共通snapshot保存でサーバーの承認状態を上書きしない。RLS/UPDATE経路も併せて保護。
この設計と実装・隔離検証が揃うまで共有承認UIを有効にしない。

## 復旧
今回のUI/ローカル関数ガードをrevert可能。DB migration・データ更新なし。
ただし戻すと共有されない承認表示が復活するため、恒久RPC導入時に置き換える。

## 2026-11-15：承認RPCの具体契約（未実装）

### 既存関数を確認した結果
本番の関数定義・trigger定義だけをSELECTで確認。ユーザー予想・結果の試験書込みなし。
- `koshien_result_version(text)`は完了試合の`extract(epoch from updated_at)::bigint`の合計。秒以下の丸め、日時の入替え、未完了試合の追加、同一transaction内の`now()`更新を識別できない。承認対象を保証するtokenに流用しない。既存利用者の互換性のため、この関数自体は変更しない。
- `save_koshien_result_snapshot`は管理者チェック後にmatches/scores/resultsを更新するが、eventsのSELECTにFOR UPDATEがない。承認RPCだけのeventロックでは結果保存を直列化できない。
- matchesのtriggerは結果訂正制約・外部取得状態・後続ラウンド更新。eventsのtriggerはupdated_atとテスト大会マーカー保護。承認revisionの更新は存在しない。
- scoresは`recompute_koshien_current_scores`のBEFORE INSERT/UPDATEで再計算される。クライアント集計値を承認の正とせず、この再計算経路を維持する。
- `reopen_koshien_results`はevent行をFOR UPDATEし管理者を確認、旧eventを監査表に保存してresultWaitへ戻す。新しい承認提出も同時に無効化する改修が必要。

`tests/sql/koshien-result-version-contract.sql`は取得した既存関数の同じSQLを最小fixtureで実行する。衝突を「期待される既存動作」として固定し、新RPCが依存してはいけない理由を再現する。実際の全triggerや保存RPCの統合試験ではない。

### 保存モデル案
既存rules.resultFlowの表示名キーを本人の証拠へ変換しない。履歴の移植・自動確定はしない。
- event単位のサーバー管理`approval_revision bigint`を設ける。承認対象変更で単調増加し、A→B→Aでも古い承認を復活させない。内容hashだけではこの条件を満たさない。
- submissions: id UUID、event_id、revision、policy、eligible_user_ids UUID[]、required_count、submitted_by UUID、status、submitted_at、finalized_at。eventごとの有効submittedは一つ。
- votes: submission_idとvoter_user_idの複合PRIMARY KEY、approved_at。認証UIDをサーバーで設定し、名前/他人UUIDを引数にしない。
- submissionには承認時の結果/再計算得点のsnapshotを保存する。revisionが排他制御、snapshotが監査説明用。全予想の閲覧許可を広げない。
- private schema（PostgREST非公開）に配置し、クライアントの直接DMLを許可しない。公開RPCはSECURITY DEFINER、空search_path、明示的なauthenticated EXECUTEのみ、PUBLIC/anonは拒否。状態読取も所属を検証し、副作用なしとする。

### RPCと状態遷移
- `submit_koshien_results(event_id, expected_revision)`: activeなリーグ管理者のみ。大会行をロックし、未確定・全対象試合完了・決勝結果・締切経過・phase状態・再計算得点整合を検証。同じrevisionでも新submission IDを発行。提出者本人の一票を記録。
- `approve_koshien_results(event_id, submission_id, expected_revision)`: activeな所属、提出時の有権者集合に本人UIDがあること、現在のrevision/提出ID一致を確認。重複投票は同じ結果を返す。必要数到達時のみ同一transactionでsubmissionとeventsをfinalizedにする。
- `reopen_koshien_results(event_id)`: 現行の監査保存を維持し、submissionを無効化、revisionを増加、resultWaitへ戻す。
- 閾値は既存どおりadmin=1、half=ceil(n/2)、unanimous=n。nは提出時のactiveな参加者本人UID集合。playersとauth UIDの対応・管理者が参加者でない場合は次工程で実スキーマと仕様を照合し、暗黙に人数へ加えない。
- 有権者の加入/脱退/権限変更、approvalPolicy変更は提出無効化→再提出とする案。固定集合のまま退会者票を残す/残人数で勝手に閾値を下げる動作は採用しない。
- 拒否時はtransaction全体をrollbackし、revision/得点/票を部分更新しない。stale_submissionは再読込を促し、自動再投票しない。

### 排他制御と迂回経路（実装前の必須条件）
更新と承認が共通してevent行を先にロックすること。既存snapshot RPC、自動取得apply、試合取消、後続ラウンドtrigger、直接DML、得点再計算、所属変更を列挙して対応する。
matchesの行ロック後にeventをロックするtriggerを単に追加すると、承認側のevent→matches順と逆転するため、そのまま実装しない。直接DML権限を限定しRPC側のロック順をそろえる変更と、既存利用経路の互換テストを一組にする。
eventの汎用UPDATEからfinalized/rules.resultFlowを上書きできる状態も残さない。SECURITY DEFINERであることだけでは防げない。
試合追加/削除/取消、結果訂正、得点根拠の予想/ルール変更は承認revisionの対象。updated_atだけの変更や取得ログは対象外にできるが、実際の依存列確認後に絞る。

### 検証・リリースゲート
次の実装単位は「承認revisionと全結果更新経路のロック/無効化」。RPC/UI全体を一括投入しない。
隔離DBで実関数を使い、未認証/他クラブ/非管理者、締切前/境界、未完了/決勝なし、二重投票、提出と訂正の同時実行、A→B→A、取消→再提出、退会、汎用UPDATE迂回を検証する。2接続による競合試験が必要。
現時点では承認RPC・認可/RLS・競合試験は未実装。既存SQLの衝突再現成功を新RPCの安全性検証と扱わない。PRはdraft、本番migration/merge/deployなし。

## 2026-11-15：更新番号の内部試作

`supabase/prototypes/koshien-approval-revision.sql`に内部更新番号管理を実装。migrationではなく、本番への適用対象外。
- `lock_revision`はevent行→revision行の順にロックし、未作成なら0を作成。読取り専用ではない。
- `advance_revision`は期待番号を必須とし、不一致を40001で拒否。変更と同じtransactionで呼ぶことでrollback時も番号を戻せる。コミット済み変更は単調増加し、内容を元へ戻しても以前の番号を再利用しない。
- 空search_path、SECURITY INVOKER、PUBLICのschema/table/function権限剥奪。外部公開RPCやtriggerは追加しない。本人・所属・締切の判定を代行する関数ではなく、認可済みサーバー処理だけが使う部品。
- 既存の結果保存/取消/自動取得からはまだ呼ばない。したがって本番の競合防止・承認無効化は未完了。実際のSupabase既定権限/既存rolesでのACL検証も本番化前に必要。

`scripts/verify-approval-revision.py`は使い捨てローカルDB名を固定し、既存CIのPostgreSQLで実SQLを検証。初期値、更新、古い番号/不正引数/不存在/別競技の拒否、rollback、二段階更新、非特権roleからの直接操作拒否を確認する。2接続で同じeventのロック競合、別eventの独立更新、commit後の古い番号拒否も確認する。CIは終了時にテストDBを削除。
このテストは更新番号部品の契約であり、未実装の承認本人確認・締切・全保存経路の統合テストではない。

次の1件は既存`save_koshien_result_snapshot`へのevent先行ロックとrevision更新の組込み、およびその実関数を使った認可/整合性/競合テスト。全更新経路の対応が揃うまでmigration化/本番適用しない。

## 2026-11-15：結果保存RPCへの試作組込み

`supabase/prototypes/koshien-result-write.sql`は本番からSELECT取得した`save_koshien_result_snapshot`の定義に、管理者確認直後の内部`begin_result_write`呼出を追加した試作。既存のSECURITY INVOKERとpayload検証を維持し、保存全体をSECURITY DEFINERに変更しない。
内部関数のみSECURITY DEFINERとし、auth.uid/active owner・co_owner確認→event/revisionロック→再認可→revision更新。authenticatedにはこの入口のEXECUTEだけを付与し、素のlock/advance/tableへの権限は付与しない。公開schemaに新RPCを追加しない。管理者が内部入口だけを呼んだ場合もrevisionは進む（不要な承認無効化に留まり、結果の書込みや確定はしない）。
失敗時は同じtransaction内のrevisionもrollbackする。result保存の締切条件は変えず、予想締切の前後で既存の管理者保存を維持する。

隔離fixtureでは実際の保存関数本体を実行し、未認証/一般参加者/他クラブ管理者/退会管理者/anonの拒否、正常な試合・得点行・results保存、payload不正と保存先RLS拒否時のrevision/results不変を検証する。得点再計算triggerを含む本番全schemaの再現ではない。既存revisionの2接続競合試験も継続する。
未完: 自動取得/取消/直接DML/後続trigger等の全更新経路統一、実際の保存RPC同士の2接続競合、所属変更の並行実行、提出/voteの実装、全本番ACL/得点trigger統合。migration化・本番適用はしない。
次の1件は保存RPC同士の2接続競合と、他の結果更新経路を同じevent先行ロックにそろえるための差分実装。

## 2026-11-15：保存RPC同士の2接続検証

`scripts/verify-result-write-concurrency.py`で内部部品だけでなく、試作の`save_koshien_result_snapshot`本体を2つの認証済み・非bypass接続から実行する。
先行保存を未commitで保持し、後続保存がそのbackend PIDにブロックされていることを`pg_blocking_pids`で確認する。同時に別大会を保存できることも確認。
先行commitの場合は両保存分のrevision=2、先行rollbackの場合は後続分だけ増えてrevision=3となり、最終試合スコア/resultsは後続保存の内容と一致することを検証する。固定sleepを実行順の根拠にしない。
試験DB以外は受け付けずローカルsocketに固定。接続は失敗時も終了し、cluster共通の試験roleを明示削除、DBは既存CIのtrapで削除する。

対象は最小依存fixtureでの保存RPC競合。実際の採点trigger・後続ラウンドtrigger・所属変更競合・自動取得/取消/直接DMLを含む全経路ではない。migration化/本番反映なし。
次の1件は結果取消RPCの実定義を確認し、event先行ロックとrevisionを同じ試作へ組み込み、保存との競合・拒否時の整合性を検証する。
