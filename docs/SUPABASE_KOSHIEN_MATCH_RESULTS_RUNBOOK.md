# 夏の甲子園2026 試合結果保存 migration / 本番確認手順

この手順は、人間が内容を確認した後に Supabase 本番へ適用するためのものです。`service_role` key や DB password はブラウザへ入れません。

## 1. migration適用前の確認SQL

まず対象大会と件数を確認する。

```sql
select id, name, preset_type, status, updated_at
from public.events
where preset_type = 'koshien'
order by updated_at desc;

select 'results' as table_name, count(*) from public.results
union all
select 'matches', count(*) from public.matches
union all
select 'scores', count(*) from public.scores;
```

`matches` の実カラム、status制約、status値を確認する。

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name = 'matches'
order by ordinal_position;

select c.conname, c.contype, c.convalidated, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = 'public.matches'::regclass
order by c.contype, c.conname;

select status, count(*)
from public.matches
group by status
order by status;
```

`live` または `canceled` の行が1件でもある場合、migrationは意図的に停止する。各行を `scheduled` / `completed` のどちらへ移すか人間が確認してから更新する。migrationはこの意味変換を自動実行しない。

player名の重複と、対象大会でscoresへ対応できるplayerを確認する。

```sql
select league_id, display_name, count(*) as player_count
from public.players
group by league_id, display_name
having count(*) > 1;

select p.id as player_id, p.league_id, p.profile_id, p.display_name, p.is_admin
from public.players p
order by p.league_id, p.display_name;
```

RLSと権限を確認する。

```sql
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('events', 'results', 'players', 'teams', 'matches', 'scores')
order by tablename, policyname;

select relname, relrowsecurity
from pg_class
where oid in (
  'public.events'::regclass,
  'public.results'::regclass,
  'public.players'::regclass,
  'public.teams'::regclass,
  'public.matches'::regclass,
  'public.scores'::regclass
)
order by relname;
```

期待値は、全テーブルでRLS有効、同一リーグの参照を許可し、`teams` / `matches` / `scores` の書き込みはリーグAdminだけであること。

## 2. migration適用SQL

Supabase SQL Editorで、次のファイルの内容を先頭から末尾まで1回実行する。

```text
supabase/migrations/20260720050030_align_koshien_match_results.sql
```

このmigrationは次を行う。

- `matches.loser_team_id uuid` を不足時だけ追加
- `teams(id)` への外部キーを不足時だけ追加
- 既存 `final` を `completed` へ移行
- `live` / `canceled` が残る場合は停止し、人間の判断を要求
- status制約を `scheduled` / `completed` に統一
- `matches` / `scores` / `results` を同一トランザクションでupsertする `save_koshien_result_snapshot` RPCを追加
- PostgRESTへ `NOTIFY pgrst, 'reload schema'` を送信

`DROP TABLE`、`TRUNCATE`、全削除、全面再作成は含まない。既存のstatus単一カラムCHECK制約だけを、新制約へ置き換えるために削除する。statusを含む複合CHECK制約は削除しない。

## 3. migration適用後のschema確認SQL

```sql
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'matches'
  and column_name = 'loser_team_id';

select c.conname, c.convalidated, pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid = 'public.matches'::regclass
  and (
    c.conname = 'matches_status_check'
    or pg_get_constraintdef(c.oid) ilike '%loser_team_id%'
  )
order by c.conname;

select status, count(*)
from public.matches
group by status
order by status;

select pg_notification_queue_usage();
notify pgrst, 'reload schema';

select p.oid::regprocedure as function_signature,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute
from pg_proc p
where p.oid = 'public.save_koshien_result_snapshot(text,jsonb,jsonb,jsonb)'::regprocedure;
```

期待値:

- `loser_team_id` は `uuid`
- 外部キーは `teams(id) on delete set null`
- status制約は `scheduled` / `completed` のみ
- 制約の `convalidated` は `true`
- RPCは1行、`security_definer = false`、`authenticated_can_execute = true`

## 4. R1結果保存

1. 管理者アカウントで対象大会を開く。
2. 大会状態を結果入力可能な状態にする。
3. R1の1試合だけ、異なる2校、0以上の整数スコア、スコアと一致する勝者を入力する。
4. 「結果保存」を1回押す。
5. 画面に `Supabaseへ結果を保存しました。` と表示されることを確認する。
6. `matches` / `scores` / `matches・scores・raw results` のいずれかの失敗表示が出た場合は成功扱いにせず、表示された段階を修正して同じ試合を再保存する。結果3テーブルはRPC内の同一トランザクションで保存され、失敗時はまとめてロールバックされる。upsertのため再試行で重複行は作られない。

## 5. matches件数確認

`EVENT_ID` を対象大会IDに置き換える。

```sql
select id, event_id, round_key, match_no,
       team1_id, team2_id, team1_score, team2_score,
       winner_team_id, loser_team_id, status, updated_at
from public.matches
where event_id = 'EVENT_ID'
order by round_key, match_no;
```

R1-1が1行、`status = 'completed'`、勝者と敗者が別ID、スコアが画面入力と一致することを確認する。同じ試合を再保存しても `(event_id, round_key, match_no)` により件数が増えないことも確認する。

## 6. scores件数確認

```sql
select s.event_id, s.player_id, p.display_name,
       s.phase1_score, s.phase2_score, s.phase3_score,
       s.revenge_score, s.zombie_score, s.total_score,
       s.breakdown, s.updated_at
from public.scores s
join public.players p on p.id = s.player_id
where s.event_id = 'EVENT_ID'
order by s.total_score desc, p.display_name;
```

対象参加者全員にplayer行がある場合、参加者数とscores件数が一致することを確認する。一致しない場合は、画面の参加者名と `players.display_name`、重複名、各参加者が一度オンライン保存済みかを確認する。

## 7. ランキング確認

保存直後に画面の順位と学校別内訳を確認する。フェーズ1は次で計算される。

```text
正式到達ポイント × min(sqrt(オッズ), 50) × キャプテン倍率
```

特に、R1開始校のR2敗退が `first_win_then_loss = 1`、R2開始校のR2敗退が `initial_loss = 0`、R3/QF/SF敗退がそれぞれ `best16` / `best8` / `best4` になることを確認する。キャプテンだけ1.2倍であることも学校別内訳で確認する。

## 8. リロード確認

同じブラウザでページを再読み込みし、Supabaseからの読込完了後に次を確認する。

- R1入力値
- 勝者・敗者
- 学校の到達ステージ
- ランキングと学校別得点内訳

読込の正本は `results.payload` のraw snapshotで、ランキングは復元されたresultsとpredictionsから再計算される。

## 9. 別端末確認

別端末または別ブラウザで同じリーグのユーザーとしてログインし、同じ大会、R1結果、ランキングが一致することを確認する。締切前の他メンバー予想はRLSにより見えないため、大会状態・締切条件も合わせて確認する。

## 10. 問題発生時の切り戻し方針

まずアプリを旧版へ戻し、DBは原則そのまま残す。`loser_team_id` と外部キーは旧版が無視できるため、安易にカラム削除しない。データ行も削除しない。

旧版が `final` を必須とする場合だけ、影響件数を確認したうえで次を検討する。

```sql
begin;

select status, count(*)
from public.matches
group by status
order by status;

alter table public.matches drop constraint if exists matches_status_check;

update public.matches
set status = 'final'
where status = 'completed';

alter table public.matches
  add constraint matches_status_check
  check (status in ('scheduled', 'live', 'final', 'canceled'));

notify pgrst, 'reload schema';

commit;
```

この切り戻しは `completed` をすべて `final` に戻すため、適用後に作られた行も対象になる。必ず事前に件数と対象大会を確認する。`loser_team_id` の削除、matches/scores/resultsの削除はロールバック手順に含めない。
