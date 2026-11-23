# Zombie準備の呼出元と承認revisionの境界
2026-11-17 JST / 基準698ea22 / 本番catalog SELECTのみ。RPC呼出し・本番書込みなし。

## 実効EXECUTEと直接呼出元
| 関数 | anon | authenticated | service_role | 観測した処理 |
|---|---|---|---|---|
| prepare_koshien_zombie_phase_internal | 不可 | 不可 | 可 | round/資格をINSERT。eventロック・承認revision更新なし |
| prepare_koshien_zombie_phase | 不可 | 可 | 可 | auth.uid＋active admin確認→internal→get state。eventロックなし |
| auto_prepare_koshien_zombie_from_sf | 不可 | 不可 | 可 | matches遅延trigger。internal→roundをopen。呼出元writerのロックに依存 |

prosrcの内部関数名検索で直接呼出元は手動prepareと自動triggerの2本。
さらにprepare_koshien_later_phaseのzombie分岐が手動prepareを呼ぶ。こちらもauth/admin確認はあるがeventロックはない。
EXECUTE可は認可不要という意味ではない。公開manual関数は管理者チェックを持つ。
trigger関数のEXECUTE可は通常RPCとして直接実行できることを意味しない。
文字列検索は動的SQL/外部サービスの呼出しまで網羅するものではない。

## 読取名の関数の副作用
get_koshien_later_phase_stateはmember確認後refresh_koshien_phase_scheduleを呼ぶ。
refreshはready→open、期限経過→locked、phase2 draftの状態/締切を書き換える。
一般active memberから実行可能。event先行ロック・承認revision更新はない。
今回は本番で呼ばず、実定義と最小依存schemaを隔離fixtureへ追加した。

## 自動triggerへ到達するwriter候補
public.matchesへのINSERT/UPDATEを関数本体から検索。
試作対応済: save_koshien_result_snapshot / cancel_koshien_match_result / auto_apply_koshien_official_results。
未対応: auto_sync_koshien_official_schedule / auto_sync_koshien_late_schedule /
register_koshien_official_first_round_matches / register_koshien_official_second_round_slots /
register_koshien_official_redraw_slots。
2つのschedule関数はevent→results→matchのロック順を本体で確認したが、試作のpermit/revision呼出しはない。
試作gateを本番へ単独適用すると、これらの書込みが拒否されるためリリース不可。

## 今回の再現と限界
既存fixtureは内部prepareをservice_roleからもREVOKEしていた。本番実効ACLに合わせGRANTし、
service_roleがround/資格を作成できる一方、承認revisionを増やさないことをrollback付きで再現。
実refreshを使いanon/他league拒否、active memberによる期限経過roundのlocked化・二重呼出し非重複・revision不変を検証。
これは未導入の承認revisionとの接続不足を示すもので、本番で不正利用が起きたとの認定ではない。
全Supabase ACL/RLS/制約やget stateのレスポンス全体は再現していない。

## 次の実装1件
auto_sync_koshien_late_scheduleを既存event先行ロックを維持してpermit/revisionへ接続し、
SF時刻変更→zombie準備までを実RPCで検証する。service_roleのみ・no-op・rollback・確定後制御も対象。
手動prepare/refreshの方針は別途必要。子行更新後にinternalへeventロックを足すだけの修正はロック順逆転を招くので避ける。
本番migration/merge/deployなし。復旧はfixture/テスト/資料追加のrevert。得点規則変更なし。
