# 残る手動phase3準備・管理者status／schedule入口（隔離試作）

2026-11-19、本番catalog由来の `prepare_koshien_phase3`、`set_koshien_later_phase_status`、`update_koshien_later_phase_schedule` に対し、既存認証・状態検証・レスポンス・ACLを維持したまま、最初の子行ロックより前にevent FOR UPDATEを追加。待機後の実league_idに基づくadmin判定を維持。結果編集用permitは発行しない。
成功するround／schedule／phase3更新は1回の共有approval revision増加。共通 `prepare_koshien_later_phase` の子RPC経由も二重に増やさない。元の管理者scheduleの同一値UPDATEは元々version増加するため仕様変更しない。

実本番SQLをコピーした隔離関数と実refreshを使い、権限拒否・direct/wrapper phase3・重複準備・手動open/lock・schedule更新・不正期限rollback・revision/round versionを検証。上位stateの大きなJSON応答は前段と同様スタブ。実RLS・所属変更競合、予想保存からの子ロック先行はなお残る。完全統合まで本番適用禁止。
試作の復旧はcommit revert。追加費用/本番書込みなし。
次: 予想保存3経路のget state呼出しと、直接best16準備のロック順を統一。
