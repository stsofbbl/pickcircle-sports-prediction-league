# YOSO 夏の甲子園2026 ルールシミュレーター

友人4人用の夏の甲子園2026ルールを、点数バランス確認用にシミュレーションする独立ツールです。

アプリ本体のUI、ロゴ、ナビ、Supabase同期には触れません。

## ルールの参照元

正式な選択条件、各フェーズ、得点、特別ルールは [../docs/KOSHIEN_2026_RULES.md](../docs/KOSHIEN_2026_RULES.md) を唯一の正本とします。このREADMEはシミュレーターの実行方法と比較用オプションだけを説明します。

## 注意

`data/teams_2025.csv` は、2025年夏の甲子園の代表校と1回戦/2回戦スタート枠に差し替え済みです。

`data/bracket_2025.csv` は、2025年大会結果の勝敗メモです。現時点のシミュレーター本体は確率で大会結果を生成するため、このCSVは参照用データとして保持しています。

`data/teams_2025.csv` には、参照元を示す `odds_source` と `start_round_source` も残しています。外部オッズはゲーム内倍率の固定データとしてのみ扱います。リアルマネー、決済、送金、換金、ブックメーカー登録導線は扱いません。

## 実行方法

リポジトリ直下で実行します。

```powershell
python yoso-koshien-sim\run.py --iterations 2000
```

`--revenge-mode` を省略した場合は、正式採用の `full` で実行します。

`--phase1-point-mode` を省略した場合は、正式採用の `boosted` で実行します。

- `boosted`: 正式採用値。具体的な値は正式ルールを参照
- `current`: 旧比較条件。正式ルールとして使用しない

正式採用リベンジルールで mixed 戦略を本番寄りに確認:

```powershell
python yoso-koshien-sim\run.py --iterations 100000 --strategy-sets mixed --revenge-mode full
```

旧式リベンジルールとの比較:

```powershell
python yoso-koshien-sim\run.py --iterations 100000 --strategy-sets mixed --revenge-mode discounted
```

旧フェーズ1ポイントとの比較:

```powershell
python yoso-koshien-sim\run.py --iterations 100000 --strategy-sets mixed --revenge-mode full --phase1-point-mode current
```

PythonがPATHにない場合は、Codex同梱Pythonを使います。

```powershell
& 'C:\Users\stsof\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' yoso-koshien-sim\run.py --iterations 2000
```

高速確認:

```powershell
python yoso-koshien-sim\run.py --iterations 100 --result-modes standard_upset --strategy-sets mixed
```

本番寄り確認:

```powershell
python yoso-koshien-sim\run.py --iterations 100000
```

## 出力

`outputs/` にCSVを出力します。

- `summary.csv`: 勝者平均点、中央値、上位分位、400点超え率、各イベント率
- `strategy_performance.csv`: 戦略別の勝率、平均点、中央値、上振れ分位、最大値
- `phase_breakdown.csv`: フェーズ別平均点、フェーズ1+リベンジ平均、バランス判定
- `winner_distribution.csv`: 優勝者得点の分布
- `zombie_impact.csv`: ゾンビ発動、的中、半減、消滅、優勝者変動
- `revenge_impact.csv`: リベンジカード発動率と平均得点

## 比較用モード

リベンジカードの正式採用は `full` モードです。`discounted` は過去案との比較専用で、正式ルールとして使用しません。正式な式と得点は [ルール正本](../docs/KOSHIEN_2026_RULES.md) を参照してください。
