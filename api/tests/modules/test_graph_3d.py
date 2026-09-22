from __future__ import annotations

from app.modules.lp.graph_nd import build_lp_graph
from app.modules.lp.models import ConstraintSense, LPConstraint, LPRequest
from app.modules.lp.solver import solve


def _series(graph, name: str) -> dict:
    found = next((s for s in graph.series if s["name"] == name), None)
    assert found is not None, f"missing series {name}"
    return found


def _cube() -> LPRequest:
    return LPRequest(
        sense="max",
        objective={"x": 1, "y": 1, "z": 1},
        constraints=[
            LPConstraint(id="Rx", coeffs={"x": 1}, sense=ConstraintSense.le, rhs=1),
            LPConstraint(id="Ry", coeffs={"y": 1}, sense=ConstraintSense.le, rhs=1),
            LPConstraint(id="Rz", coeffs={"z": 1}, sense=ConstraintSense.le, rhs=1),
        ],
        variable_names=["x", "y", "z"],
    )


def test_graph_3d_unit_cube_has_eight_vertices():
    req = _cube()
    result = solve(req)
    graph = result.graph
    assert graph is not None
    assert graph.kind == "lp3d"
    assert graph.z_label == "z"
    vertices = _series(graph, "vertices")
    assert len(vertices["meta"]) == 8
    for item in vertices["meta"]:
        assert item["x"] in (0, 1)
        assert item["y"] in (0, 1)
        assert item["z"] in (0, 1)
        assert len(item["sources"]) >= 3
    opt = _series(graph, "optimum")
    assert opt["x"] == [1] and opt["y"] == [1] and opt["z"] == [1]
    assert abs(opt["meta"][0]["objective"] - 3) < 1e-6
    assert _series(graph, "edges")["role"] == "edges"
    assert _series(graph, "objective_plane")["equation"] == "x + y + z = 3"
    face = _series(graph, "constraint:Rx")
    assert face["equation"] == "x = 1"
    assert len(face["i"]) >= 1
    table = next(t for t in result.tables or [] if t.name == "vertices_feasible")
    assert table.columns[:4] == ["x", "y", "z", "Z"]
    marked = [row for row in table.rows if row[-1] == "sí"]
    assert len(marked) == 1
    assert marked[0][0:4] == [1, 1, 1, 3]


def test_graph_3d_optimum_is_a_vertex():
    req = LPRequest(
        sense="max",
        objective={"x": 2, "y": 3, "z": 1},
        constraints=[
            LPConstraint(id="R1", coeffs={"x": 1, "y": 1, "z": 1}, sense=ConstraintSense.le, rhs=6),
            LPConstraint(id="Rx", coeffs={"x": 1}, sense=ConstraintSense.le, rhs=4),
            LPConstraint(id="Ry", coeffs={"y": 1}, sense=ConstraintSense.le, rhs=4),
            LPConstraint(id="Rz", coeffs={"z": 1}, sense=ConstraintSense.le, rhs=4),
        ],
        variable_names=["x", "y", "z"],
    )
    result = solve(req)
    assert result.status.value == "optimal"
    graph = result.graph
    assert graph is not None and graph.kind == "lp3d"
    vertices = _series(graph, "vertices")
    hit = next(
        m
        for m in vertices["meta"]
        if abs(m["x"] - 2) < 1e-6 and abs(m["y"] - 4) < 1e-6 and abs(m["z"]) < 1e-6
    )
    assert abs(hit["objective"] - 16) < 1e-6
    assert "R1" in hit["sources"]
    assert "Ry" in hit["sources"]
    assert "eje z" in hit["sources"]


def test_graph_3d_equality_is_a_polygon():
    req = LPRequest(
        sense="max",
        objective={"x": 1, "y": 2, "z": 3},
        constraints=[
            LPConstraint(id="E1", coeffs={"x": 1, "y": 1, "z": 1}, sense=ConstraintSense.eq, rhs=4),
            LPConstraint(id="Rx", coeffs={"x": 1}, sense=ConstraintSense.le, rhs=3),
            LPConstraint(id="Ry", coeffs={"y": 1}, sense=ConstraintSense.le, rhs=3),
            LPConstraint(id="Rz", coeffs={"z": 1}, sense=ConstraintSense.le, rhs=3),
        ],
        variable_names=["x", "y", "z"],
    )
    graph, warnings = build_lp_graph(req, {"x": 0.0, "y": 1.0, "z": 3.0}, 11.0)
    assert warnings == []
    assert graph is not None
    vertices = _series(graph, "vertices")
    assert vertices["meta"]
    for item in vertices["meta"]:
        assert abs(item["x"] + item["y"] + item["z"] - 4) < 1e-6
        assert "E1" in item["sources"]
    assert _series(graph, "constraint:E1")["equation"] == "x + y + z = 4"


def test_graph_slice_fixes_extra_variables_at_optimum():
    req = LPRequest(
        sense="max",
        objective={"x": 3, "y": 2, "z": 1, "w": 4},
        constraints=[
            LPConstraint(
                id="R1",
                coeffs={"x": 1, "y": 1, "z": 1, "w": 1},
                sense=ConstraintSense.le,
                rhs=6,
            ),
            LPConstraint(id="Rx", coeffs={"x": 1}, sense=ConstraintSense.le, rhs=2),
            LPConstraint(id="Ry", coeffs={"y": 1}, sense=ConstraintSense.le, rhs=2),
            LPConstraint(id="Rz", coeffs={"z": 1}, sense=ConstraintSense.le, rhs=2),
            LPConstraint(id="Rw", coeffs={"w": 1}, sense=ConstraintSense.le, rhs=2),
        ],
        variable_names=["x", "y", "z", "w"],
        graph_variables=["x", "y", "z"],
    )
    result = solve(req)
    assert abs((result.solution.objective_value or 0) - 18) < 1e-6
    graph = result.graph
    assert graph is not None
    assert graph.kind == "lp3d"
    assert graph.title == "Corte 3D por el óptimo"
    assert "w = 2" in (graph.subtitle or "")
    opt = _series(graph, "optimum")
    assert opt["meta"][0]["objective"] == 18
    # En el corte, w* = 2 ya gastó 2 del recurso: x+y+z <= 4.
    face = _series(graph, "constraint:R1")
    assert face["equation"] == "x + y + z = 4"


def test_graph_two_variable_slice_stays_2d():
    req = LPRequest(
        sense="max",
        objective={"x": 1, "y": 1, "z": 1},
        constraints=[
            LPConstraint(id="R1", coeffs={"x": 1, "y": 1, "z": 1}, sense=ConstraintSense.le, rhs=3),
        ],
        variable_names=["x", "y", "z"],
        graph_variables=["x", "y"],
    )
    graph, _warnings = build_lp_graph(req, {"x": 3.0, "y": 0.0, "z": 0.0}, 3.0)
    assert graph is not None
    assert graph.kind == "lp2d"
    assert graph.title == "Corte por el óptimo"
    assert "z = 0" in (graph.subtitle or "")
    assert graph.z_label == ""


def test_graph_still_none_for_one_variable():
    req = LPRequest(
        sense="max",
        objective={"x": 1},
        constraints=[LPConstraint(id="c1", coeffs={"x": 1}, sense=ConstraintSense.le, rhs=4)],
    )
    graph, warnings = build_lp_graph(req, {"x": 4.0}, 4.0)
    assert graph is None
    assert warnings == []
