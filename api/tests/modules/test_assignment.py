from __future__ import annotations

import numpy as np
from scipy.optimize import linear_sum_assignment

from app.modules.assignment.models import AssignmentRequest
from app.modules.assignment.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose


def test_assignment_matches_scipy():
    costs = [[9, 2, 7], [6, 4, 3], [5, 8, 1]]
    req = AssignmentRequest(
        agents=["A", "B", "C"],
        tasks=["X", "Y", "Z"],
        costs=costs,
        sense="min",
    )
    result = solve(req)
    assert result.status == SolveStatus.optimal
    rows, cols = linear_sum_assignment(np.array(costs))
    expected = float(sum(costs[r][c] for r, c in zip(rows, cols, strict=True)))
    assert_allclose(result.solution.objective_value, expected, atol=1e-6)
    assert result.iterations is not None
    assert any(s.method == "hungarian" for s in result.iterations)


def test_assignment_nonsquare_pads():
    req = AssignmentRequest(
        agents=["A", "B"],
        tasks=["X"],
        costs=[[1], [2]],
    )
    result = solve(req)
    assert result.status == SolveStatus.optimal
    assert any("no cuadrada" in w for w in result.warnings)
    # Only one real assignment
    assert result.solution.metrics["n_assignments"] == 1.0
