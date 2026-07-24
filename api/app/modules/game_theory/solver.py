from __future__ import annotations

import logging

import numpy as np
from scipy.optimize import linprog

from app.modules.game_theory.models import GameTheoryRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, IterationStep, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)

_TOL = 1e-9


def solve(req: GameTheoryRequest) -> ModuleResult:
    m = len(req.row_strategies)
    n = len(req.col_strategies)
    if len(req.payoff) != m or any(len(row) != n for row in req.payoff):
        raise ValueError("payoff must be row_strategies x col_strategies")

    A = np.array(req.payoff, dtype=float)
    warnings: list[str] = []
    metrics: dict[str, float] = {}
    variables: dict[str, float] = {}

    rows, cols, iterations = _eliminate_dominated(A, req.row_strategies, req.col_strategies)
    reduced = A[np.ix_(rows, cols)]

    # Pure strategy: saddle point (maximin = minimax) on the reduced (non-dominated) matrix
    row_mins = A.min(axis=1)
    col_maxs = A.max(axis=0)
    maximin = float(row_mins.max())
    minimax = float(col_maxs.min())
    metrics["maximin"] = maximin
    metrics["minimax"] = minimax

    pure_rows: list[list[float | str]] = []
    mixed_rows: list[list[float | str]] = []
    status_note = "mixed"
    graph = None

    if abs(maximin - minimax) < 1e-9:
        status_note = "pure"
        for i in range(m):
            for j in range(n):
                if abs(A[i, j] - maximin) < 1e-9 and abs(row_mins[i] - maximin) < 1e-9:
                    if abs(col_maxs[j] - minimax) < 1e-9:
                        variables[f"pure:{req.row_strategies[i]}->{req.col_strategies[j]}"] = 1.0
                        metrics["game_value"] = float(A[i, j])
                        pure_rows.append([req.row_strategies[i], req.col_strategies[j], float(A[i, j])])
    else:
        warnings.append("No hay punto de silla en estrategias puras; se calcula el equilibrio en estrategias mixtas.")
        row_names = [req.row_strategies[i] for i in rows]
        col_names = [req.col_strategies[j] for j in cols]

        if reduced.shape == (1, 1):
            value = float(reduced[0, 0])
            x = np.array([1.0])
            y = np.array([1.0])
        elif reduced.shape[0] == 1:
            j_best = int(np.argmin(reduced[0, :]))
            value = float(reduced[0, j_best])
            x = np.array([1.0])
            y = np.zeros(reduced.shape[1])
            y[j_best] = 1.0
        elif reduced.shape[1] == 1:
            i_best = int(np.argmax(reduced[:, 0]))
            value = float(reduced[i_best, 0])
            x = np.zeros(reduced.shape[0])
            x[i_best] = 1.0
            y = np.array([1.0])
        elif reduced.shape == (2, 2):
            x, y, value = _solve_2x2(reduced)
        else:
            x, y, value = _solve_lp(reduced)

        metrics["game_value"] = float(value)
        for i, name in enumerate(row_names):
            variables[f"p:{name}"] = float(x[i])
            mixed_rows.append([name, float(x[i])])
        for j, name in enumerate(col_names):
            variables[f"q:{name}"] = float(y[j])
            mixed_rows.append([name, float(y[j])])

        if reduced.shape[0] == 2 or reduced.shape[1] == 2:
            graph = _graph_2xn(reduced, rows, cols, req.row_strategies, req.col_strategies)

    tables = [
        NamedTable(
            name="matriz_pagos",
            columns=["fila", *req.col_strategies],
            rows=[[req.row_strategies[i], *req.payoff[i]] for i in range(m)],
        )
    ]
    if len(rows) < m or len(cols) < n:
        tables.append(
            NamedTable(
                name="reduced_payoff",
                columns=["fila", *[req.col_strategies[j] for j in cols]],
                rows=[[req.row_strategies[i], *[A[i, j] for j in cols]] for i in rows],
            )
        )
    if pure_rows:
        tables.append(NamedTable(name="punto_silla_puro", columns=["fila", "columna", "valor"], rows=pure_rows))
    if mixed_rows:
        tables.append(NamedTable(name="estrategia_mixta", columns=["estrategia", "probabilidad"], rows=mixed_rows))

    result = ModuleResult(
        module="game_theory",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables=variables,
            metrics=metrics,
            objective_value=metrics.get("game_value"),
            objective_sense="max",
        ),
        iterations=iterations or None,
        sensitivity=None,
        graph=graph,
        tables=tables,
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result


def _eliminate_dominated(
    A: np.ndarray, row_names: list[str], col_names: list[str]
) -> tuple[list[int], list[int], list[IterationStep]]:
    """Successive elimination of (strictly) dominated pure strategies.

    Row player maximizes: a row is dominated if another row is >= it everywhere (and > somewhere).
    Column player minimizes: a column is dominated if another column is <= it everywhere (and < somewhere).
    Returns the surviving row/col indices (into the original matrix) and the step-by-step log.
    """
    rows = list(range(A.shape[0]))
    cols = list(range(A.shape[1]))
    iterations: list[IterationStep] = []
    step = 0
    changed = True
    while changed and len(rows) > 1 and len(cols) > 1:
        changed = False
        for i in rows:
            for k in rows:
                if i == k:
                    continue
                if all(A[k, j] >= A[i, j] - _TOL for j in cols) and any(
                    A[k, j] > A[i, j] + _TOL for j in cols
                ):
                    step += 1
                    iterations.append(
                        IterationStep(
                            index=step,
                            method="dominance",
                            title=f"Fila '{row_names[i]}' eliminada (dominada por '{row_names[k]}')",
                            meta={
                                "eliminated": "row",
                                "strategy": row_names[i],
                                "dominated_by": row_names[k],
                            },
                        )
                    )
                    rows.remove(i)
                    changed = True
                    break
            if changed:
                break
        if changed or len(cols) <= 1:
            continue
        for j in cols:
            for elim_col in cols:
                if j == elim_col:
                    continue
                if all(A[i, elim_col] <= A[i, j] + _TOL for i in rows) and any(
                    A[i, elim_col] < A[i, j] - _TOL for i in rows
                ):
                    step += 1
                    iterations.append(
                        IterationStep(
                            index=step,
                            method="dominance",
                            title=(
                                f"Columna '{col_names[j]}' eliminada "
                                f"(dominada por '{col_names[elim_col]}')"
                            ),
                            meta={
                                "eliminated": "col",
                                "strategy": col_names[j],
                                "dominated_by": col_names[elim_col],
                            },
                        )
                    )
                    cols.remove(j)
                    changed = True
                    break
            if changed:
                break
    return rows, cols, iterations


def _solve_2x2(A: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    a, b = A[0, 0], A[0, 1]
    c, d = A[1, 0], A[1, 1]
    denom = a - b - c + d
    if abs(denom) < 1e-12:
        # Degenerate: fall back to the general LP formulation.
        return _solve_lp(A)
    p = float(np.clip((d - c) / denom, 0, 1))
    q = float(np.clip((d - b) / denom, 0, 1))
    value = (a * d - b * c) / denom
    return np.array([p, 1.0 - p]), np.array([q, 1.0 - q]), float(value)


def _solve_lp(A: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    """Solve a zero-sum game (row player maximizes, col player minimizes) via LP.

    Row player: max v  s.t.  sum_i x_i*A[i,j] >= v for all j,  sum x_i = 1, x_i >= 0.
    Column player: min v  s.t.  sum_j y_j*A[i,j] <= v for all i,  sum y_j = 1, y_j >= 0.
    """
    m, n = A.shape

    # Row player LP (variables: x_1..x_m, v). Maximize v == minimize -v.
    c_row = np.zeros(m + 1)
    c_row[-1] = -1.0
    A_ub_row = np.hstack([-A.T, np.ones((n, 1))])
    b_ub_row = np.zeros(n)
    A_eq_row = np.array([[1.0] * m + [0.0]])
    b_eq_row = np.array([1.0])
    bounds_row = [(0, None)] * m + [(None, None)]
    res_row = linprog(
        c_row, A_ub=A_ub_row, b_ub=b_ub_row, A_eq=A_eq_row, b_eq=b_eq_row, bounds=bounds_row, method="highs"
    )
    if not res_row.success:
        raise ValueError(f"game LP (row player) failed to solve: {res_row.message}")
    x = np.clip(res_row.x[:m], 0, None)
    if x.sum() > 0:
        x = x / x.sum()
    value_row = -res_row.fun

    # Column player LP (variables: y_1..y_n, v). Minimize v.
    c_col = np.zeros(n + 1)
    c_col[-1] = 1.0
    A_ub_col = np.hstack([A, -np.ones((m, 1))])
    b_ub_col = np.zeros(m)
    A_eq_col = np.array([[1.0] * n + [0.0]])
    b_eq_col = np.array([1.0])
    bounds_col = [(0, None)] * n + [(None, None)]
    res_col = linprog(
        c_col, A_ub=A_ub_col, b_ub=b_ub_col, A_eq=A_eq_col, b_eq=b_eq_col, bounds=bounds_col, method="highs"
    )
    if not res_col.success:
        raise ValueError(f"game LP (col player) failed to solve: {res_col.message}")
    y = np.clip(res_col.x[:n], 0, None)
    if y.sum() > 0:
        y = y / y.sum()

    value = float((value_row + res_col.fun) / 2.0)
    return x, y, value


def _graph_2xn(
    reduced: np.ndarray,
    row_idx: list[int],
    col_idx: list[int],
    row_names: list[str],
    col_names: list[str],
) -> GraphXY | None:
    """Graphical method for 2xn (or mx2) games: expected payoff is linear in the probability
    of playing the first of the two strategies, so each opponent pure strategy is a line."""
    if reduced.shape[0] == 2:
        series = [
            {
                "name": col_names[col_idx[j]],
                "x": [0.0, 1.0],
                "y": [float(reduced[1, j]), float(reduced[0, j])],
            }
            for j in range(reduced.shape[1])
        ]
        return GraphXY(series=series, x_label=f"P({row_names[row_idx[0]]})", y_label="Pago esperado")
    if reduced.shape[1] == 2:
        series = [
            {
                "name": row_names[row_idx[i]],
                "x": [0.0, 1.0],
                "y": [float(reduced[i, 1]), float(reduced[i, 0])],
            }
            for i in range(reduced.shape[0])
        ]
        return GraphXY(series=series, x_label=f"P({col_names[col_idx[0]]})", y_label="Pago esperado")
    return None
