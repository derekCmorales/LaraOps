from __future__ import annotations

import json
from pathlib import Path

from app.modules.lp.graph_2d import build_2d_graph
from app.modules.lp.models import ConstraintSense, LPConstraint, LPRequest
from app.modules.lp.solver import solve

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "textbook"


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


def _series(graph, name: str) -> dict:
    found = next((s for s in graph.series if s["name"] == name), None)
    assert found is not None, f"missing series {name}"
    return found


def _coords_clean(graph) -> None:
    for s in graph.series:
        for v in list(s["x"]) + list(s["y"]):
            text = f"{float(v):.15f}"
            assert "999999" not in text, f"dirty coordinate {v} in {s['name']}"


def test_graph_none_for_one_variable():
    req = LPRequest(
        sense="max",
        objective={"x": 1},
        constraints=[LPConstraint(id="c1", coeffs={"x": 1}, sense=ConstraintSense.le, rhs=4)],
    )
    assert build_2d_graph(req, {"x": 4.0}, 4.0) is None


def test_graph_lp_01_feasible_polygon():
    data = _load("lp_01.json")
    req = LPRequest(**data["request"])
    result = solve(req)
    graph = result.graph
    assert graph is not None
    assert graph.kind == "lp2d"

    fill = _series(graph, "feasible_region")
    assert fill["role"] == "fill"
    assert len(fill["x"]) >= 4

    vertices = _series(graph, "vertices")
    meta = vertices["meta"]
    assert len(meta) >= 3
    for item in meta:
        assert len(item["sources"]) >= 2
        assert "z" in item

    opt = (20.0, 60.0)
    assert any(abs(m["x"] - opt[0]) < 1e-6 and abs(m["y"] - opt[1]) < 1e-6 for m in meta)

    inside = False
    xs, ys = fill["x"], fill["y"]
    for x, y in zip(xs, ys):
        if abs(x - opt[0]) < 1e-6 and abs(y - opt[1]) < 1e-6:
            inside = True
    assert inside

    for s in graph.series:
        if s.get("role") == "line":
            assert all(y >= -1e-8 for y in s["y"])
            assert all(x >= -1e-8 for x in s["x"])

    _coords_clean(graph)
    z_line = _series(graph, "objective_level")
    assert z_line.get("equation")


def test_graph_mixed_senses_polygon():
    req = LPRequest(
        sense="max",
        objective={"x1": 1, "x2": 1},
        constraints=[
            LPConstraint(id="R1", coeffs={"x1": 1, "x2": 1}, sense=ConstraintSense.ge, rhs=2),
            LPConstraint(id="R2", coeffs={"x1": 1, "x2": 0}, sense=ConstraintSense.le, rhs=4),
            LPConstraint(id="R3", coeffs={"x1": 0, "x2": 1}, sense=ConstraintSense.le, rhs=4),
        ],
    )
    graph = build_2d_graph(req, {"x1": 4.0, "x2": 4.0}, 8.0)
    assert graph is not None
    fill = _series(graph, "feasible_region")
    assert len(fill["x"]) >= 4
    vertices = _series(graph, "vertices")
    pts = list(zip(vertices["x"], vertices["y"]))
    assert any(abs(x) < 1e-6 and abs(y - 2) < 1e-6 for x, y in pts)
    assert any(abs(x - 2) < 1e-6 and abs(y) < 1e-6 for x, y in pts)
    for item in vertices["meta"]:
        assert len(item["sources"]) >= 2
        ax, ay = item["x"], item["y"]
        assert ax + ay >= 2 - 1e-6
        assert ax <= 4 + 1e-6
        assert ay <= 4 + 1e-6
    r1 = _series(graph, "constraint:R1")
    assert r1["equation"] == "x1 + x2 = 2"
    _coords_clean(graph)


def test_graph_two_constraint_intersection_vertex():
    req = LPRequest(
        sense="max",
        objective={"A": 2, "B": 3},
        constraints=[
            LPConstraint(id="R1", coeffs={"A": 1, "B": 3}, sense=ConstraintSense.le, rhs=6),
            LPConstraint(id="R2", coeffs={"A": 5, "B": 3}, sense=ConstraintSense.le, rhs=15),
        ],
    )
    result = solve(req)
    graph = result.graph
    assert graph is not None
    vertices = _series(graph, "vertices")
    meta = vertices["meta"]
    hit = next(
        m for m in meta if abs(m["x"] - 2.25) < 1e-6 and abs(m["y"] - 1.25) < 1e-6
    )
    assert abs(hit["z"] - 8.25) < 1e-6
    assert set(hit["sources"]) == {"R1", "R2"}
    axis = next(m for m in meta if abs(m["x"]) < 1e-6 and abs(m["y"] - 2.0) < 1e-6)
    assert abs(axis["z"] - 6.0) < 1e-6
    assert "R1" in axis["sources"]
    opt = _series(graph, "optimum")
    assert abs(opt["x"][0] - 2.25) < 1e-6
    assert abs(opt["y"][0] - 1.25) < 1e-6
    _coords_clean(graph)


def test_nice_ceil_avoids_float_dust():
    from app.modules.lp.graph_2d import _nice_ceil

    assert _nice_ceil(6.72) == 8.0
    assert _nice_ceil(6.899999999999995) == 8.0
    assert _nice_ceil(112.0) == 150.0


def test_graph_equality_has_no_fill():
    req = LPRequest(
        sense="max",
        objective={"x1": 1, "x2": 1},
        constraints=[
            LPConstraint(id="E1", coeffs={"x1": 1, "x2": 1}, sense=ConstraintSense.eq, rhs=4),
            LPConstraint(id="R2", coeffs={"x1": 1, "x2": 0}, sense=ConstraintSense.le, rhs=3),
        ],
    )
    graph = build_2d_graph(req, {"x1": 3.0, "x2": 1.0}, 4.0)
    assert graph is not None
    assert all(s["name"] != "feasible_region" for s in graph.series)
    line = _series(graph, "constraint:E1")
    assert line["equation"] == "x1 + x2 = 4"
    verts = _series(graph, "vertices")
    for item in verts["meta"]:
        assert abs(item["x"] + item["y"] - 4) < 1e-6
        assert "E1" in item["sources"]
    _coords_clean(graph)
