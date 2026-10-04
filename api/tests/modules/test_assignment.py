from __future__ import annotations

import itertools
import random

import numpy as np
import pytest
from scipy.optimize import linear_sum_assignment

from app.modules.assignment.models import AssignmentRequest
from app.modules.assignment.solver import AssignmentError, min_line_cover, solve
from app.schemas.common import SolveStatus
from tests.conftest import assert_allclose


def _names(prefix: str, n: int) -> list[str]:
    return [f"{prefix}{i + 1}" for i in range(n)]


def _brute(costs: list[list[float | None]], sense: str = "min") -> float | None:
    rows, cols = len(costs), len(costs[0])
    best: float | None = None
    if rows <= cols:
        for perm in itertools.permutations(range(cols), rows):
            vals = [costs[r][c] for r, c in enumerate(perm)]
            if any(v is None for v in vals):
                continue
            s = float(sum(vals))
            if best is None or (s < best if sense == "min" else s > best):
                best = s
    else:
        for perm in itertools.permutations(range(rows), cols):
            vals = [costs[r][c] for c, r in enumerate(perm)]
            if any(v is None for v in vals):
                continue
            s = float(sum(vals))
            if best is None or (s < best if sense == "min" else s > best):
                best = s
    return best


def test_assignment_matches_scipy():
    costs = [[9, 2, 7], [6, 4, 3], [5, 8, 1]]
    req = AssignmentRequest(
        agents=["A", "B", "C"],
        tasks=["X", "Y", "Z"],
        costs=costs,
        sense="min",
    )
    result = solve(req)
    assert result.status == SolveStatus.optimal
    rows, cols = linear_sum_assignment(np.array(costs))
    expected = float(sum(costs[r][c] for r, c in zip(rows, cols, strict=True)))
    assert_allclose(result.solution.objective_value, expected, atol=1e-6)
    assert result.iterations is not None
    assert any(s.method == "hungarian" for s in result.iterations)
    kinds = [s.meta["kind"] for s in result.iterations]
    assert kinds[0] == "initial" and kinds[-1] == "assignment"


def test_assignment_nonsquare_pads():
    req = AssignmentRequest(
        agents=["A", "B"],
        tasks=["X"],
        costs=[[1], [2]],
    )
    result = solve(req)
    assert result.status == SolveStatus.optimal
    assert any("no cuadrada" in w for w in result.warnings)
    # Only one real assignment
    assert result.solution.metrics["n_assignments"] == 1.0
    left = next(t for t in result.tables if t.name == "sin_asignar")
    assert left.rows == [["agente", "B"]]
    assert result.iterations[0].meta["col_labels"] == ["X", "Tarea ficticia 1"]


def test_min_line_cover_is_minimum():
    # Una cobertura voraz usa 3 líneas aquí; el mínimo es 2.
    zeros = [[True, True, False], [True, False, False], [False, True, False]]
    cover_rows, cover_cols, _ = min_line_cover(zeros)
    assert len(cover_rows) + len(cover_cols) == 2


def test_random_steps_end_in_full_zero_assignment():
    rng = random.Random(11)
    for t in range(300):
        rows, cols = rng.randint(1, 6), rng.randint(1, 6)
        costs: list[list[float | None]] = [[float(rng.randint(-3, 12)) for _ in range(cols)] for _ in range(rows)]
        forbidden: list[tuple[str, str]] = []
        if t % 3 == 0:
            for i in range(rows):
                for j in range(cols):
                    if rng.random() < 0.2:
                        forbidden.append((f"A{i + 1}", f"T{j + 1}"))
                        costs[i][j] = None
        sense = "min" if t % 2 == 0 else "max"
        result = solve(
            AssignmentRequest(
                agents=_names("A", rows),
                tasks=_names("T", cols),
                costs=[[1.0 if v is None else v for v in row] for row in costs],
                sense=sense,
                forbidden_assignments=forbidden,
            )
        )
        expected = _brute(costs, sense)
        if expected is None:
            assert result.status == SolveStatus.infeasible
            continue
        assert result.status == SolveStatus.optimal
        assert_allclose(result.solution.objective_value, expected, atol=1e-9)
        n = max(rows, cols)
        covers = [s for s in result.iterations if s.meta["kind"] == "cover"]
        assert covers[-1].meta["lines"] == n
        final = result.iterations[-1]
        for r, c in final.meta["assigned"]:
            assert final.tableau[r][c] == 0


def test_assignment_max_uses_regret():
    result = solve(
        AssignmentRequest(
            agents=["A", "B", "C"],
            tasks=["X", "Y", "Z"],
            costs=[[9, 2, 7], [6, 4, 3], [5, 8, 1]],
            sense="max",
        )
    )
    assert_allclose(result.solution.objective_value, 21, atol=1e-9)
    regret = next(s for s in result.iterations if s.meta["kind"] == "regret")
    assert regret.meta["max_value"] == 9
    assert result.tables[0].columns == ["agente", "tarea", "ganancia"]


def test_assignment_forbidden_and_infeasible():
    ok = solve(
        AssignmentRequest(
            agents=["A", "B", "C"],
            tasks=["X", "Y", "Z"],
            costs=[[9, 2, 7], [6, 4, 3], [5, 8, 1]],
            forbidden_assignments=[("A", "Y")],
        )
    )
    assert "A->Y" not in ok.solution.variables
    assert_allclose(ok.solution.objective_value, 14, atol=1e-9)
    assert ok.iterations[0].tableau[0][1] == "M"

    bad = solve(
        AssignmentRequest(
            agents=["A", "B"],
            tasks=["X", "Y"],
            costs=[[1, 2], [3, 4]],
            forbidden_assignments=[("A", "Y"), ("B", "Y")],
        )
    )
    assert bad.status == SolveStatus.infeasible
    assert bad.solution.objective_value is None
    assert "«A» y «B» solo pueden ir a la tarea «X»" in bad.warnings[0]


def test_assignment_alternative_optima():
    result = solve(AssignmentRequest(agents=["A", "B"], tasks=["X", "Y"], costs=[[1, 1], [1, 1]]))
    assert any("óptimos múltiples" in w for w in result.warnings)
    assert any(t.name == "asignacion_alternativa" for t in result.tables)


def test_assignment_readable_errors():
    with pytest.raises(AssignmentError, match="repetido"):
        solve(AssignmentRequest(agents=["A", "A"], tasks=["X", "Y"], costs=[[1, 2], [3, 4]]))
    with pytest.raises(AssignmentError, match="2 valores"):
        solve(AssignmentRequest(agents=["A"], tasks=["X", "Y"], costs=[[1]]))
    with pytest.raises(AssignmentError, match="no corresponde"):
        solve(AssignmentRequest(agents=["A"], tasks=["X"], costs=[[1]], forbidden_assignments=[("A", "Z")]))
