from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.modules.eoq.models import EOQRequest
from app.modules.eoq.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def test_eoq_01_textbook():
    data = _load("eoq_01.json")
    result = solve(EOQRequest(**data["request"]))
    expect = data["expect"]
    assert result.status == SolveStatus.ok
    assert result.module == "eoq"
    assert result.iterations is None
    assert result.sensitivity is None
    assert_allclose(result.solution.metrics["Q_star"], expect["Q_star"])
    assert_allclose(result.solution.metrics["TC"], expect["TC"])
    assert_allclose(result.solution.metrics["orders_per_year"], expect["orders_per_year"])
    assert_allclose(result.solution.metrics["TC_ordering"], expect["TC_ordering"])
    assert_allclose(result.solution.metrics["TC_holding"], expect["TC_holding"])
    assert_allclose(result.solution.variables["Q"], expect["Q_star"])
    assert result.graph is not None
    assert result.graph.type == "xy"
    names = {s["name"] for s in result.graph.series}
    assert names == {"relevant_cost", "ordering", "holding"}


def test_eoq_02_textbook():
    data = _load("eoq_02.json")
    result = solve(EOQRequest(**data["request"]))
    expect = data["expect"]
    assert result.status == SolveStatus.ok
    assert_allclose(result.solution.metrics["Q_star"], expect["Q_star"])
    assert_allclose(result.solution.metrics["TC"], expect["TC"])
    assert_allclose(result.solution.metrics["orders_per_year"], expect["orders_per_year"])


def test_eoq_invalid_d_zero():
    with pytest.raises(ValidationError):
        EOQRequest(D=0, S=10, H=0.5)


def test_eoq_cost_breakdown_separates_purchase_cost():
    result = solve(EOQRequest(D=1000, S=10, H=0.5, C=5))
    m = result.solution.metrics
    assert_allclose(m["relevant_cost"], 100.0)
    assert_allclose(m["purchase_cost"], 5000.0)
    assert_allclose(m["TC"], 5100.0)
    assert_allclose(m["avg_inventory"], 100.0)
    rel = next(s for s in result.graph.series if s["name"] == "relevant_cost")
    # La curva graficada no incluye el costo de compra y su mínimo cae justo en Q*.
    best = min(range(len(rel["y"])), key=lambda i: rel["y"][i])
    assert_allclose(rel["x"][best], 200.0)
    assert_allclose(rel["y"][best], 100.0)
    assert "costo de compra" in result.graph.subtitle


def test_eoq_reorder_point_with_lead_time():
    result = solve(EOQRequest(D=1000, S=10, H=0.5, lead_time=5, working_days=250))
    m = result.solution.metrics
    assert_allclose(m["daily_demand"], 4.0)
    assert_allclose(m["reorder_point"], 20.0)
    assert_allclose(m["time_between_orders_days"], 50.0)
    assert result.warnings == []
    labels = [row[0] for row in result.tables[0].rows]
    assert any("Punto de reorden" in label for label in labels)


def test_eoq_without_lead_time_has_no_reorder_point():
    result = solve(EOQRequest(D=1000, S=10, H=0.5))
    assert "reorder_point" not in result.solution.metrics
    assert_allclose(result.solution.metrics["time_between_orders_days"], 73.0)


def test_eoq_warns_when_lead_time_exceeds_cycle():
    result = solve(EOQRequest(D=1000, S=10, H=0.5, lead_time=80, working_days=250))
    assert_allclose(result.solution.metrics["reorder_point"], 320.0)
    assert any("más de un pedido en tránsito" in w for w in result.warnings)


def test_eoq_invalid_working_days():
    with pytest.raises(ValidationError):
        EOQRequest(D=1000, S=10, H=0.5, working_days=0)
    with pytest.raises(ValidationError):
        EOQRequest(D=1000, S=10, H=0.5, lead_time=-1)
