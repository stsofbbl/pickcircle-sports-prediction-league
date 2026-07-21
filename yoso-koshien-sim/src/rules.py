from __future__ import annotations

from dataclasses import dataclass
from math import sqrt


ODDS_CAP = 50.0
PHASE1_PICK_COUNT = 8
PHASE1_MAX_ROUND2_START = 3
PHASE2_DRAFT_COUNT = 4
CAPTAIN_MULTIPLIER = 1.2

PHASE1_POINT_TABLES = {
    "current": {
        "initial_loss": 0.0,
        "first_win_then_loss": 1.0,
        "best16": 1.0,
        "best8": 1.5,
        "best4": 2.0,
        "runner_up": 3.0,
        "champion": 5.0,
    },
    "boosted": {
        "initial_loss": 0.0,
        "first_win_then_loss": 1.0,
        "best16": 1.5,
        "best8": 2.0,
        "best4": 2.5,
        "runner_up": 3.5,
        "champion": 5.0,
    },
}

PHASE2_POINTS = {
    "best16": 0.0,
    "best8": 20.0,
    "best4": 40.0,
    "runner_up": 60.0,
    "champion": 100.0,
}

FINAL_SCORE_EXACT_POINTS = 50.0
FINAL_SCORE_NEAREST_POINTS = 30.0


@dataclass(frozen=True)
class Team:
    team_id: str
    school_name: str
    prefecture: str
    start_round: int
    odds: float

    @property
    def sqrt_odds(self) -> float:
        return sqrt(self.odds)

    @property
    def sqrt_odds_capped(self) -> float:
        return min(self.sqrt_odds, ODDS_CAP)

    @property
    def strength(self) -> float:
        return 1.0 / max(self.odds, 0.01)


@dataclass
class PlayerState:
    name: str
    strategy: str
    phase1_picks: list[str]
    captain: str
    phase2_picks: list[str]
    revenge_pick: str | None
    zombie_target: str | None
    final_prediction: dict[str, int | str] | None

