from __future__ import annotations

import json
from pathlib import Path

from app.modules.queues.models import QueuesRequest
from app.modules.queues.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def test_queues_mm1():
    data = json.loads((FIXTURES / "queues_01.json").read_text(encoding="utf-8"))
    result = solve(QueuesRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    assert result.module == "queues"
    exp = data["expect"]
    for key, val in exp.items():
        assert_allclose(result.solution.metrics[key], val, atol=1e-6)


def test_queues_mms():
    data = json.loads((FIXTURES / "queues_02.json").read_text(encoding="utf-8"))
    result = solve(QueuesRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    assert_allclose(result.solution.metrics["rho"], data["expect"]["rho"], atol=1e-6)
    assert_allclose(result.solution.metrics["P0"], data["expect"]["P0"], atol=1e-6)
    assert result.tables is not None
    assert result.graph is not None


def test_queues_mg1():
    data = json.loads((FIXTURES / "queues_03.json").read_text(encoding="utf-8"))
    result = solve(QueuesRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    for key, val in data["expect"].items():
        assert_allclose(result.solution.metrics[key], val, atol=1e-6)
    assert any("Pollaczek" in w for w in result.warnings)


def test_queues_md1_matches_mg1_with_zero_sigma():
    data = json.loads((FIXTURES / "queues_04.json").read_text(encoding="utf-8"))
    result = solve(QueuesRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    for key, val in data["expect"].items():
        assert_allclose(result.solution.metrics[key], val, atol=1e-6)


def test_queues_mmsk_littles_law():
    data = json.loads((FIXTURES / "queues_05.json").read_text(encoding="utf-8"))
    result = solve(QueuesRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    m = result.solution.metrics
    for key, val in data["expect"].items():
        assert_allclose(m[key], val, atol=1e-6)
    # Little's law identities must hold internally regardless of hardcoded numbers.
    assert_allclose(m["L"], m["Lq"] + m["lambda_eff"] / 4, atol=1e-6)
    assert_allclose(m["W"], m["L"] / m["lambda_eff"], atol=1e-6)
    assert_allclose(m["Wq"], m["Lq"] / m["lambda_eff"], atol=1e-6)
    assert result.tables is not None
    assert result.graph is not None


def test_queues_mm1_unstable_returns_infinite_metrics():
    result = solve(QueuesRequest.model_validate({"model": "M/M/1", "lambda": 10, "mu": 8}))
    assert result.status == SolveStatus.ok
    assert result.solution.metrics["L"] == float("inf")
    assert result.solution.metrics["Wq"] == float("inf")
    assert any("inestable" in w for w in result.warnings)


def test_queues_costs_and_optimize_s():
    result = solve(
        QueuesRequest.model_validate(
            {
                "model": "M/M/s",
                "lambda": 10,
                "mu": 6,
                "s": 2,
                "cost_waiting_per_unit_time": 5,
                "cost_server_per_unit_time": 20,
                "optimize_s": True,
                "s_max": 5,
            }
        )
    )
    assert result.status == SolveStatus.ok
    assert "cost_total" in result.solution.metrics
    cost_table = next(t for t in result.tables or [] if t.name == "cost_by_s")
    optimal_rows = [row for row in cost_table.rows if row[-1] is True]
    assert len(optimal_rows) == 1
    assert any("óptimo" in w or "optimo" in w for w in result.warnings)
