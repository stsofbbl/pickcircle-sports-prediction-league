from __future__ import annotations

from .rules import PlayerState


def select_revenge_team(
    player: PlayerState,
    best16: set[str],
    eliminated_by_team: dict[str, str],
    teams,
    rng,
) -> str | None:
    if any(team_id in best16 for team_id in player.phase1_picks):
        return None
    direct = [eliminated_by_team.get(team_id) for team_id in player.phase1_picks]
    candidates = [team_id for team_id in direct if team_id in best16]
    if not candidates:
        candidates = list(best16)
    if not candidates:
        return None
    weights = [teams[team_id].sqrt_odds_capped for team_id in candidates]
    return rng.choices(candidates, weights=weights, k=1)[0]

