from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from scipy.optimize import linprog

from app.modules.lp.models import ConstraintSense, LPConstraint, LPRequest
from app.modules.lp.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"
LP_ATOL = 1e-4


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_lp_01_product_mix():
    data = _load("lp_01.json")
    result = solve(LPRequest(**data["request"]))
    expect = data["expect"]
    assert result.status == SolveStatus.optimal
    assert result.module == "linear_programming"
    assert_allclose(result.solution.objective_value, expect["objective_value"], atol=LP_ATOL)
    assert_allclose(result.solution.variables, expect["variables"], atol=LP_ATOL)
    assert result.iterations is not None and len(result.iterations) > 0
    assert result.sensitivity is not None
    assert len(result.sensitivity.shadow_prices) == 3


def test_lp_linprog_crosscheck():
    data = _load("lp_01.json")
    req = LPRequest(**data["request"])
    result = solve(req)
    c = -np.array([3.0, 2.0])
    A_ub = np.array([[2.0, 1.0], [1.0, 1.0], [1.0, 0.0]])
    b_ub = np.array([100.0, 80.0, 40.0])
    res = linprog(c, A_ub=A_ub, b_ub=b_ub, bounds=[(0, None), (0, None)], method="highs")
    assert res.success
    assert_allclose(result.solution.objective_value, float(-res.fun), atol=LP_ATOL)


def test_lp_infeasible():
    req = LPRequest(
        sense="max",
        objective={"x": 1},
        constraints=[
            LPConstraint(id="c1", coeffs={"x": 1}, sense=ConstraintSense.le, rhs=1),
            LPConstraint(id="c2", coeffs={"x": 1}, sense=ConstraintSense.ge, rhs=2),
        ],
    )
    result = solve(req)
    assert result.status == SolveStatus.infeasible


def test_lp_unbounded():
    req = LPRequest(
        sense="max",
        objective={"x": 1},
        constraints=[],
    )
    result = solve(req)
    assert result.status == SolveStatus.unbounded
