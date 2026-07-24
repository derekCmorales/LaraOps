from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.modules.pert_cpm.models import Activity, PertCpmRequest
from app.modules.pert_cpm.solver import PertCpmError, solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def test_pert_01_cpm_diamond():
    data = json.loads((FIXTURES / "pert_01.json").read_text(encoding="utf-8"))
    result = solve(PertCpmRequest(**data["request"]))
    expect = data["expect"]
    assert result.status == SolveStatus.ok
    assert result.module == "pert_cpm"
    assert_allclose(result.solution.metrics["project_duration"], expect["project_duration"])
    assert result.tables is not None
    cp_table = next(t for t in result.tables if t.name == "critical_path")
    path = [row[1] for row in cp_table.rows]
    assert path == expect["critical_path"]
    assert result.graph is not None
    assert result.graph.type == "network"


def test_pert_cycle_raises():
    req = PertCpmRequest(
        mode="cpm",
        activities=[
            Activity(id="A", predecessors=["B"], duration=1),
            Activity(id="B", predecessors=["A"], duration=1),
        ],
    )
    with pytest.raises(PertCpmError, match="cycle"):
        solve(req)


def test_pert_crashing_reduces_duration():
    # A(3)->B(4)->D(5) critical = 12; C(2) parallel after A
    # Crash B from 4 to 2 at cost slope (200-100)/(4-2)=50
    req = PertCpmRequest(
        mode="cpm",
        crash=True,
        crash_target=10,
        activities=[
            Activity(id="A", predecessors=[], duration=3, crash_time=3, normal_cost=50, crash_cost=50),
            Activity(id="B", predecessors=["A"], duration=4, crash_time=2, normal_cost=100, crash_cost=200),
            Activity(id="C", predecessors=["A"], duration=2, crash_time=2, normal_cost=40, crash_cost=40),
            Activity(id="D", predecessors=["B", "C"], duration=5, crash_time=5, normal_cost=80, crash_cost=80),
        ],
    )
    result = solve(req)
    assert result.status == SolveStatus.ok
    assert result.solution.metrics["project_duration"] <= 10.0 + 1e-6
    assert result.solution.metrics["crash_total_cost"] > 0
    assert result.iterations is not None and len(result.iterations) >= 1


def test_pert_crash_infeasible_status():
    req = PertCpmRequest(
        mode="cpm",
        crash=True,
        crash_target=1,
        activities=[
            Activity(id="A", predecessors=[], duration=5, crash_time=4, normal_cost=10, crash_cost=20),
        ],
    )
    result = solve(req)
    assert result.status == SolveStatus.infeasible
    assert result.solution.metrics["project_duration"] > 1
