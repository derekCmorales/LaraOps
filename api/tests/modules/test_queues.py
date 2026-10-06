from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from app.modules.queues.models import QueuesRequest
from app.modules.queues.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def _solve(body: dict):
    return solve(QueuesRequest.model_validate(body))


def _table(result, name):
    return next(t for t in result.tables or [] if t.name == name)


def test_queues_mm1():
    data = json.loads((FIXTURES / "queues_01.json").read_text(encoding="utf-8"))
    result = solve(QueuesRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    assert result.module == "queues"
    exp = data["expect"]
    for key, val in exp.items():
        assert_allclose(result.solution.metrics[key], val, atol=1e-6)
    assert_allclose(result.solution.metrics["Pw"], 2 / 3, atol=1e-12)


def test_queues_mms():
    data = json.loads((FIXTURES / "queues_02.json").read_text(encoding="utf-8"))
    result = solve(QueuesRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    m = result.solution.metrics
    assert_allclose(m["rho"], data["expect"]["rho"], atol=1e-6)
    assert_allclose(m["P0"], data["expect"]["P0"], atol=1e-6)
    # Lq = P0·r^s·ρ / (s!(1-ρ)²) = 125/33; Erlang C = 25/33.
    assert_allclose(m["Lq"], 125 / 33, atol=1e-9)
    assert_allclose(m["Pw"], 25 / 33, atol=1e-9)
    assert result.tables is not None
    assert result.graph is not None


def test_queues_mg1():
    data = json.loads((FIXTURES / "queues_03.json").read_text(encoding="utf-8"))
    result = solve(QueuesRequest.model_validate(data["request"]))
    assert result.status == SolveStatus.ok
    for key, val in data["expect"].items():
        assert_allclose(result.solution.metrics[key], val, atol=1e-6)
    formulas = _table(result, "formulas")
    assert any("Pollaczek" in row[0] for row in formulas.rows)
    assert result.warnings == []


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
    assert_allclose(m["lambda_lost"], 6 * m["P_block"], atol=1e-12)
    assert result.tables is not None
    assert result.graph is not None


def test_queues_mm1k_closed_form():
    lam, mu, K = 3.0, 4.0, 5
    r = lam / mu
    result = _solve({"model": "M/M/1/K", "lambda": lam, "mu": mu, "K": K})
    m = result.solution.metrics
    p0 = (1 - r) / (1 - r ** (K + 1))
    assert_allclose(m["P0"], p0, atol=1e-12)
    assert_allclose(m["P_block"], p0 * r**K, atol=1e-12)
    assert_allclose(m["rho"], 1 - p0, atol=1e-12)
    pn = _table(result, "Pn")
    assert len(pn.rows) == K + 1
    assert_allclose(pn.rows[-1][2], 1.0, atol=1e-12)


def test_queues_finite_capacity_does_not_overflow():
    # r^(K+1) desbordaba (OverflowError en Python, métricas nulas en el Worker).
    result = _solve({"model": "M/M/1/K", "lambda": 100, "mu": 1, "K": 500})
    m = result.solution.metrics
    assert all(math.isfinite(v) for v in m.values())
    assert_allclose(m["P_block"], 0.99, atol=1e-9)
    assert_allclose(m["lambda_eff"], 1.0, atol=1e-9)
    assert m["Pw"] <= 1 and m["rho"] <= 1


def test_queues_finite_population_machine_repair():
    # Taller con N = 10 máquinas, λ = 0.1 por máquina, 2 mecánicos con μ = 0.5.
    result = _solve({"model": "M/M/s/N", "lambda": 0.1, "mu": 0.5, "s": 2, "N": 10})
    m = result.solution.metrics
    assert_allclose(m["lambda_eff"], 0.1 * (10 - m["L"]), atol=1e-12)
    assert_allclose(m["customers_outside"], 10 - m["L"], atol=1e-12)
    assert_allclose(m["W"], m["L"] / m["lambda_eff"], atol=1e-12)
    assert len(_table(result, "Pn").rows) == 11


def test_queues_mm1_unstable_returns_infinite_metrics():
    result = solve(QueuesRequest.model_validate({"model": "M/M/1", "lambda": 10, "mu": 8}))
    assert result.status == SolveStatus.ok
    assert result.solution.metrics["L"] == float("inf")
    assert result.solution.metrics["Wq"] == float("inf")
    assert result.solution.metrics["s_min_stable"] == 2
    assert any("inestable" in w for w in result.warnings)
    assert result.graph is None


def test_queues_wait_probabilities_closed_forms():
    lam, mu, t = 10.0, 15.0, 0.1
    m = _solve({"model": "M/M/1", "lambda": lam, "mu": mu, "wait_threshold": t}).solution.metrics
    assert_allclose(m["P_w_gt_t"], math.exp(-mu * (1 - lam / mu) * t), atol=1e-12)
    assert_allclose(m["P_wq_gt_t"], (lam / mu) * math.exp(-mu * (1 - lam / mu) * t), atol=1e-12)


def test_queues_large_capacity_matches_infinite_model():
    base = {"lambda": 10, "mu": 6, "s": 2, "wait_threshold": 0.3}
    inf = _solve({"model": "M/M/s", **base}).solution.metrics
    fin = _solve({"model": "M/M/s/K", "K": 400, **base}).solution.metrics
    for key in ("L", "Lq", "W", "Wq", "P0", "Pw", "P_wq_gt_t", "P_w_gt_t"):
        assert_allclose(fin[key], inf[key], atol=1e-8)


def test_queues_cost_uses_one_server_in_single_server_models():
    result = _solve(
        {
            "model": "M/M/1",
            "lambda": 10,
            "mu": 15,
            "s": 2,
            "cost_waiting_per_unit_time": 1,
            "cost_server_per_unit_time": 10,
        }
    )
    m = result.solution.metrics
    assert m["cost_server"] == 10
    assert_allclose(m["cost_total"], 12, atol=1e-9)


def test_queues_waiting_cost_on_queue():
    m = _solve(
        {
            "model": "M/M/1",
            "lambda": 10,
            "mu": 15,
            "cost_waiting_per_unit_time": 3,
            "cost_server_per_unit_time": 0,
            "waiting_cost_basis": "queue",
        }
    ).solution.metrics
    assert_allclose(m["cost_waiting"], 3 * 4 / 3, atol=1e-9)


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
    cost_table = _table(result, "cost_by_s")
    assert [row[0] for row in cost_table.rows] == [2, 3, 4, 5]
    optimal_rows = [row for row in cost_table.rows if row[-1] is True]
    assert len(optimal_rows) == 1
    best = min(cost_table.rows, key=lambda row: row[-2])
    assert result.solution.metrics["s_optimal"] == best[0]
    assert_allclose(result.solution.metrics["cost_total_optimal"], best[-2], atol=1e-12)


def test_queues_pn_table_reaches_tail():
    result = _solve({"model": "M/M/1", "lambda": 9, "mu": 10})
    pn = _table(result, "Pn")
    assert pn.columns == ["n", "Pn", "acumulada"]
    assert pn.rows[-1][2] >= 0.999
    assert any("muy cargado" in w for w in result.warnings)


def test_queues_congestion_curve():
    result = _solve({"model": "M/M/s", "lambda": 10, "mu": 6, "s": 2})
    curve = _table(result, "curva_congestion")
    lambdas = [row[0] for row in curve.rows]
    assert lambdas == sorted(lambdas)
    assert 10 in lambdas
    assert all(row[1] < 1 for row in curve.rows)


@pytest.mark.parametrize(
    "body, message",
    [
        ({"model": "M/M/9"}, "no soportado"),
        ({"model": "M/M/1", "mu": 5}, "tasa de llegada"),
        ({"model": "M/M/1", "lambda": 5, "mu": 0}, "μ debe ser mayor que 0"),
        ({"model": "M/M/s", "lambda": 5, "mu": 3}, "número de servidores"),
        ({"model": "M/M/s", "lambda": 5, "mu": 3, "s": 2.5}, "entero"),
        ({"model": "M/M/s", "lambda": 5, "mu": 3, "s": 0}, "entero"),
        ({"model": "M/M/s", "lambda": 5, "mu": 3, "s": 41}, "no puede superar"),
        ({"model": "M/M/1/K", "lambda": 5, "mu": 3}, "capacidad máxima K"),
        ({"model": "M/M/s/K", "lambda": 5, "mu": 3, "s": 3, "K": 2}, "al menos igual"),
        ({"model": "M/M/s/N", "lambda": 5, "mu": 3, "s": 1}, "población N"),
        ({"model": "M/G/1", "lambda": 5, "mu": 6}, "desviación estándar"),
        ({"model": "M/G/1", "lambda": 5, "mu": 6, "service_std_dev": -1}, "negativa"),
        ({"model": "M/M/1", "lambda": 5, "mu": 6, "cost_waiting_per_unit_time": -1}, "negativo"),
    ],
)
def test_queues_validation_messages(body, message):
    with pytest.raises(ValueError, match=message):
        _solve(body)


def test_queues_endpoint_returns_400_in_spanish(client):
    response = client.post(
        "/api/v1/modules/queues/solve",
        json={"model": "M/M/s", "lambda": 5, "mu": 3, "s": 0},
    )
    assert response.status_code == 400
    assert "entero" in response.json()["detail"]


def test_queues_unstable_endpoint_serializes(client):
    response = client.post("/api/v1/modules/queues/solve", json={"model": "M/M/1", "lambda": 10, "mu": 8})
    assert response.status_code == 200
    assert response.json()["solution"]["metrics"]["L"] is None
