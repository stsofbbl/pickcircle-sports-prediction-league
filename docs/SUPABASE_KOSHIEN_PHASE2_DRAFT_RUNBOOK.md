# 夏の甲子園2026 フェーズ2ドラフト migration / 運用草案

この手順は [`KOSHIEN_2026_PHASE2_DRAFT_SPEC.md`](KOSHIEN_2026_PHASE2_DRAFT_SPEC.md) に基づくレビュー用草案である。今回の作業ではSupabaseへ接続せず、本番へ適用しない。

対象migration:

```text
supabase/migrations/20260721023204_add_koshien_phase2_draft_foundation.sql
supabase/migrations/20260721104248_harden_koshien_phase2_rpc_permissions.sql
```

## 1. 適用前の停止条件

次のどれかに該当したらmigrationを適用しない。

- `phase2_draft_picks` に既存行が1件でもある
- 対象リーグの4人全員に、認証ユーザーと一意に対応する `players.profile_id` がない
- ベスト16のteam IDを16件確定できない
- フェーズ1暫定得点と同点抽選結果を確認できない
- `event_id`、player ID、team IDの対象大会・対象リーグ整合性を確認できない
- 開始時刻と締切が未確定
- migrationの実行対象が本番か検証環境か判別できない

このmigrationは既存 `phase2_draft_picks` を表示名や作成時刻から推測変換しない。既存行がある場合は例外でトランザクション全体を停止する。変換が必要なら、実データを確認した別migrationを作る。

## 2. 適用前の読み取り確認SQL

```sql
select count(*) as existing_phase2_pick_count
from public.phase2_draft_picks;

select has_function_privilege(
  'authenticated',
  'public.is_league_member(uuid)',
  'execute'
) as authenticated_can_check_membership;

select e.id as event_id, e.league_id, e.name, e.preset_type, e.status
from public.events e
where e.preset_type = 'koshien'
order by e.updated_at desc;

select p.id as player_id, p.league_id, p.profile_id, p.display_name, p.is_admin
from public.players p
where p.league_id = 'LEAGUE_ID'::uuid
order by p.created_at;

select t.id as team_id, t.event_id, t.name
from public.teams t
where t.event_id = 'EVENT_ID'
order by t.name;

select m.match_no, m.winner_team_id, t.name, m.status
from public.matches m
join public.teams t on t.id = m.winner_team_id
where m.event_id = 'EVENT_ID'
  and m.round_key = 'R2'
order by m.match_no;
```

期待値:

- `existing_phase2_pick_count = 0`
- `authenticated_can_check_membership` の現在値を記録する。このmigration適用後は `true` であること
- 対象eventが1件に決まる
- 対象playerが4件で、`profile_id` が全件非NULL・重複なし
- R2の完了済み勝者が重複なしで16校

## 3. migrationレビュー項目

- 明示的な `begin` / `commit` がある
- `DROP TABLE`、`TRUNCATE`、データ行の `DELETE` がない
- 既存migrationを変更していない
- `phase2_drafts` を追加し、既存 `phase2_draft_picks` を拡張している
- 4人、16校、1〜16指名、1〜4巡、一意高校、一意手番、冪等キーの制約がある
- `phase2_drafts` と `phase2_draft_picks` のRLSが有効である
- 旧フェーズ2直接書込policyとセッション設定値に依存する書込policyを削除している
- authenticatedのテーブル権限を一度すべてrevokeし、selectだけを再grantしている
- 読取RPCは `SECURITY INVOKER`、保存RPCは直接DMLを閉じるための限定的な `SECURITY DEFINER` 例外で、両方とも `search_path = ''` である
- 保存RPCが `auth.uid()` から本人を解決し、手番・時刻・候補校・重複・状態遷移をすべて再検証している
- `PUBLIC` と `anon` のEXECUTEがrevokeされ、`authenticated` だけにgrantされている
- RLSが使用する `is_league_member(uuid)` は `anon` / `PUBLIC` からrevokeし、`authenticated` にだけEXECUTEを明示grantしている
- publicテーブルのData API権限が明示grantされている
- auth、storage、Vault、service roleへ変更がない

## 4. 適用手順案

1. 対象環境とバックアップ方針を人間が確認する。
2. 2人以上でmigration差分と適用前SQLをレビューする。
3. 検証環境でmigrationを1回適用する。
4. 同じmigrationを再実行し、既存行がない初期状態で冪等に完了することを確認する。
5. 下記のschema・権限確認を行う。
6. 検証用draftをレビュー済み運用SQLで作成する。
7. 2ユーザー・2端末で競合テストを行う。
8. 結果とログを保存し、本番適用可否を別承認する。

本番へのmigration適用、draft作成、status変更は今回の許可範囲外である。

## 5. 適用後のschema・権限確認SQL

```sql
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name in ('phase2_drafts', 'phase2_draft_picks')
order by table_name, ordinal_position;

select c.conrelid::regclass as table_name,
       c.conname,
       c.contype,
       c.convalidated,
       pg_get_constraintdef(c.oid) as definition
from pg_constraint c
where c.conrelid in (
  'public.phase2_drafts'::regclass,
  'public.phase2_draft_picks'::regclass
)
order by table_name, c.contype, c.conname;

select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('phase2_drafts', 'phase2_draft_picks')
order by tablename, policyname;

select p.oid::regprocedure as function_signature,
       p.prosecdef as security_definer,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'get_koshien_phase2_draft_state',
    'save_koshien_phase2_draft_pick',
    'is_league_member'
  )
order by p.proname;
```

期待値:

- 両テーブルでRLSが有効
- 読取RPCで `security_definer = false`、保存RPCで `security_definer = true`
- `authenticated_can_execute = true`
- `anon_can_execute = false`
- `phase2_drafts` と `phase2_draft_picks` はauthenticatedの全権限revoke後にselectだけが再grantされる
- insert/update/deleteの直接権限と書込policyがなく、保存RPC以外の書込は拒否される

## 6. draft準備データの確認

draft作成・開始UIの権限は未確定のため、今回のmigrationは準備・開始RPCを追加しない。検証用draftを作る場合は、次の値を人間がレビューし、管理されたSQL運用で一度だけ保存する。

- `event_id`
- 4位から1位の順で固定した `ordered_player_ids` 4件
- 同点抽選結果とフェーズ1暫定得点を含む `ranking_snapshot`
- `eligible_team_ids` 16件
- `starts_at`
- `deadline_at`
- 初期 `current_pick_no = 1`
- 開始時 `status = drafting`

draft行は必ず `not_ready` で作成する。4人・16校・監査snapshot・時刻を保存した同じレビュー済み運用で `ready` へ進め、`starts_at` 到達後にだけ `drafting` へ進める。`not_ready` から `drafting` へ直接移行しない。

`ranking_snapshot` は最低限、次の形で固定する。

```json
{
  "players": [
    { "player_id": "PLAYER_UUID", "phase1_score": 0, "resolved_rank": 1 }
  ],
  "tie_draws": [],
  "resolved_order_player_ids": ["P4_UUID", "P3_UUID", "P2_UUID", "P1_UUID"]
}
```

実データでは `players` を4件、`resolved_rank` を1〜4で重複なしにし、`resolved_order_player_ids` を4位→1位の4件にする。同点があれば `tie_draws` に固定抽選結果を残す。

表示名や高校名からID配列を自動生成しない。`ordered_player_ids` と `eligible_team_ids` は、保存前後に同じ順序・同じ件数でread backする。

## 7. 競合・冪等性の手動確認

検証環境で、対象player 2人以上の実アカウントを使う。

1. 端末Aと端末Bで同じplayerとして同じturnを開く。
2. 同じ高校・同じ `request_id` を同時送信し、1行だけ保存され両方が同じ最新状態を取得することを確認する。
3. 同じ高校・異なる `request_id` を同時送信し、一方だけが新規成功することを確認する。
4. 別高校を同じ `pick_no` へ同時送信し、一方だけが成功することを確認する。
5. 手番外player、ベスト16外team、締切後、未ログイン、偽装player IDなしの入力経路を確認する。
6. 失敗側が再読込し、成功側の指名、所有者、次turnを表示することを確認する。
7. 16件目で `completed` になり、17件目を保存できないことを確認する。
8. `predictions.payload` やraw snapshotだけが変わる部分保存がないことを確認する。

## 8. リロード復元確認

```sql
select d.id, d.event_id, d.status, d.ordered_player_ids,
       d.eligible_team_ids, d.current_pick_no, d.version,
       d.starts_at, d.deadline_at
from public.phase2_drafts d
where d.event_id = 'EVENT_ID';

select dp.draft_id, dp.pick_no, dp.draft_round,
       dp.player_id, p.display_name,
       dp.team_id, t.name,
       dp.request_id, dp.created_at
from public.phase2_draft_picks dp
join public.players p on p.id = dp.player_id
join public.teams t on t.id = dp.team_id
where dp.draft_id = 'DRAFT_ID'::uuid
order by dp.pick_no;
```

別端末で再ログイン・再読込し、DBと画面のpick_no、巡目、player ID、team ID、現在turnが一致することを確認する。表示名を変更しても所有関係と順序が変わらないことも確認する。

## 9. ロールバック方針

今回のmigrationは本番未適用である。適用前ならファイルを修正して再レビューする。

適用後に問題が見つかっても、テーブル・列・行を即時削除しない。まずアプリのフェーズ2UIを無効化し、DBを保持したまま原因を調査する。列・制約・テーブルの削除を伴うrollbackはデータ影響を確認した別migrationとして扱う。
