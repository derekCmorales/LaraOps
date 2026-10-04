from __future__ import annotations

import logging
from collections import deque

import numpy as np
from scipy.optimize import linear_sum_assignment

from app.modules.assignment.models import AssignmentRequest
from app.schemas.common import SolveStatus
from app.schemas.result import (
    GraphMatrix,
    IterationStep,
    ModuleResult,
    NamedTable,
    SolutionBlock,
)

logger = logging.getLogger(__name__)

# Costo de una celda prohibida. Se muestra como "M" en las tablas.
_BIG_M = 1e9


class AssignmentError(ValueError):
    pass


def _validate_names(names: list[str], kind: str) -> list[str]:
    one, of, group = (
        ("un agente", "del agente", "los agentes") if kind == "agent" else ("una tarea", "de la tarea", "las tareas")
    )
    if not names:
        raise AssignmentError(f"Agrega al menos {one}.")
    seen: set[str] = set()
    out: list[str] = []
    for i, raw in enumerate(names):
        s = str(raw).strip()
        if not s:
            raise AssignmentError(f"Falta el nombre {of} {i + 1}.")
        if s in seen:
            raise AssignmentError(f"«{s}» está repetido en {group}. Usa nombres distintos.")
        seen.add(s)
        out.append(s)
    return out


def max_matching(allowed: list[list[bool]]) -> tuple[list[int], list[int], int]:
    """Máximo emparejamiento bipartito (Kuhn); las filas con menos opciones van primero."""
    n = len(allowed)
    m = len(allowed[0]) if n else 0
    row_match = [-1] * n
    col_match = [-1] * m
    order = sorted(range(n), key=lambda i: (sum(allowed[i]), i))

    def augment(i: int, seen: list[bool]) -> bool:
        for j in range(m):
            if not allowed[i][j] or seen[j]:
                continue
            seen[j] = True
            if col_match[j] < 0 or augment(col_match[j], seen):
                row_match[i] = j
                col_match[j] = i
                return True
        return False

    size = 0
    for i in order:
        if augment(i, [False] * m):
            size += 1
    return row_match, col_match, size


def _alternating_reach(
    allowed: list[list[bool]], row_match: list[int], col_match: list[int], start: list[int]
) -> tuple[list[bool], list[bool]]:
    n = len(allowed)
    row_seen = [False] * n
    col_seen = [False] * n
    queue = deque(start)
    for r in start:
        row_seen[r] = True
    while queue:
        i = queue.popleft()
        for j in range(n):
            if not allowed[i][j] or col_seen[j] or row_match[i] == j:
                continue
            col_seen[j] = True
            nxt = col_match[j]
            if nxt >= 0 and not row_seen[nxt]:
                row_seen[nxt] = True
                queue.append(nxt)
    return row_seen, col_seen


def min_line_cover(zeros: list[list[bool]]) -> tuple[list[int], list[int], list[int]]:
    """Cobertura mínima de ceros (König): líneas = máximo de ceros independientes."""
    n = len(zeros)
    row_match, col_match, _ = max_matching(zeros)
    free = [i for i, j in enumerate(row_match) if j < 0]
    row_seen, col_seen = _alternating_reach(zeros, row_match, col_match, free)
    cover_rows = [i for i in range(n) if not row_seen[i]]
    cover_cols = [j for j in range(n) if col_seen[j]]
    return cover_rows, cover_cols, row_match


def _fmt(v: float) -> str:
    s = f"{v:.6f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def _list_names(names: list[str]) -> str:
    quoted = [f"«{s}»" for s in names]
    if len(quoted) <= 1:
        return "".join(quoted)
    return f"{', '.join(quoted[:-1])} y {quoted[-1]}"


def solve(req: AssignmentRequest) -> ModuleResult:
    agents = _validate_names(req.agents, "agent")
    tasks = _validate_names(req.tasks, "task")
    n_agents = len(agents)
    n_tasks = len(tasks)
    if len(req.costs) != n_agents:
        raise AssignmentError(
            f"La matriz de costos debe tener {n_agents} filas (una por agente) y {n_tasks} columnas (una por tarea)."
        )
    for i, row in enumerate(req.costs):
        if len(row) != n_tasks:
            raise AssignmentError(f"La fila de «{agents[i]}» debe tener {n_tasks} valores, uno por tarea.")
        for j, v in enumerate(row):
            if not np.isfinite(v):
                raise AssignmentError(f"El valor de «{agents[i]}» en «{tasks[j]}» no es un número.")
            if abs(v) >= _BIG_M / 1000:
                raise AssignmentError(
                    f"El valor de «{agents[i]}» en «{tasks[j]}» es demasiado grande. "
                    "Usa una celda prohibida en lugar de un costo enorme."
                )

    agent_idx = {a: i for i, a in enumerate(agents)}
    task_idx = {t: j for j, t in enumerate(tasks)}
    forbidden: set[tuple[int, int]] = set()
    for a, t in req.forbidden_assignments:
        a, t = str(a).strip(), str(t).strip()
        if a not in agent_idx or t not in task_idx:
            raise AssignmentError(
                f"La asignación prohibida {a}->{t} no corresponde a un agente y una tarea de la matriz."
            )
        forbidden.add((agent_idx[a], task_idx[t]))

    is_max = req.sense == "max"
    value_col = "ganancia" if is_max else "costo"
    warnings: list[str] = []
    costs = [[float(v) for v in row] for row in req.costs]

    # Matriz cuadrada: los ficticios cuestan 0 y nunca están prohibidos.
    n = max(n_agents, n_tasks)
    dummy_rows = list(range(n_agents, n))
    dummy_cols = list(range(n_tasks, n))
    row_labels = agents + [f"Agente ficticio {k + 1}" for k in range(len(dummy_rows))]
    col_labels = tasks + [f"Tarea ficticia {k + 1}" for k in range(len(dummy_cols))]
    padded = [[costs[i][j] if i < n_agents and j < n_tasks else 0.0 for j in range(n)] for i in range(n)]
    forbidden_pairs = sorted([i, j] for i, j in forbidden)
    if dummy_rows or dummy_cols:
        k = len(dummy_rows) or len(dummy_cols)
        if dummy_rows:
            what = "un agente ficticio" if k == 1 else f"{k} agentes ficticios"
            effect = "una tarea queda sin agente" if k == 1 else f"{k} tareas quedan sin agente"
        else:
            what = "una tarea ficticia" if k == 1 else f"{k} tareas ficticias"
            effect = "un agente queda sin tarea" if k == 1 else f"{k} agentes quedan sin tarea"
        verb = "agregó" if k == 1 else "agregaron"
        warnings.append(f"Matriz no cuadrada: se {verb} {what} con {value_col} 0 para completar {n}×{n}; {effect}.")

    scale = max([1.0] + [abs(v) for row in padded for v in row])
    eps = 1e-9 * scale

    def snap(v: float) -> float:
        return 0.0 if abs(v) < eps else v

    def display(m: list[list[float]]) -> list[list[float | str]]:
        return [
            ["M" if (i, j) in forbidden else float(f"{v:.12g}") for j, v in enumerate(row)]
            for i, row in enumerate(m)
        ]

    iterations: list[IterationStep] = []

    def push(title: str, tableau: list[list[float | str]] | None, meta: dict) -> None:
        iterations.append(
            IterationStep(index=len(iterations), method="hungarian", title=title, tableau=tableau, meta=meta)
        )

    padded_note = " completada con ficticios" if n != n_agents or n != n_tasks else ""
    push(
        f"Matriz de {'ganancias' if is_max else 'costos'}{padded_note}",
        display(padded),
        {
            "kind": "initial",
            "sense": req.sense,
            "row_labels": row_labels,
            "col_labels": col_labels,
            "dummy_rows": dummy_rows,
            "dummy_cols": dummy_cols,
            "forbidden": forbidden_pairs,
        },
    )

    costs_table = NamedTable(
        name="matriz_original",
        columns=["agente", *tasks],
        rows=[[a, *("M" if (i, j) in forbidden else costs[i][j] for j in range(n_tasks))] for i, a in enumerate(agents)],
    )

    # Factibilidad: con las prohibiciones, ¿cabe una asignación completa?
    allowed = [[(i, j) not in forbidden for j in range(n)] for i in range(n)]
    row_match, col_match, size = max_matching(allowed)
    if size < n:
        free = [r for r, c in enumerate(row_match) if c < 0][:1]
        row_seen, col_seen = _alternating_reach(allowed, row_match, col_match, free)
        stuck = [row_labels[i] for i in range(n) if row_seen[i]]
        reach_tasks = [col_labels[j] for j in range(n_tasks) if col_seen[j]]
        reach_dummy = any(col_seen[j] for j in dummy_cols)
        if reach_tasks:
            options = (
                f"{'la tarea' if len(reach_tasks) == 1 else 'las tareas'} {_list_names(reach_tasks)}"
                f"{' o quedarse sin tarea' if reach_dummy else ''}"
            )
        else:
            options = "quedarse sin tarea"
        if len(stuck) == 1:
            reason = f"{_list_names(stuck)} tiene prohibidas todas las tareas."
        else:
            reason = f"{_list_names(stuck)} solo pueden ir a {options}: no alcanzan para todos."
        return ModuleResult(
            module="assignment",
            status=SolveStatus.infeasible,
            solution=SolutionBlock(variables={}, objective_value=None, objective_sense=req.sense, metrics={}),
            iterations=iterations,
            sensitivity=None,
            graph=None,
            tables=[costs_table],
            warnings=[f"No existe una asignación que respete las prohibiciones: {reason}", *warnings],
        )

    if is_max:
        mx = max(padded[i][j] for i in range(n) for j in range(n) if allowed[i][j])
        work = [[mx - padded[i][j] if allowed[i][j] else _BIG_M for j in range(n)] for i in range(n)]
        push(f"Maximizar: pérdida de oportunidad ({_fmt(mx)} menos cada valor)", display(work), {"kind": "regret", "max_value": mx})
    else:
        work = [[padded[i][j] if allowed[i][j] else _BIG_M for j in range(n)] for i in range(n)]

    row_min = [min(row) for row in work]
    mat = [[snap(v - row_min[i]) for v in row] for i, row in enumerate(work)]
    push("Reducción por filas: a cada fila se le resta su mínimo", display(mat), {"kind": "row_reduction", "row_min": row_min})
    col_min = [min(mat[i][j] for i in range(n)) for j in range(n)]
    mat = [[snap(v - col_min[j]) for j, v in enumerate(row)] for row in mat]
    push(
        "Reducción por columnas: a cada columna se le resta su mínimo",
        display(mat),
        {"kind": "col_reduction", "col_min": col_min},
    )

    assignment: list[int] | None = None
    adjustments = 0
    for _ in range(n * n + 2 * n + 4):
        zeros = [[v == 0 for v in row] for row in mat]
        cover_rows, cover_cols, match = min_line_cover(zeros)
        lines = len(cover_rows) + len(cover_cols)
        independent = [[r, c] for r, c in enumerate(match) if c >= 0]
        title = (
            f"Cubrir ceros: {lines} líneas = {n}, ya hay asignación óptima"
            if lines >= n
            else f"Cubrir ceros: {lines} {'línea' if lines == 1 else 'líneas'} < {n}, falta ajustar"
        )
        push(
            title,
            display(mat),
            {
                "kind": "cover",
                "cover_rows": cover_rows,
                "cover_cols": cover_cols,
                "lines": lines,
                "n": n,
                "independent_zeros": independent,
            },
        )
        if lines >= n:
            assignment = match
            break
        row_cov = set(cover_rows)
        col_cov = set(cover_cols)
        delta = min(mat[i][j] for i in range(n) if i not in row_cov for j in range(n) if j not in col_cov)
        for i in range(n):
            for j in range(n):
                if i not in row_cov and j not in col_cov:
                    mat[i][j] = snap(mat[i][j] - delta)
                elif i in row_cov and j in col_cov:
                    mat[i][j] = snap(mat[i][j] + delta)
        adjustments += 1
        push(
            f"Ajuste con el mínimo no cubierto ({_fmt(delta)})",
            display(mat),
            {"kind": "adjust", "delta": delta, "cover_rows": cover_rows, "cover_cols": cover_cols},
        )
    if assignment is None:
        # Red de seguridad numérica: no debería ocurrir con la cobertura mínima.
        _, cols = linear_sum_assignment(np.array(work))
        assignment = [int(c) for c in cols]

    final_pairs = [[r, c] for r, c in enumerate(assignment)]
    push("Asignación óptima: un cero por fila y por columna", display(mat), {"kind": "assignment", "assigned": final_pairs})

    def is_real(r: int, c: int) -> bool:
        return r < n_agents and c < n_tasks

    variables: dict[str, float] = {}
    total = 0.0
    rows: list[list[str | float]] = []
    for r, c in final_pairs:
        if not is_real(r, c):
            continue
        variables[f"{agents[r]}->{tasks[c]}"] = 1.0
        total += costs[r][c]
        rows.append([agents[r], tasks[c], costs[r][c]])

    tables = [NamedTable(name="assignment", columns=["agente", "tarea", value_col], rows=rows)]
    unassigned: list[list[str]] = []
    for r, c in final_pairs:
        if r < n_agents and c >= n_tasks:
            unassigned.append(["agente", agents[r]])
        if c < n_tasks and r >= n_agents:
            unassigned.append(["tarea", tasks[c]])
    if unassigned:
        tables.append(NamedTable(name="sin_asignar", columns=["tipo", "nombre"], rows=unassigned))

    # Óptimos alternativos: otra asignación completa sobre los ceros finales.
    final_zeros = [[v == 0 for v in row] for row in mat]
    for r, c in final_pairs:
        if not is_real(r, c):
            continue
        banned = [[z and not (i == r and j == c) for j, z in enumerate(row)] for i, row in enumerate(final_zeros)]
        alt_match, _, alt_size = max_matching(banned)
        if alt_size < n:
            continue
        alt_rows = [[agents[ar], tasks[ac], costs[ar][ac]] for ar, ac in enumerate(alt_match) if is_real(ar, ac)]
        warnings.append(
            f"Existen óptimos múltiples: otra asignación logra el mismo total de {_fmt(total)} "
            "(ver tabla Asignación alternativa)."
        )
        tables.append(NamedTable(name="asignacion_alternativa", columns=["agente", "tarea", value_col], rows=alt_rows))
        break
    tables.append(costs_table)

    graph = GraphMatrix(
        type="matrix",
        row_labels=agents,
        col_labels=tasks,
        values=[[1.0 if f"{a}->{t}" in variables else 0.0 for t in tasks] for a in agents],
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
            metrics={"total": float(total), "n_assignments": float(len(rows)), "n_adjustments": float(adjustments)},
        ),
        iterations=iterations,
        sensitivity=None,
        graph=graph,
        tables=tables,
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result
