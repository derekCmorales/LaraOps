from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.modules.transport.models import TransportRequest
from app.modules.transport.solver import DUMMY_DEST, DUMMY_SOURCE, solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _solve(**kwargs) -> object:
    return solve(TransportRequest(**kwargs))


def test_transport_01_cost_and_balance():
    data = _load("transport_01.json")
    result = solve(TransportRequest(**data["request"]))
    expect = data["expect"]
    assert result.status == SolveStatus.optimal
    assert result.module == "transport"
    assert_allclose(result.solution.objective_value, expect["objective_value"], atol=1e-4)
    assert result.iterations is not None and len(result.iterations) > 0
    ship = result.solution.variables
    for key, qty in expect["shipments"].items():
        assert_allclose(ship.get(key, 0), qty, atol=1e-9)
    assert result.sensitivity is not None
    assert result.sensitivity.reduced_costs
    assert {t.name for t in result.tables or []} == {"costos", "envios", "resumen_origenes", "resumen_destinos"}


@pytest.mark.parametrize("method", ["northwest", "least_cost", "vogel"])
def test_initial_methods_match_textbook_and_report_gap(method):
    data = _load("transport_02.json")
    req = dict(data["request"], method=method)
    result = solve(TransportRequest(**req))
    initial = data["expect"]["initial_cost"][method]
    assert result.status == SolveStatus.feasible
    assert_allclose(result.solution.objective_value, initial)
    assert_allclose(result.solution.metrics["optimal_cost"], 435)
    assert_allclose(result.solution.metrics["gap"], initial - 435)
    assert "no es óptima" in result.warnings[0]
    steps = result.iterations or []
    assert steps[-1].meta["phase"] == "check"
    assert steps[-1].meta["enter"] is not None
    assert all(s.meta["phase"] == "initial" for s in steps[:-1])


def test_modi_reaches_textbook_optimum_with_cycle_detail():
    data = _load("transport_02.json")
    result = solve(TransportRequest(**data["request"]))
    assert result.status == SolveStatus.optimal
    assert_allclose(result.solution.objective_value, 435)
    pivots = [s for s in result.iterations or [] if s.meta.get("phase") == "modi" and s.meta["enter"]]
    assert pivots, "debe haber al menos un ciclo de mejora"
    first = pivots[0].meta
    signs = [sign for _, _, sign in first["cycle"]]
    assert signs[0] == 1 and len(signs) % 2 == 0
    assert signs == [1 if k % 2 == 0 else -1 for k in range(len(signs))]
    last = (result.iterations or [])[-1]
    assert last.meta["enter"] is None
    assert all(d is None or d >= -1e-9 for row in last.meta["reduced"] for d in row)


def test_vogel_degenerate_step_keeps_basis_complete():
    data = _load("transport_02.json")
    result = solve(TransportRequest(**dict(data["request"], method="vogel")))
    steps = [s for s in result.iterations or [] if s.meta.get("phase") == "initial"]
    assert len(steps) == 3 + 4 - 1
    assert any(s.meta["qty"] == 0 for s in steps)
    assert len(steps[-1].meta["basis"]) == 6


def test_lp_cross_check_cases():
    data = _load("transport_lp_cross_check.json")
    for case in data["cases"]:
        req = case["request"]
        result = solve(TransportRequest(**req))
        if case["optimal"] is None:
            assert result.status == SolveStatus.infeasible, req
            assert result.solution.objective_value is None
            continue
        assert result.status != SolveStatus.infeasible, req
        if req["method"] == "modi_auto" or result.status == SolveStatus.optimal:
            got = result.solution.objective_value
        else:
            got = result.solution.metrics["optimal_cost"]
        assert_allclose(got, case["optimal"], atol=1e-6)


def test_unbalanced_supply_adds_named_dummy_destination():
    result = _solve(
        supply={"A": 30, "B": 30},
        demand={"X": 20, "Y": 25},
        costs={"A": {"X": 4, "Y": 6}, "B": {"X": 5, "Y": 3}},
    )
    assert result.status == SolveStatus.optimal
    assert result.graph is not None and result.graph.col_labels[-1] == DUMMY_DEST
    assert "destino ficticio" in result.warnings[0]
    assert_allclose(result.solution.metrics["unused_supply"], 15)
    assert_allclose(result.solution.metrics["units_shipped"], 45)
    assert_allclose(result.solution.objective_value, 20 * 4 + 25 * 3)


def test_unbalanced_demand_reports_unmet_demand():
    result = _solve(
        supply={"A": 10},
        demand={"X": 8, "Y": 7},
        costs={"A": {"X": 1, "Y": 2}},
    )
    assert result.graph is not None and result.graph.row_labels[-1] == DUMMY_SOURCE
    assert_allclose(result.solution.metrics["unmet_demand"], 5)


def test_forbidden_route_is_avoided_when_possible():
    result = _solve(
        supply={"A": 10, "B": 10},
        demand={"X": 10, "Y": 10},
        costs={"A": {"Y": 5}, "B": {"X": 7, "Y": 1}},
        forbidden_routes=[["A", "X"]],
    )
    assert result.status == SolveStatus.optimal
    assert "A->X" not in result.solution.variables
    assert_allclose(result.solution.objective_value, 10 * 5 + 10 * 7)
    assert all(r["variable"] != "A->X" for r in result.sensitivity.reduced_costs)


def test_forced_forbidden_route_is_infeasible():
    result = _solve(
        supply={"A": 10},
        demand={"X": 5, "Y": 5},
        costs={"A": {"X": 1}},
        forbidden_routes=[["A", "Y"]],
    )
    assert result.status == SolveStatus.infeasible
    assert result.solution.objective_value is None
    assert "rutas prohibidas" in result.warnings[0]


def test_northwest_over_forbidden_route_is_flagged_not_infeasible():
    result = _solve(
        supply={"A": 10, "B": 10},
        demand={"X": 10, "Y": 10},
        costs={"A": {"Y": 2}, "B": {"X": 3, "Y": 4}},
        forbidden_routes=[["A", "X"]],
        method="northwest",
    )
    assert result.status == SolveStatus.feasible
    assert result.solution.objective_value is None
    assert "usa rutas prohibidas" in result.warnings[0]
    assert_allclose(result.solution.metrics["optimal_cost"], 10 * 2 + 10 * 3)


def test_maximize_reports_profit_and_reduced_costs_in_original_sense():
    result = _solve(
        supply={"A": 20, "B": 30},
        demand={"X": 10, "Y": 40},
        costs={"A": {"X": 2, "Y": 3}, "B": {"X": 4, "Y": 1}},
        objective="maximize",
    )
    assert result.status == SolveStatus.optimal
    assert result.solution.objective_sense == "max"
    # Óptimo: A->Y 20, B->X 10, B->Y 20 = 60 + 40 + 20
    assert_allclose(result.solution.objective_value, 120)
    assert all(r["reduced_cost"] <= 1e-9 for r in result.sensitivity.reduced_costs)
    assert not any("negados" in w for w in result.warnings)


def test_alternative_optima_warning():
    result = _solve(
        supply={"A": 10, "B": 10},
        demand={"X": 10, "Y": 10},
        costs={"A": {"X": 1, "Y": 1}, "B": {"X": 1, "Y": 1}},
    )
    assert any("óptimos alternativos" in w for w in result.warnings)


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        ({"supply": {"A": 5}, "demand": {"X": 5}, "costs": {"A": {}}}, "Falta el costo de la ruta A -> X"),
        ({"supply": {"A": -1}, "demand": {"X": 5}, "costs": {"A": {"X": 1}}}, "no puede ser negativa"),
        ({"supply": {}, "demand": {"X": 5}, "costs": {}}, "al menos un origen"),
        ({"supply": {"A": 0}, "demand": {"X": 0}, "costs": {"A": {"X": 1}}}, "oferta total es 0"),
        (
            {"supply": {"A": 5}, "demand": {"X": 5}, "costs": {"A": {"X": 1}}, "forbidden_routes": [["Z", "X"]]},
            "no corresponde",
        ),
        ({"supply": {"Destino ficticio": 5}, "demand": {"X": 5}, "costs": {}}, "reservado"),
    ],
)
def test_validation_errors_are_readable(payload, message):
    with pytest.raises(ValueError, match=message):
        solve(TransportRequest(**payload))


def test_solve_endpoint_returns_400_on_invalid_model(client):
    res = client.post(
        "/api/v1/modules/transport/solve",
        json={"supply": {"A": 5}, "demand": {"X": 5}, "costs": {"A": {}}},
    )
    assert res.status_code == 400
    assert "Falta el costo" in res.json()["detail"]
