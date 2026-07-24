from __future__ import annotations

from app.modules.goal_programming.models import Goal, GoalProgrammingRequest
from app.modules.goal_programming.solver import solve
from app.modules.lp.models import ConstraintSense
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose


def test_goal_programming_basic():
    req = GoalProgrammingRequest(
        goals=[
            Goal(id="g1", coeffs={"x": 1}, sense=ConstraintSense.eq, target=10, weight_neg=1, weight_pos=1),
        ],
    )
    result = solve(req)
    assert result.status == SolveStatus.optimal
    assert_allclose(result.solution.variables["x"], 10.0)


def test_goal_programming_two_goals():
    req = GoalProgrammingRequest(
        goals=[
            Goal(id="profit", coeffs={"x": 5, "y": 3}, sense=ConstraintSense.eq, target=100, priority=1),
            Goal(id="labor", coeffs={"x": 2, "y": 1}, sense=ConstraintSense.eq, target=40, priority=2),
        ],
    )
    result = solve(req)
    assert result.status == SolveStatus.optimal
    assert result.solution.objective_value is not None
