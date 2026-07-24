from __future__ import annotations

from app.modules.dynamic_programming.models import DynamicProgrammingRequest, KnapsackItem
from app.modules.dynamic_programming.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose


def test_knapsack():
    req = DynamicProgrammingRequest(
        problem="knapsack",
        capacity=5,
        items=[
            KnapsackItem(id="a", weight=2, value=3),
            KnapsackItem(id="b", weight=3, value=4),
            KnapsackItem(id="c", weight=4, value=5),
        ],
    )
    result = solve(req)
    assert result.status == SolveStatus.optimal
    assert_allclose(result.solution.objective_value, 7.0)  # a+b


def test_stagecoach():
    req = DynamicProgrammingRequest(
        problem="stagecoach",
        stages=[["A"], ["B", "C"], ["D"]],
        costs={"A": {"B": 2, "C": 4}, "B": {"D": 3}, "C": {"D": 1}},
        origin="A",
        destination="D",
    )
    result = solve(req)
    assert_allclose(result.solution.metrics["path_cost"], 5.0)  # A-B-D or A-C-D=5
