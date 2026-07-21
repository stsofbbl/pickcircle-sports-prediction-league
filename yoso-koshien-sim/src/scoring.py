from __future__ import annotations

from .rules import (
    CAPTAIN_MULTIPLIER,
    PHASE1_POINT_TABLES,
    PHASE2_POINTS,
    PlayerState,
    Team,
)

REVENGE_MODES = ("full", "discounted")
PHASE1_POINT_MODES = tuple(PHASE1_POINT_TABLES)


def phase1_points_for_mode(phase1_point_mode: str) -> dict[str, float]:
    try:
        return PHASE1_POINT_TABLES[phase1_point_mode]
    except KeyError as error:
        raise ValueError(f"Unsupported phase1_point_mode: {phase1_point_mode}") from error


def calculate_phase1_score(
    player: PlayerState,
    finish_by_team: dict[str, str],
    teams: dict[str, Team],
    phase1_point_mode: str = "current",
) -> float:
    phase1_points = phase1_points_for_mode(phase1_point_mode)
    score = 0.0
    for team_id in set(player.phase1_picks):
        if not team_id:
            continue
        base = phase1_points[finish_by_team[team_id]]
        multiplier = CAPTAIN_MULTIPLIER if player.captain == team_id else 1.0
        score += base * teams[team_id].sqrt_odds_capped * multiplier
    return score


def calculate_phase1_provisional_at_best16(
    player: PlayerState,
    best16: set[str],
    eliminated_before_best16: dict[str, str],
    teams: dict[str, Team],
    phase1_point_mode: str = "current",
) -> float:
    phase1_points = phase1_points_for_mode(phase1_point_mode)
    score = 0.0
    for team_id in set(player.phase1_picks):
        if team_id in best16:
            base = phase1_points["best16"]
        else:
            base = phase1_points[eliminated_before_best16.get(team_id, "initial_loss")]
        multiplier = CAPTAIN_MULTIPLIER if player.captain == team_id else 1.0
        score += base * teams[team_id].sqrt_odds_capped * multiplier
    return score


def calculate_revenge_score(
    revenge_pick: str | None,
    finish_by_team: dict[str, str],
    teams: dict[str, Team],
    revenge_mode: str = "full",
    phase1_point_mode: str = "current",
) -> float:
    if not revenge_pick:
        return 0.0
    if revenge_mode not in REVENGE_MODES:
        raise ValueError(f"Unsupported revenge_mode: {revenge_mode}")
    phase1_points = phase1_points_for_mode(phase1_point_mode)
    finish = finish_by_team[revenge_pick]
    reached_point = phase1_points[finish]
    if finish == "best16":
        return 0.0
    if revenge_mode == "full":
        base = reached_point
    else:
        base = max(0.0, reached_point - phase1_points["best16"])
    return base * teams[revenge_pick].sqrt_odds_capped


def validate_revenge_scoring_modes() -> None:
    team = Team(team_id="T", school_name="test", prefecture="test", start_round=1, odds=100.0)
    teams = {"T": team}
    expected_by_mode = {
        "current": {
            "best16": (0.0, 0.0),
            "best8": (15.0, 5.0),
            "best4": (20.0, 10.0),
            "runner_up": (30.0, 20.0),
            "champion": (50.0, 40.0),
        },
        "boosted": {
            "best16": (0.0, 0.0),
            "best8": (20.0, 5.0),
            "best4": (25.0, 10.0),
            "runner_up": (35.0, 20.0),
            "champion": (50.0, 35.0),
        },
    }
    for phase1_point_mode, expected in expected_by_mode.items():
        for finish, (full, discounted) in expected.items():
            finish_by_team = {"T": finish}
            actual_full = calculate_revenge_score("T", finish_by_team, teams, "full", phase1_point_mode)
            actual_discounted = calculate_revenge_score("T", finish_by_team, teams, "discounted", phase1_point_mode)
            if actual_full != full:
                raise AssertionError(f"{phase1_point_mode} full revenge score mismatch for {finish}: {actual_full} != {full}")
            if actual_discounted != discounted:
                raise AssertionError(f"{phase1_point_mode} discounted revenge score mismatch for {finish}: {actual_discounted} != {discounted}")


def calculate_phase2_score(
    player: PlayerState,
    finish_by_team: dict[str, str],
    zombie_adjusted_scores: dict[str, float] | None = None,
) -> float:
    score = 0.0
    for team_id in set(player.phase2_picks):
        if not team_id:
            continue
        if zombie_adjusted_scores and team_id in zombie_adjusted_scores:
            score += zombie_adjusted_scores[team_id]
            continue
        score += PHASE2_POINTS.get(finish_by_team[team_id], 0.0)
    return score


def calculate_total_score(phase1: float, revenge: float, phase2: float, phase3: float) -> float:
    return phase1 + revenge + phase2 + phase3
