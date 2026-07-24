from __future__ import annotations

import logging

import numpy as np
from scipy.optimize import linear_sum_assignment

from app.modules.assignment.models import AssignmentRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphMatrix, IterationStep, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)

_BIG_M = 1e9


class AssignmentError(ValueError):
    pass


def solve(req: AssignmentRequest) -> ModuleResult:
    n_agents = len(req.agents)
    n_tasks = len(req.tasks)
    if len(req.costs) != n_agents or any(len(row) != n_tasks for row in req.costs):
        raise AssignmentError("costs matrix dimensions must match agents x tasks")

    warnings: list[str] = []
    cost = np.array(req.costs, dtype=float)

    # Forbidden
    agent_idx = {a: i for i, a in enumerate(req.agents)}
    task_idx = {t: j for j, t in enumerate(req.tasks)}
    for a, t in req.forbidden_assignments:
        if a not in agent_idx or t not in task_idx:
            raise AssignmentError(f"forbidden assignment unknown: {a}->{t}")
        cost[agent_idx[a], task_idx[t]] = _BIG_M
        warnings.append(f"Asignación prohibida {a}->{t}")

    # Pad to square
    n = max(n_agents, n_tasks)
    agents = list(req.agents) + [f"_dummy_agent_{k}" for k in range(n - n_agents)]
    tasks = list(req.tasks) + [f"_dummy_task_{k}" for k in range(n - n_tasks)]
    if n != n_agents or n != n_tasks:
        warnings.append(f"Matriz no cuadrada: relleno a {n}×{n} con ficticios de costo 0")
    padded = np.zeros((n, n), dtype=float)
    padded[:n_agents, :n_tasks] = cost
    cost_orig = padded.copy()

    work = padded.copy()
    if req.sense == "max":
        finite = work[work < _BIG_M / 2]
        mx = float(finite.max()) if finite.size else 0.0
        mask = work < _BIG_M / 2
        work = np.where(mask, mx - work, work)

    iterations: list[IterationStep] = []

    # Pedagogical Hungarian steps
    row_min = work.min(axis=1, keepdims=True)
    reduced = work - row_min
    iterations.append(
        IterationStep(
            index=0,
            method="hungarian",
            title="Reducción por filas",
            tableau=reduced.tolist(),
            meta={"row_min": row_min.flatten().tolist()},
        )
    )
    col_min = reduced.min(axis=0, keepdims=True)
    reduced2 = reduced - col_min
    iterations.append(
        IterationStep(
            index=1,
            method="hungarian",
            title="Reducción por columnas",
            tableau=reduced2.tolist(),
            meta={"col_min": col_min.flatten().tolist()},
        )
    )

    # Cover zeros / adjust loop (didactic approximation using scipy for final assign)
    mat = reduced2.copy()
    step = 2
    for _ in range(n * 2):
        zeros = mat < 1e-12
        cover_rows, cover_cols = _min_line_cover(zeros)
        iterations.append(
            IterationStep(
                index=step,
                method="hungarian",
                title=f"Cobertura de ceros ({len(cover_rows)} filas + {len(cover_cols)} columnas)",
                tableau=mat.tolist(),
                meta={"cover_rows": cover_rows, "cover_cols": cover_cols},
            )
        )
        step += 1
        if len(cover_rows) + len(cover_cols) >= n:
            break
        uncovered = [
            mat[i, j]
            for i in range(n)
            for j in range(n)
            if i not in cover_rows and j not in cover_cols
        ]
        if not uncovered:
            break
        delta = min(uncovered)
        for i in range(n):
            for j in range(n):
                if i not in cover_rows and j not in cover_cols:
                    mat[i, j] -= delta
                elif i in cover_rows and j in cover_cols:
                    mat[i, j] += delta
        iterations.append(
            IterationStep(
                index=step,
                method="hungarian",
                title=f"Ajuste de celdas no cubiertas en {delta}",
                tableau=mat.tolist(),
                meta={"delta": float(delta)},
            )
        )
        step += 1

    rows, cols = linear_sum_assignment(work)
    iterations.append(
        IterationStep(
            index=step,
            method="hungarian",
            title="Asignación óptima",
            tableau=None,
            meta={"rows": rows.tolist(), "cols": cols.tolist()},
        )
    )

    variables: dict[str, float] = {}
    total = 0.0
    pairs: list[list[str | float]] = []
    for r, c in zip(rows, cols, strict=True):
        if agents[r].startswith("_dummy") or tasks[c].startswith("_dummy"):
            continue
        if cost_orig[r, c] >= _BIG_M / 2:
            warnings.append(f"Asignación {agents[r]}->{tasks[c]} usa ruta de costo M (revisar factibilidad)")
        key = f"{agents[r]}->{tasks[c]}"
        variables[key] = 1.0
        total += float(cost_orig[r, c])
        pairs.append([agents[r], tasks[c], float(cost_orig[r, c])])

    graph = GraphMatrix(
        type="matrix",
        row_labels=req.agents,
        col_labels=req.tasks,
        values=[
            [1.0 if f"{a}->{t}" in variables else 0.0 for t in req.tasks] for a in req.agents
        ],
        title="Matriz de asignación óptima",
        subtitle="1 = pareja asignada · 0 = sin asignación",
        value_label="Asignado",
    )

    result = ModuleResult(
        module="assignment",
        status=SolveStatus.optimal,
        solution=SolutionBlock(
            variables=variables,
            objective_value=float(total),
            objective_sense=req.sense,
            metrics={"total": float(total), "n_assignments": float(len(pairs))},
        ),
        iterations=iterations,
        sensitivity=None,
        graph=graph,
        tables=[
            NamedTable(name="assignment", columns=["agente", "tarea", "costo"], rows=pairs),
        ],
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result


def _min_line_cover(zeros: np.ndarray) -> tuple[list[int], list[int]]:
    """Greedy approximate minimum line cover of zeros (didactic)."""
    n = zeros.shape[0]
    uncovered = zeros.copy()
    cover_rows: list[int] = []
    cover_cols: list[int] = []
    while uncovered.any():
        row_counts = uncovered.sum(axis=1)
        col_counts = uncovered.sum(axis=0)
        if row_counts.max() >= col_counts.max():
            i = int(row_counts.argmax())
            cover_rows.append(i)
            uncovered[i, :] = False
        else:
            j = int(col_counts.argmax())
            cover_cols.append(j)
            uncovered[:, j] = False
        if len(cover_rows) + len(cover_cols) >= n:
            break
    return cover_rows, cover_cols
