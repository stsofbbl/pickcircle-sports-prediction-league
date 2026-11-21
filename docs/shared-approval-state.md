# 共有結果承認の非公開保存モデル・状態取得RPC（隔離試作）
2026-11-19。画面上だけの結果承認を廃止するため、private schemaに`submissions`（提出時revision、承認方式、承認対象UID、必要票数、提出者、監査snapshot）と`votes`（提出ID＋投票者UIDで一意）を追加し、`get_koshien_shared_approval_state(event_id)`の試作を作成。
**直接テーブル操作はPUBLIC/anon/authenticated/service_roleから拒否**。RLS有効、公開RPCはSECURITY DEFINER・空search_path、authenticatedだけが実行可。RPC自体は会員本人を照合し、承認対象revisionをSELECTするだけで、書込み・更新番号作成を行わない。
返却は承認状態、提出ID、現在のrevision、必要数、得票数、現在の利用者自身の投票/対象フラグのみ。全投票者やsnapshot本文は返却しない。revisionが進むと旧提出は返却されない。
既存使い捨てPostgreSQLで匿名/他リーグ拒否、会員・提出者の表示差、private表の直接読取拒否、同一投票禁止、閾値制約、古いrevisionの無効化、トランザクションROLLBACKと構造復元を検証。
**submit / approve / finalize / reopenへの接続は未実装**。所属変更時の承認無効化、完全な結果整合チェック、イベントUIは本番公開前の必須作業。現行PRはDraftのまま、本番migration/merge/deployなし。試作の復旧はcommit revert。
