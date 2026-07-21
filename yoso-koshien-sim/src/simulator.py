from __future__ import annotations

import argparse
import csv
import random
import statistics
from collections import Counter
from pathlib import Path

from .phase3 import calculate_phase3_scores, predict_final_score
from .revenge import select_revenge_team
from .rules import Team
from .scoring import (
    PHASE1_POINT_MODES,
    REVENGE_MODES,
    calculate_phase1_provisional_at_best16,
    calculate_phase1_score,
    calculate_phase2_score,
    calculate_revenge_score,
    calculate_total_score,
    validate_revenge_scoring_modes,
)
from .strategies import STRATEGY_SETS, create_players, draft_phase2_teams
from .zombie import apply_zombie_penalty, select_zombie_target


RESULT_MODES = {
    "orderly": 1.8,
    "mild_upset": 1.25,
    "standard_upset": 0.85,
    "chaos": 0.45,
}


def load_teams(path: Path) -> dict[str, Team]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        rows = csv.DictReader(handle)
        teams = {}
        for row in rows:
            team = Team(
                team_id=row["team_id"],
                school_name=row["school_name"],
                prefecture=row["prefecture"],
                start_round=int(row["start_round"]),
                odds=float(row["odds"]),
            )
            teams[team.team_id] = team
    if len(teams) != 49:
        raise ValueError(f"teams_2025.csv must contain 49 teams, got {len(teams)}")
    round2_count = sum(1 for team in teams.values() if team.start_round == 2)
    if round2_count != 15:
        raise ValueError(f"start_round=2 must contain 15 teams, got {round2_count}")
    return teams


def match_probability(team_a: Team, team_b: Team, mode_power: float) -> float:
    strength_a = team_a.strength**mode_power
    strength_b = team_b.strength**mode_power
    return strength_a / (strength_a + strength_b)


def simulate_match(team_a: str, team_b: str, teams: dict[str, Team], mode_power: float, rng) -> tuple[str, str, int, int]:
    probability_a = match_probability(teams[team_a], teams[team_b], mode_power)
    winner = team_a if rng.random() < probability_a else team_b
    loser = team_b if winner == team_a else team_a
    winner_score = max(1, int(round(rng.gauss(5.0, 2.0))))
    loser_score = max(0, min(winner_score - 1, int(round(rng.gauss(3.2, 1.8)))))
    if winner == team_a:
        return winner, loser, winner_score, loser_score
    return winner, loser, loser_score, winner_score


def pairwise(items: list[str]) -> list[tuple[str, str]]:
    return [(items[index], items[index + 1]) for index in range(0, len(items), 2)]


def simulate_tournament(teams: dict[str, Team], result_mode: str, rng) -> dict:
    mode_power = RESULT_MODES[result_mode]
    finish_by_team: dict[str, str] = {}
    eliminated_by_team: dict[str, str] = {}
    eliminated_before_best16: dict[str, str] = {}
    matches = []

    round1 = [team_id for team_id, team in teams.items() if team.start_round == 1]
    round2_byes = [team_id for team_id, team in teams.items() if team.start_round == 2]
    rng.shuffle(round1)

    round2 = list(round2_byes)
    for index, (team_a, team_b) in enumerate(pairwise(round1), start=1):
        winner, loser, score_a, score_b = simulate_match(team_a, team_b, teams, mode_power, rng)
        finish_by_team[loser] = "initial_loss"
        eliminated_before_best16[loser] = "initial_loss"
        eliminated_by_team[loser] = winner
        round2.append(winner)
        matches.append(match_row("R1", index, team_a, team_b, winner, loser, score_a, score_b))

    rng.shuffle(round2)
    round3 = []
    for index, (team_a, team_b) in enumerate(pairwise(round2), start=1):
        winner, loser, score_a, score_b = simulate_match(team_a, team_b, teams, mode_power, rng)
        finish = "first_win_then_loss" if teams[loser].start_round == 1 else "initial_loss"
        finish_by_team[loser] = finish
        eliminated_before_best16[loser] = finish
        eliminated_by_team[loser] = winner
        round3.append(winner)
        matches.append(match_row("R2", index, team_a, team_b, winner, loser, score_a, score_b))

    best16 = set(round3)
    qf = run_round("R3", round3, "best16", teams, mode_power, rng, finish_by_team, eliminated_by_team, matches)
    best8 = set(qf)
    sf = run_round("QF", qf, "best8", teams, mode_power, rng, finish_by_team, eliminated_by_team, matches)
    best4 = set(sf)
    final = run_round("SF", sf, "best4", teams, mode_power, rng, finish_by_team, eliminated_by_team, matches)
    champion, runner_up, champion_score, runner_score = run_final(final, teams, mode_power, rng, finish_by_team, eliminated_by_team, matches)

    return {
        "finish_by_team": finish_by_team,
        "eliminated_by_team": eliminated_by_team,
        "eliminated_before_best16": eliminated_before_best16,
        "best16": best16,
        "best8": best8,
        "best4": best4,
        "finalists": final,
        "actual_final": {
            "champion": champion,
            "runner_up": runner_up,
            "champion_score": champion_score,
            "runner_up_score": runner_score,
        },
        "matches": matches,
    }


def run_round(round_name, entrants, loser_finish, teams, mode_power, rng, finish_by_team, eliminated_by_team, matches):
    rng.shuffle(entrants)
    winners = []
    for index, (team_a, team_b) in enumerate(pairwise(entrants), start=1):
        winner, loser, score_a, score_b = simulate_match(team_a, team_b, teams, mode_power, rng)
        finish_by_team[loser] = loser_finish
        eliminated_by_team[loser] = winner
        winners.append(winner)
        matches.append(match_row(round_name, index, team_a, team_b, winner, loser, score_a, score_b))
    return winners


def run_final(finalists, teams, mode_power, rng, finish_by_team, eliminated_by_team, matches):
    team_a, team_b = finalists
    winner, loser, score_a, score_b = simulate_match(team_a, team_b, teams, mode_power, rng)
    finish_by_team[winner] = "champion"
    finish_by_team[loser] = "runner_up"
    eliminated_by_team[loser] = winner
    matches.append(match_row("F", 1, team_a, team_b, winner, loser, score_a, score_b))
    if winner == team_a:
        return winner, loser, score_a, score_b
    return winner, loser, score_b, score_a


def match_row(round_name, index, team_a, team_b, winner, loser, score_a, score_b):
    return {
        "match_id": f"{round_name}-{index:02d}",
        "round": round_name,
        "team_a_id": team_a,
        "team_b_id": team_b,
        "winner_id": winner,
        "loser_id": loser,
        "score_a": score_a,
        "score_b": score_b,
    }


def run_one(teams: dict[str, Team], result_mode: str, strategy_set: str, revenge_mode: str, phase1_point_mode: str, rng) -> dict:
    tournament = simulate_tournament(teams, result_mode, rng)
    players = create_players(strategy_set, teams, rng)

    provisional = {
        player.name: calculate_phase1_provisional_at_best16(
            player,
            tournament["best16"],
            tournament["eliminated_before_best16"],
            teams,
            phase1_point_mode,
        )
        for player in players
    }
    draft_phase2_teams(players, tournament["best16"], provisional, teams, rng)

    for player in players:
        player.revenge_pick = select_revenge_team(
            player,
            tournament["best16"],
            tournament["eliminated_by_team"],
            teams,
            rng,
        )
        player.zombie_target = select_zombie_target(player, players, tournament["best4"], teams, rng)
        finalist_a, finalist_b = tournament["finalists"]
        player.final_prediction = predict_final_score(player, finalist_a, finalist_b, teams, rng)

    zombie_adjusted_scores, zombie_hit_counts = apply_zombie_penalty(players, tournament["finish_by_team"])
    phase3_scores, phase3_exact = calculate_phase3_scores(players, tournament["actual_final"])

    player_rows = []
    player_rows_without_zombie = []
    for player in players:
        phase1 = calculate_phase1_score(player, tournament["finish_by_team"], teams, phase1_point_mode)
        revenge = calculate_revenge_score(player.revenge_pick, tournament["finish_by_team"], teams, revenge_mode, phase1_point_mode)
        phase2 = calculate_phase2_score(player, tournament["finish_by_team"], zombie_adjusted_scores)
        phase2_without_zombie = calculate_phase2_score(player, tournament["finish_by_team"], None)
        phase3 = phase3_scores[player.name]
        player_rows.append({
            "name": player.name,
            "strategy": player.strategy,
            "phase1": phase1,
            "revenge": revenge,
            "phase2": phase2,
            "phase3": phase3,
            "total": calculate_total_score(phase1, revenge, phase2, phase3),
            "revenge_used": player.revenge_pick is not None,
            "zombie_used": player.zombie_target is not None,
            "zombie_hit": player.zombie_target in zombie_hit_counts,
            "phase3_exact": phase3_exact[player.name],
            "phase3_nearest": phase3 == 30.0,
        })
        player_rows_without_zombie.append({
            "name": player.name,
            "total": calculate_total_score(phase1, revenge, phase2_without_zombie, phase3),
        })

    winners = {row["name"] for row in player_rows if row["total"] == max(item["total"] for item in player_rows)}
    for row in player_rows:
        row["is_winner"] = row["name"] in winners
        row["winner_share"] = (1.0 / len(winners)) if row["name"] in winners else 0.0
    winners_without_zombie = {
        row["name"] for row in player_rows_without_zombie
        if row["total"] == max(item["total"] for item in player_rows_without_zombie)
    }
    zombie_count = sum(1 for row in player_rows if row["zombie_used"])
    return {
        "players": player_rows,
        "winner_score": max(row["total"] for row in player_rows),
        "zombie_count": zombie_count,
        "zombie_half": sum(1 for score in zombie_adjusted_scores.values() if score == 20.0),
        "zombie_zero": sum(1 for score in zombie_adjusted_scores.values() if score == 0.0),
        "winner_changed_by_zombie": winners != winners_without_zombie,
    }


def percentile(values: list[float], rate: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((len(ordered) - 1) * rate))))
    return ordered[index]


def summarize(result_mode: str, strategy_set: str, revenge_mode: str, phase1_point_mode: str, rows: list[dict]) -> dict:
    winner_scores = [row["winner_score"] for row in rows]
    player_rows = [player for row in rows for player in row["players"]]
    phase_means = {
        key: statistics.fmean(player[key] for player in player_rows)
        for key in ("phase1", "revenge", "phase2", "phase3")
    }
    phase1_plus_revenge_avg = phase_means["phase1"] + phase_means["revenge"]
    return {
        "result_mode": result_mode,
        "strategy_set": strategy_set,
        "revenge_mode": revenge_mode,
        "phase1_point_mode": phase1_point_mode,
        "iterations": len(rows),
        "winner_avg": round(statistics.fmean(winner_scores), 3),
        "winner_median": round(statistics.median(winner_scores), 3),
        "winner_top10": round(percentile(winner_scores, 0.90), 3),
        "winner_top5": round(percentile(winner_scores, 0.95), 3),
        "winner_top1": round(percentile(winner_scores, 0.99), 3),
        "winner_over_400_rate": round(sum(1 for score in winner_scores if score > 400) / len(winner_scores), 5),
        "winner_max": round(max(winner_scores), 3),
        "winner_min": round(min(winner_scores), 3),
        "phase1_avg": round(phase_means["phase1"], 3),
        "revenge_avg": round(phase_means["revenge"], 3),
        "phase1_plus_revenge_avg": round(phase1_plus_revenge_avg, 3),
        "phase2_avg": round(phase_means["phase2"], 3),
        "phase3_avg": round(phase_means["phase3"], 3),
        "phase_balance_ok": phase_means["phase2"] > phase_means["phase1"] > phase_means["phase3"],
        "phase_balance_with_revenge_ok": phase_means["phase2"] > phase1_plus_revenge_avg > phase_means["phase3"],
        "revenge_activation_rate": round(sum(1 for p in player_rows if p["revenge_used"]) / len(player_rows), 5),
        "revenge_score_avg_when_used": round(mean_or_zero([p["revenge"] for p in player_rows if p["revenge_used"]]), 3),
        "zombie_activation_rate": round(sum(1 for p in player_rows if p["zombie_used"]) / len(player_rows), 5),
        "zombie_hit_rate": round(safe_ratio(sum(1 for p in player_rows if p["zombie_hit"]), sum(1 for p in player_rows if p["zombie_used"])), 5),
        "zombie_half_rate": round(sum(1 for row in rows if row["zombie_half"] > 0) / len(rows), 5),
        "zombie_zero_rate": round(sum(1 for row in rows if row["zombie_zero"] > 0) / len(rows), 5),
        "winner_changed_by_zombie_rate": round(sum(1 for row in rows if row["winner_changed_by_zombie"]) / len(rows), 5),
        "phase3_exact_rate": round(sum(1 for p in player_rows if p["phase3_exact"]) / len(player_rows), 5),
        "phase3_nearest_rate": round(sum(1 for p in player_rows if p["phase3_nearest"]) / len(player_rows), 5),
    }


def summarize_strategy_performance(result_mode: str, strategy_set: str, revenge_mode: str, phase1_point_mode: str, rows: list[dict]) -> list[dict]:
    player_rows = [player for row in rows for player in row["players"]]
    strategies = sorted({player["strategy"] for player in player_rows})
    summaries = []
    for strategy in strategies:
        strategy_rows = [player for player in player_rows if player["strategy"] == strategy]
        totals = [player["total"] for player in strategy_rows]
        wins = sum(1 for player in strategy_rows if player["is_winner"])
        tie_adjusted_wins = sum(player["winner_share"] for player in strategy_rows)
        summaries.append({
            "result_mode": result_mode,
            "strategy_set": strategy_set,
            "revenge_mode": revenge_mode,
            "phase1_point_mode": phase1_point_mode,
            "strategy": strategy,
            "appearances": len(strategy_rows),
            "wins": wins,
            "win_rate": round(wins / len(strategy_rows), 5),
            "tie_adjusted_wins": round(tie_adjusted_wins, 3),
            "tie_adjusted_win_rate": round(tie_adjusted_wins / len(strategy_rows), 5),
            "avg_total": round(statistics.fmean(totals), 3),
            "median_total": round(statistics.median(totals), 3),
            "top10_total": round(percentile(totals, 0.90), 3),
            "top5_total": round(percentile(totals, 0.95), 3),
            "top1_total": round(percentile(totals, 0.99), 3),
            "max_total": round(max(totals), 3),
        })
    return summaries


def mean_or_zero(values: list[float]) -> float:
    return statistics.fmean(values) if values else 0.0


def safe_ratio(numerator: int, denominator: int) -> float:
    return numerator / denominator if denominator else 0.0


def write_csv(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        return
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)


def run_all(args) -> None:
    validate_revenge_scoring_modes()
    teams = load_teams(args.teams)
    rng = random.Random(args.seed)
    summary_rows = []
    phase_rows = []
    winner_distribution_rows = []
    strategy_performance_rows = []
    zombie_rows = []
    revenge_rows = []

    for result_mode in args.result_modes:
        for strategy_set in args.strategy_sets:
            rows = [run_one(teams, result_mode, strategy_set, args.revenge_mode, args.phase1_point_mode, rng) for _ in range(args.iterations)]
            summary = summarize(result_mode, strategy_set, args.revenge_mode, args.phase1_point_mode, rows)
            summary_rows.append(summary)
            strategy_performance_rows.extend(summarize_strategy_performance(result_mode, strategy_set, args.revenge_mode, args.phase1_point_mode, rows))
            phase_rows.append({key: summary[key] for key in ("result_mode", "strategy_set", "revenge_mode", "phase1_point_mode", "phase1_avg", "revenge_avg", "phase1_plus_revenge_avg", "phase2_avg", "phase3_avg", "phase_balance_ok", "phase_balance_with_revenge_ok")})
            zombie_rows.append({key: summary[key] for key in ("result_mode", "strategy_set", "revenge_mode", "phase1_point_mode", "zombie_activation_rate", "zombie_hit_rate", "zombie_half_rate", "zombie_zero_rate", "winner_changed_by_zombie_rate")})
            revenge_rows.append({key: summary[key] for key in ("result_mode", "strategy_set", "revenge_mode", "phase1_point_mode", "revenge_activation_rate", "revenge_score_avg_when_used")})

            buckets = Counter(int(row["winner_score"] // 25 * 25) for row in rows)
            for bucket, count in sorted(buckets.items()):
                winner_distribution_rows.append({
                    "result_mode": result_mode,
                    "strategy_set": strategy_set,
                    "revenge_mode": args.revenge_mode,
                    "phase1_point_mode": args.phase1_point_mode,
                    "winner_score_bucket": f"{bucket}-{bucket + 24}",
                    "count": count,
                    "rate": round(count / len(rows), 5),
                })

    write_csv(args.output / "summary.csv", summary_rows)
    write_csv(args.output / "strategy_performance.csv", strategy_performance_rows)
    write_csv(args.output / "phase_breakdown.csv", phase_rows)
    write_csv(args.output / "winner_distribution.csv", winner_distribution_rows)
    write_csv(args.output / "zombie_impact.csv", zombie_rows)
    write_csv(args.output / "revenge_impact.csv", revenge_rows)


def parse_args() -> argparse.Namespace:
    base = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="YOSO Summer Koshien 2026 rule balance simulator")
    parser.add_argument("--teams", type=Path, default=base / "data" / "teams_2025.csv")
    parser.add_argument("--output", type=Path, default=base / "outputs")
    parser.add_argument("--iterations", type=int, default=2000)
    parser.add_argument("--seed", type=int, default=202608)
    parser.add_argument("--result-modes", nargs="+", choices=sorted(RESULT_MODES), default=sorted(RESULT_MODES))
    parser.add_argument("--strategy-sets", nargs="+", choices=sorted(STRATEGY_SETS), default=sorted(STRATEGY_SETS))
    parser.add_argument("--revenge-mode", choices=REVENGE_MODES, default="full")
    parser.add_argument("--phase1-point-mode", choices=PHASE1_POINT_MODES, default="boosted")
    return parser.parse_args()


if __name__ == "__main__":
    run_all(parse_args())
