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


def test_lp_equality_phase1_artificial_in_basis():
    """Regression: feasible equalities must not crash when Phase I leaves a zero artificial in basis."""
    req = LPRequest(
        sense="min",
        objective={"x1": 2, "x2": 6, "x3": 6, "x4": 2, "x5": 1, "x6": 2, "x7": 5, "x8": 7},
        constraints=[
            LPConstraint(id="R1", coeffs={"x1": 1, "x2": 1, "x3": 1, "x4": 1}, sense=ConstraintSense.eq, rhs=5000),
            LPConstraint(id="R2", coeffs={"x5": 1, "x6": 1, "x7": 1, "x8": 1}, sense=ConstraintSense.eq, rhs=1600),
            LPConstraint(id="R3", coeffs={"x1": 1, "x5": 1}, sense=ConstraintSense.eq, rhs=1400),
            LPConstraint(id="R4", coeffs={"x2": 1, "x6": 1}, sense=ConstraintSense.eq, rhs=3200),
            LPConstraint(id="R5", coeffs={"x3": 1, "x7": 1}, sense=ConstraintSense.eq, rhs=2000),
            LPConstraint(id="R6", coeffs={"x4": 1, "x8": 1}, sense=ConstraintSense.eq, rhs=0),
        ],
        variable_names=["x1", "x2", "x3", "x4", "x5", "x6", "x7", "x8"],
    )
    result = solve(req)
    assert result.status == SolveStatus.optimal
    assert_allclose(result.solution.objective_value, 27600.0, atol=LP_ATOL)


def _two_constraint_max() -> LPRequest:
    return LPRequest(
        sense="max",
        objective={"A": 2, "B": 3},
        constraints=[
            LPConstraint(id="R1", coeffs={"A": 1, "B": 3}, sense=ConstraintSense.le, rhs=6),
            LPConstraint(id="R2", coeffs={"A": 5, "B": 3}, sense=ConstraintSense.le, rhs=15),
        ],
    )


def test_lp_two_constraint_intersection():
    result = solve(_two_constraint_max())
    assert result.status == SolveStatus.optimal
    assert_allclose(result.solution.objective_value, 8.25, atol=LP_ATOL)
    assert_allclose(result.solution.variables, {"A": 2.25, "B": 1.25}, atol=LP_ATOL)

    assert result.tables
    table = next(t for t in result.tables if t.name == "vertices_feasible")
    assert table.columns[:3] == ["A", "B", "Z"]
    assert "origen" in table.columns
    assert "optimo" in table.columns

    intersection = next(
        row
        for row in table.rows
        if abs(float(row[0]) - 2.25) < LP_ATOL and abs(float(row[1]) - 1.25) < LP_ATOL
    )
    assert abs(float(intersection[2]) - 8.25) < LP_ATOL
    origen = str(intersection[3])
    assert "R1" in origen and "R2" in origen
    opt_idx = table.columns.index("optimo")
    assert str(intersection[opt_idx]).lower() in {"sí", "si", "yes", "1"}

    axis_vertex = next(
        row
        for row in table.rows
        if abs(float(row[0])) < LP_ATOL and abs(float(row[1]) - 2.0) < LP_ATOL
    )
    assert abs(float(axis_vertex[2]) - 6.0) < LP_ATOL
    assert str(axis_vertex[opt_idx]).lower() not in {"sí", "si", "yes", "1"}
