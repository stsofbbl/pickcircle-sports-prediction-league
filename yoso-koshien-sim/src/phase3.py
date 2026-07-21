from __future__ import annotations

from .rules import FINAL_SCORE_EXACT_POINTS, FINAL_SCORE_NEAREST_POINTS, PlayerState


def predict_final_score(player: PlayerState, finalist_a: str, finalist_b: str, teams, rng) -> dict[str, int | str]:
    favorite, underdog = sorted([finalist_a, finalist_b], key=lambda team_id: teams[team_id].odds)
    favorite_bias = {
        "conservative": 0.72,
        "balanced": 0.60,
        "underdog": 0.46,
        "longshot": 0.38,
    }.get(player.strategy, 0.56)
    champion = favorite if rng.random() < favorite_bias else underdog
    runner_up = finalist_b if champion == finalist_a else finalist_a
    winner_score = max(1, int(round(rng.gauss(5.0, 1.9))))
    loser_score = max(0, min(winner_score - 1, int(round(rng.gauss(3.2, 1.7)))))
    return {
        "champion": champion,
        "runner_up": runner_up,
        "champion_score": winner_score,
        "runner_up_score": loser_score,
    }


def calculate_phase3_scores(players: list[PlayerState], actual_final: dict[str, int | str]) -> tuple[dict[str, float], dict[str, bool]]:
    scores = {player.name: 0.0 for player in players}
    exact = {}
    for player in players:
        prediction = player.final_prediction or {}
        is_exact = (
            prediction.get("champion") == actual_final["champion"]
            and prediction.get("runner_up") == actual_final["runner_up"]
            and int(prediction.get("champion_score", -1)) == int(actual_final["champion_score"])
            and int(prediction.get("runner_up_score", -1)) == int(actual_final["runner_up_score"])
        )
        exact[player.name] = is_exact
        if is_exact:
            scores[player.name] = FINAL_SCORE_EXACT_POINTS
    if any(exact.values()):
        return scores, exact

    ranked = []
    actual_margin = int(actual_final["champion_score"]) - int(actual_final["runner_up_score"])
    actual_total = int(actual_final["champion_score"]) + int(actual_final["runner_up_score"])
    for player in players:
        prediction = player.final_prediction or {}
        champion_score = int(prediction.get("champion_score", 0))
        runner_up_score = int(prediction.get("runner_up_score", 0))
        error_sum = abs(champion_score - int(actual_final["champion_score"])) + abs(runner_up_score - int(actual_final["runner_up_score"]))
        winner_hit_rank = 0 if prediction.get("champion") == actual_final["champion"] else 1
        margin_error = abs((champion_score - runner_up_score) - actual_margin)
        total_error = abs((champion_score + runner_up_score) - actual_total)
        ranked.append((error_sum, winner_hit_rank, margin_error, total_error, player.name))
    best_key = min(item[:4] for item in ranked)
    nearest_names = [name for *key, name in ranked if tuple(key) == best_key]
    for name in nearest_names:
        scores[name] = FINAL_SCORE_NEAREST_POINTS
    return scores, exact
