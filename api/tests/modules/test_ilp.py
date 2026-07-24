from __future__ import annotations

import json
from pathlib import Path

from app.modules.ilp.models import ILPRequest
from app.modules.ilp.solver import solve
from app.modules.lp.models import ConstraintSense, LPConstraint
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def test_ilp_integer_floor():
    req = ILPRequest(
        sense="max",
        objective={"y": 1},
        constraints=[
            LPConstraint(id="c1", coeffs={"y": 1}, sense=ConstraintSense.le, rhs=3.7),
        ],
        integer_vars=["y"],
    )
    result = solve(req)
    assert result.status == SolveStatus.optimal
    assert result.module == "integer_programming"
    assert_allclose(result.solution.variables["y"], 3.0, atol=1e-6)
    assert result.sensitivity is None
    # The Branch & Bound tree must now be exposed via `iterations`.
    assert result.iterations is not None
    assert len(result.iterations) >= 1
    assert all(step.method == "branch_bound" for step in result.iterations)


def test_ilp_branch_and_bound_textbook():
    data = json.loads((FIXTURES / "ilp_01.json").read_text(encoding="utf-8"))
    result = solve(ILPRequest.model_validate(data["request"]))
    exp = data["expect"]
    assert result.status == SolveStatus.optimal
    assert result.module == "integer_programming"
    assert_allclose(result.solution.variables, exp["variables"], atol=1e-6)
    assert_allclose(result.solution.objective_value, exp["objective_value"], atol=1e-6)
    assert_allclose(
        result.solution.metrics["lp_relaxation_objective"],
        exp["lp_relaxation_objective"],
        atol=1e-4,
    )
    # Integrality gap must be reported.
    assert "gap_absolute" in result.solution.metrics
    assert "gap_percent" in result.solution.metrics
    assert result.solution.metrics["nodes_explored"] >= 1
    assert result.iterations is not None
    assert any(step.meta.get("branch_variable") for step in result.iterations)
    assert result.tables is not None
    assert any(t.name == "bb_nodes" for t in result.tables)


def test_ilp_binary_knapsack_textbook():
    data = json.loads((FIXTURES / "ilp_02.json").read_text(encoding="utf-8"))
    result = solve(ILPRequest.model_validate(data["request"]))
    exp = data["expect"]
    assert result.status == SolveStatus.optimal
    assert_allclose(result.solution.variables, exp["variables"], atol=1e-6)
    assert_allclose(result.solution.objective_value, exp["objective_value"], atol=1e-6)


def test_ilp_node_limit_warns():
    data = json.loads((FIXTURES / "ilp_01.json").read_text(encoding="utf-8"))
    req = ILPRequest.model_validate(data["request"])
    req = req.model_copy(update={"max_nodes": 1})
    result = solve(req)
    assert result.solution.metrics["node_limit_reached"] == 1.0
    assert any("Límite de nodos" in w for w in result.warnings)


def test_ilp_infeasible_relaxation():
    req = ILPRequest(
        sense="max",
        objective={"x": 1},
        constraints=[
            LPConstraint(id="c1", coeffs={"x": 1}, sense=ConstraintSense.ge, rhs=10),
            LPConstraint(id="c2", coeffs={"x": 1}, sense=ConstraintSense.le, rhs=5),
        ],
        integer_vars=["x"],
    )
    result = solve(req)
    assert result.status == SolveStatus.infeasible
