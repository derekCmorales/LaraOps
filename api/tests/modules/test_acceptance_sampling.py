from __future__ import annotations

from app.modules.acceptance_sampling.models import AcceptanceSamplingRequest
from app.modules.acceptance_sampling.solver import solve
from app.schemas.common import SolveStatus


def test_asa_oc_basics():
    result = solve(
        AcceptanceSamplingRequest(N=1000, n=50, c=2, p_points=[0.0, 0.02, 0.05, 0.10])
    )
    assert result.status == SolveStatus.ok
    assert result.module == "acceptance_sampling"
    assert result.graph is not None
    oc = next(t for t in result.tables if t.name == "oc_aoq")
    # At p=0, Pa should be 1
    assert abs(float(oc.rows[0][1]) - 1.0) < 1e-9
    # Pa decreases as p increases
    assert float(oc.rows[1][1]) >= float(oc.rows[3][1])
    assert result.solution.metrics["AOQL"] >= 0
