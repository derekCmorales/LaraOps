from __future__ import annotations

import json
from pathlib import Path

from app.modules.networks.models import NetworkEdge, NetworksRequest
from app.modules.networks.solver import solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def test_shortest_path():
    req = NetworksRequest(
        problem="shortest_path",
        nodes=["A", "B", "C", "D"],
        edges=[
            NetworkEdge(source="A", target="B", weight=1),
            NetworkEdge(source="A", target="C", weight=4),
            NetworkEdge(source="B", target="C", weight=2),
            NetworkEdge(source="B", target="D", weight=5),
            NetworkEdge(source="C", target="D", weight=1),
        ],
        source="A",
        sink="D",
        directed=True,
    )
    result = solve(req)
    assert result.status == SolveStatus.ok
    assert_allclose(result.solution.metrics["path_length"], 4.0)  # A-B-C-D


def test_mst():
    req = NetworksRequest(
        problem="mst",
        nodes=["A", "B", "C"],
        edges=[
            NetworkEdge(source="A", target="B", weight=1),
            NetworkEdge(source="B", target="C", weight=2),
            NetworkEdge(source="A", target="C", weight=5),
        ],
        directed=False,
    )
    result = solve(req)
    assert_allclose(result.solution.metrics["mst_weight"], 3.0)


def test_max_flow():
    req = NetworksRequest(
        problem="max_flow",
        nodes=["S", "A", "T"],
        edges=[
            NetworkEdge(source="S", target="A", capacity=10, weight=10),
            NetworkEdge(source="A", target="T", capacity=5, weight=5),
        ],
        source="S",
        sink="T",
    )
    result = solve(req)
    assert_allclose(result.solution.metrics["max_flow"], 5.0)
    # max-flow = min-cut (theorem), and it must be documented in tables/iterations
    assert_allclose(result.solution.metrics["min_cut_value"], 5.0)
    assert result.iterations, "expected augmenting-path iterations"
    assert any(t.name == "min_cut" for t in result.tables or [])


def test_transshipment_min_cost_flow():
    data = json.loads((FIXTURES / "networks_01.json").read_text(encoding="utf-8"))
    result = solve(NetworksRequest(**data["request"]))
    assert result.status == SolveStatus.ok
    assert_allclose(result.solution.metrics["total_cost"], data["expect"]["total_cost"])


def test_transshipment_unbalanced_raises():
    req = NetworksRequest(
        problem="transshipment",
        nodes=["A", "B"],
        node_supply={"A": 10, "B": -5},
        edges=[NetworkEdge(source="A", target="B", weight=1)],
    )
    try:
        solve(req)
        raise AssertionError("expected ValueError for unbalanced network")
    except ValueError as exc:
        assert "unbalanced" in str(exc)


def test_tsp_exact():
    data = json.loads((FIXTURES / "networks_02.json").read_text(encoding="utf-8"))
    result = solve(NetworksRequest(**data["request"]))
    assert result.status == SolveStatus.ok
    assert_allclose(result.solution.metrics["tour_length"], data["expect"]["tour_length"])


def test_tsp_heuristic_matches_exact_on_small_instance():
    data = json.loads((FIXTURES / "networks_02.json").read_text(encoding="utf-8"))
    req = {**data["request"], "tsp_method": "heuristic"}
    result = solve(NetworksRequest(**req))
    assert_allclose(result.solution.metrics["tour_length"], data["expect"]["tour_length"])
