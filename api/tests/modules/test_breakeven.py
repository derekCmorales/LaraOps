from __future__ import annotations

from app.modules.breakeven.models import BreakevenRequest
from app.modules.breakeven.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose


def test_breakeven_classic():
    # F=1000, V=10, P=20 -> BEP=100
    result = solve(BreakevenRequest(fixed_cost=1000, variable_cost=10, price=20, volume=150))
    assert result.status == SolveStatus.ok
    assert result.module == "breakeven"
    assert_allclose(result.solution.metrics["BEP_units"], 100.0)
    assert_allclose(result.solution.metrics["BEP_revenue"], 2000.0)
    assert_allclose(result.solution.metrics["profit_at_volume"], 500.0)
    assert result.graph is not None
    assert {s["name"] for s in result.graph.series} == {"TR", "TC"}
