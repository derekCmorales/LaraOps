from __future__ import annotations

from app.modules.mrp.models import BomItem, MrpRequest
from app.modules.mrp.solver import solve
from app.schemas.common import SolveStatus


def test_mrp_simple():
    req = MrpRequest(
        items=["A", "B"],
        bom=[BomItem(parent="A", component="B", qty_per=2)],
        gross_requirements={"A": [0, 0, 50, 0]},
        on_hand={"A": 10, "B": 0},
        lead_times={"A": 1, "B": 1},
    )
    result = solve(req)
    assert result.status == SolveStatus.ok
    assert result.tables is not None
    assert len(result.tables) >= 2


def test_mrp_no_bom():
    req = MrpRequest(
        items=["X"],
        gross_requirements={"X": [10, 0, 20]},
        on_hand={"X": 5},
        lead_times={"X": 0},
    )
    result = solve(req)
    assert result.status == SolveStatus.ok
    assert result.solution.metrics["horizon"] == 3
