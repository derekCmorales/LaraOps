from __future__ import annotations

from app.modules.quality_control.models import QualityControlRequest
from app.modules.quality_control.solver import solve
from app.schemas.common import SolveStatus


def test_xbar_r():
    req = QualityControlRequest(
        chart="xbar_r",
        samples=[
            [10, 11, 12, 10, 11],
            [11, 11, 10, 12, 11],
            [10, 10, 11, 11, 10],
            [12, 13, 12, 11, 12],
        ],
    )
    result = solve(req)
    assert result.status == SolveStatus.ok
    assert "xbar_bar" in result.solution.metrics
    assert result.graph is not None


def test_c_chart():
    req = QualityControlRequest(chart="c", counts=[2, 3, 1, 4, 2, 3, 2])
    result = solve(req)
    assert result.status == SolveStatus.ok
    assert "c_bar" in result.solution.metrics
