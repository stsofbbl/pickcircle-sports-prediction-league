from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SIM_ROOT = Path(__file__).resolve().parents[1]
if str(SIM_ROOT) not in sys.path:
    sys.path.insert(0, str(SIM_ROOT))

from src.phase3 import calculate_phase3_scores
from src.rules import PHASE1_POINT_TABLES, PHASE2_POINTS, PlayerState, Team
from src.scoring import calculate_phase1_score, calculate_phase2_score
from src.strategies import draft_phase2_teams
from src.zombie import apply_zombie_penalty


class FixedRandom:
    def __init__(self, values: list[float]):
        self.values = iter(values)

    def random(self) -> float:
        return next(self.values, 0.0)


def make_player(name: str, *, phase2_picks: list[str] | None = None) -> PlayerState:
    return PlayerState(
        name=name,
        strategy="balanced",
        phase1_picks=[],
        captain="",
        phase2_picks=list(phase2_picks or []),
        revenge_pick=None,
        zombie_target=None,
        final_prediction=None,
    )


def make_draft_teams() -> dict[str, Team]:
    return {
        f"T{index:02d}": Team(f"T{index:02d}", f"Team {index}", "test", 1, float(index + 1))
        for index in range(1, 17)
    }


class OfficialScoringTests(unittest.TestCase):
    def test_confirmed_point_tables_and_phase_specific_multipliers(self):
        self.assertEqual(
            PHASE1_POINT_TABLES["boosted"],
            {
                "initial_loss": 0.0,
                "first_win_then_loss": 1.0,
                "best16": 1.5,
                "best8": 2.0,
                "best4": 2.5,
                "runner_up": 3.5,
                "champion": 5.0,
            },
        )
        self.assertEqual(
            PHASE2_POINTS,
            {"best16": 0.0, "best8": 20.0, "best4": 40.0, "runner_up": 60.0, "champion": 100.0},
        )

        team = Team("T", "Team", "test", 1, 100.0)
        player = make_player("p", phase2_picks=["T"])
        player.phase1_picks = ["T"]
        player.captain = "T"
        self.assertEqual(calculate_phase1_score(player, {"T": "champion"}, {"T": team}, "boosted"), 60.0)
        self.assertEqual(calculate_phase2_score(player, {"T": "champion"}), 100.0)


class SnakeDraftTests(unittest.TestCase):
    @staticmethod
    def deterministic_pick(candidates, _weights, _count, _rng):
        return [candidates[0]]

    def test_four_players_receive_four_unique_picks_in_official_snake_order(self):
        players = [make_player(f"p{index}") for index in range(1, 5)]
        scores = {"p1": 10.0, "p2": 20.0, "p3": 30.0, "p4": 40.0}
        with patch("src.strategies.weighted_sample_without_replacement", side_effect=self.deterministic_pick):
            draft_phase2_teams(
                players,
                set(make_draft_teams()),
                scores,
                make_draft_teams(),
                FixedRandom([0.1, 0.2, 0.3, 0.4]),
            )

        self.assertEqual(players[0].phase2_picks, ["T01", "T08", "T09", "T16"])
        self.assertEqual(players[1].phase2_picks, ["T02", "T07", "T10", "T15"])
        self.assertEqual(players[2].phase2_picks, ["T03", "T06", "T11", "T14"])
        self.assertEqual(players[3].phase2_picks, ["T04", "T05", "T12", "T13"])
        all_picks = [team_id for player in players for team_id in player.phase2_picks]
        self.assertEqual(len(all_picks), 16)
        self.assertEqual(len(set(all_picks)), 16)

    def test_tied_order_is_reproducible_with_injected_random_values(self):
        def run_once():
            players = [make_player(f"p{index}") for index in range(1, 5)]
            scores = {player.name: 10.0 for player in players}
            with patch("src.strategies.weighted_sample_without_replacement", side_effect=self.deterministic_pick):
                draft_phase2_teams(
                    players,
                    set(make_draft_teams()),
                    scores,
                    make_draft_teams(),
                    FixedRandom([0.4, 0.1, 0.3, 0.2]),
                )
            return {player.name: player.phase2_picks for player in players}

        first = run_once()
        second = run_once()
        self.assertEqual(first, second)
        self.assertEqual(first["p2"][0], "T01")
        self.assertEqual(first["p4"][0], "T02")
        self.assertEqual(first["p3"][0], "T03")
        self.assertEqual(first["p1"][0], "T04")


class SpecialRuleTests(unittest.TestCase):
    def test_phase3_exact_and_nearest_scores_are_deterministic(self):
        actual = {"champion": "A", "runner_up": "B", "champion_score": 5, "runner_up_score": 3}
        exact = make_player("exact")
        exact.final_prediction = dict(actual)
        miss = make_player("miss")
        miss.final_prediction = {"champion": "A", "runner_up": "B", "champion_score": 6, "runner_up_score": 3}
        scores, exact_flags = calculate_phase3_scores([exact, miss], actual)
        self.assertEqual(scores, {"exact": 50.0, "miss": 0.0})
        self.assertEqual(exact_flags, {"exact": True, "miss": False})

        nearest = make_player("nearest")
        nearest.final_prediction = {"champion": "A", "runner_up": "B", "champion_score": 6, "runner_up_score": 3}
        farther = make_player("farther")
        farther.final_prediction = {"champion": "B", "runner_up": "A", "champion_score": 8, "runner_up_score": 2}
        nearest_scores, _ = calculate_phase3_scores([nearest, farther], actual)
        self.assertEqual(nearest_scores, {"nearest": 30.0, "farther": 0.0})

    def test_zombie_penalty_halves_one_hit_and_zeroes_two_hits(self):
        one = make_player("one")
        one.zombie_target = "T"
        adjusted, hits = apply_zombie_penalty([one], {"T": "best4"})
        self.assertEqual(adjusted, {"T": 20.0})
        self.assertEqual(hits, {"T": 1})

        two = make_player("two")
        two.zombie_target = "T"
        adjusted, hits = apply_zombie_penalty([one, two], {"T": "best4"})
        self.assertEqual(adjusted, {"T": 0.0})
        self.assertEqual(hits, {"T": 2})


if __name__ == "__main__":
    unittest.main()
