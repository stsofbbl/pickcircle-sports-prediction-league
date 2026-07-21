from __future__ import annotations

from collections import Counter

from .rules import PHASE2_POINTS, PlayerState


def select_zombie_target(
    zombie: PlayerState,
    players: list[PlayerState],
    best4: set[str],
    teams,
    rng,
) -> str | None:
    if any(team_id in best4 for team_id in zombie.phase2_picks):
        return None
    other_owned = []
    for player in players:
        if player.name == zombie.name:
            continue
        other_owned.extend(team_id for team_id in player.phase2_picks if team_id in best4)
    candidates = sorted(set(other_owned))
    if not candidates:
        return None
    weights = [teams[team_id].odds for team_id in candidates]
    return rng.choices(candidates, weights=weights, k=1)[0]


def apply_zombie_penalty(players: list[PlayerState], finish_by_team: dict[str, str]) -> tuple[dict[str, float], dict[str, int]]:
    hit_counts = Counter()
    for player in players:
        target = player.zombie_target
        if target and finish_by_team.get(target) == "best4":
            hit_counts[target] += 1

    adjusted = {}
    for team_id, count in hit_counts.items():
        if count == 1:
            adjusted[team_id] = PHASE2_POINTS["best4"] / 2
        elif count >= 2:
            adjusted[team_id] = 0.0
    return adjusted, dict(hit_counts)
