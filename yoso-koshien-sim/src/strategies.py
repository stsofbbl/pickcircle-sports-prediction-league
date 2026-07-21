from __future__ import annotations

from .rules import PHASE1_MAX_ROUND2_START, PHASE1_PICK_COUNT, PHASE2_DRAFT_COUNT, PlayerState, Team


STRATEGY_SETS = {
    "conservative": ["conservative"] * 4,
    "balanced": ["balanced"] * 4,
    "underdog": ["underdog"] * 4,
    "longshot": ["longshot"] * 4,
    "mixed": ["conservative", "balanced", "underdog", "longshot"],
}


def strategy_weight(team: Team, strategy: str) -> float:
    rank_strength = 1.0 / max(team.odds, 0.01)
    if strategy == "conservative":
        return rank_strength**1.4
    if strategy == "balanced":
        return rank_strength**0.65 * team.sqrt_odds_capped**0.15
    if strategy == "underdog":
        return team.sqrt_odds_capped**0.85
    if strategy == "longshot":
        return team.sqrt_odds_capped**1.35
    return 1.0


def weighted_sample_without_replacement(candidates: list[str], weights: list[float], count: int, rng) -> list[str]:
    pool = list(zip(candidates, weights))
    selected = []
    while pool and len(selected) < count:
        total = sum(max(weight, 0.000001) for _, weight in pool)
        point = rng.random() * total
        acc = 0.0
        for index, (item, weight) in enumerate(pool):
            acc += max(weight, 0.000001)
            if acc >= point:
                selected.append(item)
                pool.pop(index)
                break
    return selected


def select_phase1_teams(strategy: str, teams: dict[str, Team], rng) -> list[str]:
    selected: list[str] = []
    team_ids = list(teams)
    while len(selected) < PHASE1_PICK_COUNT:
        candidates = [
            team_id for team_id in team_ids
            if team_id not in selected
            and (
                teams[team_id].start_round == 1
                or sum(1 for picked in selected if teams[picked].start_round == 2) < PHASE1_MAX_ROUND2_START
            )
        ]
        weights = [strategy_weight(teams[team_id], strategy) for team_id in candidates]
        selected.extend(weighted_sample_without_replacement(candidates, weights, 1, rng))
    return selected


def select_captain(strategy: str, picks: list[str], teams: dict[str, Team], rng) -> str:
    if strategy in ("conservative", "balanced"):
        return min(picks, key=lambda team_id: teams[team_id].odds)
    weights = [teams[team_id].sqrt_odds_capped for team_id in picks]
    return rng.choices(picks, weights=weights, k=1)[0]


def create_players(strategy_set: str, teams: dict[str, Team], rng) -> list[PlayerState]:
    strategies = STRATEGY_SETS[strategy_set]
    players = []
    for index, strategy in enumerate(strategies, start=1):
        picks = select_phase1_teams(strategy, teams, rng)
        players.append(PlayerState(
            name=f"player_{index}_{strategy}",
            strategy=strategy,
            phase1_picks=picks,
            captain=select_captain(strategy, picks, teams, rng),
            phase2_picks=[],
            revenge_pick=None,
            zombie_target=None,
            final_prediction=None,
        ))
    return players


def draft_phase2_teams(players: list[PlayerState], best16: set[str], provisional_scores: dict[str, float], teams, rng) -> None:
    order = sorted(players, key=lambda player: (provisional_scores[player.name], rng.random()))
    rounds = []
    for round_index in range(PHASE2_DRAFT_COUNT):
        rounds.append(order if round_index % 2 == 0 else list(reversed(order)))

    available = set(best16)
    for draft_round in rounds:
        for player in draft_round:
            if not available:
                return
            candidates = sorted(available)
            weights = [strategy_weight(teams[team_id], player.strategy) for team_id in candidates]
            pick = weighted_sample_without_replacement(candidates, weights, 1, rng)[0]
            player.phase2_picks.append(pick)
            available.remove(pick)

