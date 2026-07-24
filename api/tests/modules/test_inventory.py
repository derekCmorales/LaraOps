from __future__ import annotations

import json
from pathlib import Path

from app.modules.inventory.models import InventoryRequest
from app.modules.inventory.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def test_inventory_eoq():
    data = json.loads((FIXTURES / "inventory_01.json").read_text(encoding="utf-8"))
    result = solve(InventoryRequest(**data["request"]))
    assert result.status == SolveStatus.ok
    assert result.module == "inventory"
    assert_allclose(result.solution.metrics["Q_star"], data["expect"]["Q_star"])
    assert_allclose(result.solution.metrics["TC"], data["expect"]["TC"])


def test_inventory_discounts():
    data = json.loads((FIXTURES / "inventory_02.json").read_text(encoding="utf-8"))
    result = solve(InventoryRequest(**data["request"]))
    assert result.status == SolveStatus.ok
    assert_allclose(result.solution.metrics["C"], data["expect"]["best_C"], atol=1e-6)
    assert result.tables is not None


def test_inventory_eoq_sawtooth_graph():
    data = json.loads((FIXTURES / "inventory_01.json").read_text(encoding="utf-8"))
    result = solve(InventoryRequest(**data["request"]))
    assert result.graph is not None
    assert result.graph.type == "xy"


def test_inventory_epq():
    data = json.loads((FIXTURES / "inventory_03.json").read_text(encoding="utf-8"))
    result = solve(InventoryRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    for key, val in data["expect"].items():
        assert_allclose(result.solution.metrics[key], val, atol=1e-6)
    assert result.graph is not None


def test_inventory_backorder():
    data = json.loads((FIXTURES / "inventory_04.json").read_text(encoding="utf-8"))
    result = solve(InventoryRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    for key, val in data["expect"].items():
        assert_allclose(result.solution.metrics[key], val, atol=1e-6)
    # Q* = S* + I_max identity
    m = result.solution.metrics
    assert_allclose(m["Q_star"], m["S_star"] + m["I_max"], atol=1e-6)


def test_inventory_newsvendor():
    data = json.loads((FIXTURES / "inventory_05.json").read_text(encoding="utf-8"))
    result = solve(InventoryRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    for key, val in data["expect"].items():
        assert_allclose(result.solution.metrics[key], val, atol=1e-6)


def test_inventory_dynamic_lot_sizing_wagner_whitin():
    data = json.loads((FIXTURES / "inventory_06.json").read_text(encoding="utf-8"))
    result = solve(InventoryRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    for key, val in data["expect"].items():
        assert_allclose(result.solution.metrics[key], val, atol=1e-6)
    names = {t.name for t in result.tables or []}
    assert {"lot_sizing_plan", "method_comparison", "best_method"} <= names
    plan = next(t for t in result.tables or [] if t.name == "lot_sizing_plan")
    total_ordered = sum(row[2] for row in plan.rows)
    assert_allclose(total_ordered, sum(data["request"]["demand_periods"]), atol=1e-6)
