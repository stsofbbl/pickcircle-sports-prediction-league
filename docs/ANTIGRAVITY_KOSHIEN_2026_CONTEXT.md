# YOSO 夏の甲子園2026 — Antigravity参照案内

このファイルは、以前のAntigravity向け自己完結型引継ぎ文書への参照を切らさないために残しています。エージェント規則、正式ルール、実装状況をここへ複製しません。

## 正本と参照順

1. [../AGENTS.md](../AGENTS.md) — リポジトリ全体のAIエージェント共通作業規則
2. [../CONTEXT.md](../CONTEXT.md) — YOSOの短い製品・ドメインコンテキスト
3. [KOSHIEN_2026_RULES.md](KOSHIEN_2026_RULES.md) — 夏の甲子園2026正式ルールの唯一の正本
4. [../README.md](../README.md) — 起動方法と文書一覧

競合する記述がある場合、作業規則は `AGENTS.md`、夏の甲子園2026ルールは `docs/KOSHIEN_2026_RULES.md` を優先します。正式ルールをこのファイルだけで変更しないでください。

## 用途別の参照先

- リリース計画・手動E2E: [KOSHIEN_2026_DELIVERY_PLAN.md](KOSHIEN_2026_DELIVERY_PLAN.md)
- 試合結果保存migration・本番確認: [SUPABASE_KOSHIEN_MATCH_RESULTS_RUNBOOK.md](SUPABASE_KOSHIEN_MATCH_RESULTS_RUNBOOK.md)
- Supabase移行方針: [SUPABASE_MIGRATION_PLAN.md](SUPABASE_MIGRATION_PLAN.md)
- ルールシミュレーターの実行・出力: [../yoso-koshien-sim/README.md](../yoso-koshien-sim/README.md)
- ルール説明画像: `../assets/koshien-rule-guides/`

以前この文書に含まれていた日付付き実装状況、優先課題、シミュレーション数値はスナップショットであり、現在状態の正本ではありません。作業時はコード、GitHub Issue／Pull Request、上記の専門文書を読み取り直してください。
