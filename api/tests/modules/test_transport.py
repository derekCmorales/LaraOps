from __future__ import annotations

from app.modules.transport.models import TransportRequest
from app.modules.transport.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose
import json
from pathlib import Path

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def test_transport_01_cost_and_balance():
    data = json.loads((FIXTURES / "transport_01.json").read_text(encoding="utf-8"))
    result = solve(TransportRequest(**data["request"]))
    expect = data["expect"]
    assert result.status == SolveStatus.optimal
    assert result.module == "transport"
    assert_allclose(result.solution.objective_value, expect["objective_value"], atol=1e-4)
    assert result.iterations is not None and len(result.iterations) > 0
    ship = result.solution.variables
    assert_allclose(ship.get("A->X", 0) + ship.get("A->Y", 0), 20.0, atol=1e-4)
    assert_allclose(ship.get("B->X", 0) + ship.get("B->Y", 0), 30.0, atol=1e-4)
    assert_allclose(ship.get("A->X", 0) + ship.get("B->X", 0), 10.0, atol=1e-4)
    assert_allclose(ship.get("A->Y", 0) + ship.get("B->Y", 0), 40.0, atol=1e-4)
    assert result.sensitivity is not None
    assert result.sensitivity.reduced_costs is not None


def test_transport_least_cost():
    data = json.loads((FIXTURES / "transport_01.json").read_text(encoding="utf-8"))
    req = dict(data["request"])
    req["method"] = "least_cost"
    result = solve(TransportRequest(**req))
    assert result.status == SolveStatus.optimal
    assert any(s.method == "least_cost" for s in result.iterations or [])
