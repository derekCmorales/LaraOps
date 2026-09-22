from __future__ import annotations

import logging
from typing import Any

import numpy as np
from scipy.optimize import linprog

from app.modules.lp.graph_2d import vertices_named_table
from app.modules.lp.graph_nd import build_lp_graph
from app.modules.lp.models import ConstraintSense, LPRequest
from app.modules.lp.sensitivity import compute_sensitivity
from app.schemas.common import SolveStatus
from app.schemas.result import IterationStep, ModuleResult, SolutionBlock

logger = logging.getLogger(__name__)


def collect_var_names(req: LPRequest) -> list[str]:
    if req.variable_names:
        return list(req.variable_names)
    names = set(req.objective)
    for c in req.constraints:
        names.update(c.coeffs)
    return sorted(names)


def solve(req: LPRequest) -> ModuleResult:
    var_names = collect_var_names(req)
    n = len(var_names)
    maximize = req.sense == "max"
    c_user = np.array([req.objective.get(v, 0.0) for v in var_names], dtype=float)
    c_obj = c_user.copy() if maximize else -c_user

    constraint_ids = [c.id for c in req.constraints]
    rows: list[np.ndarray] = []
    rhs_list: list[float] = []
    senses: list[str] = []

    for cons in req.constraints:
        row = np.array([cons.coeffs.get(v, 0.0) for v in var_names], dtype=float)
        b_val = float(cons.rhs)
        sense = cons.sense
        if b_val < 0:
            row = -row
            b_val = -b_val
            if sense == ConstraintSense.le:
                sense = ConstraintSense.ge
            elif sense == ConstraintSense.ge:
                sense = ConstraintSense.le
        rows.append(row)
        rhs_list.append(b_val)
        senses.append(sense.value)

    warnings: list[str] = []
    iterations: list[IterationStep] = []

    if not rows:
        if np.any(np.abs(c_obj) > 1e-12):
            return _result(req, SolveStatus.unbounded, {v: 0.0 for v in var_names}, None, [], None, warnings)
        return _result(req, SolveStatus.optimal, {v: 0.0 for v in var_names}, 0.0, [], None, warnings)

    A_core = np.vstack(rows)
    b_original = np.array(rhs_list, dtype=float)
    m = len(rows)

    extra_cols: list[np.ndarray] = []
    col_names = list(var_names)
    basic = [-1] * m
    art_indices: list[int] = []

    for i, sense in enumerate(senses):
        if sense == "<=":
            col = np.zeros(m)
            col[i] = 1.0
            extra_cols.append(col)
            col_names.append(f"s_{constraint_ids[i]}")
            basic[i] = n + len(extra_cols) - 1
        elif sense == ">=":
            surplus = np.zeros(m)
            surplus[i] = -1.0
            extra_cols.append(surplus)
            col_names.append(f"e_{constraint_ids[i]}")
            art = np.zeros(m)
            art[i] = 1.0
            extra_cols.append(art)
            col_names.append(f"a_{constraint_ids[i]}")
            basic[i] = n + len(extra_cols) - 1
            art_indices.append(basic[i])
        else:
            art = np.zeros(m)
            art[i] = 1.0
            extra_cols.append(art)
            col_names.append(f"a_{constraint_ids[i]}")
            basic[i] = n + len(extra_cols) - 1
            art_indices.append(basic[i])

    A_work = np.hstack([A_core, np.column_stack(extra_cols)]) if extra_cols else A_core.copy()
    b = b_original.copy()
    total_cols = A_work.shape[1]
    A_std = A_work.copy()  # original standard-form coefficients (pre-pivot)

    # Phase I if needed
    if art_indices:
        c_phase1 = np.zeros(total_cols)
        for ai in art_indices:
            c_phase1[ai] = -1.0
        status_p1, basic, A_work, b, iters_p1 = _simplex_loop(
            A_work, b, c_phase1, basic, col_names, phase_label="Fase I", start_index=0
        )
        if req.include_iterations:
            iterations.extend(iters_p1)
        art_sum = 0.0
        for ai in art_indices:
            if ai in basic:
                art_sum += float(b[basic.index(ai)])
        if art_sum > 1e-7:
            return _result(
                req,
                SolveStatus.infeasible,
                {v: 0.0 for v in var_names},
                None,
                iterations if req.include_iterations else [],
                None,
                warnings,
            )

        art_set = set(art_indices)
        rows_before = A_work.shape[0]
        A_work, b, basic, keep_rows = _eject_artificials_from_basis(
            A_work, b, basic, art_set
        )
        if len(keep_rows) < rows_before:
            A_std = A_std[keep_rows, :]
            b_original = b_original[keep_rows]
            constraint_ids = [constraint_ids[i] for i in keep_rows]
            warnings.append(
                "Restricciones redundantes detectadas y eliminadas tras la Fase I"
            )

        keep = [j for j in range(A_work.shape[1]) if j not in art_set]
        old_to_new = {old: new for new, old in enumerate(keep)}
        A_work = A_work[:, keep]
        A_std = A_std[:, keep]
        col_names = [col_names[j] for j in keep]
        basic = [old_to_new[bi] for bi in basic if bi in old_to_new]
        c_phase2 = np.zeros(len(keep))
        for j_old, j_new in old_to_new.items():
            if j_old < n:
                c_phase2[j_new] = c_obj[j_old]
    else:
        c_phase2 = np.zeros(total_cols)
        c_phase2[:n] = c_obj

    status_p2, basic, A_work, b, iters_p2 = _simplex_loop(
        A_work,
        b,
        c_phase2,
        basic,
        col_names,
        phase_label="Fase II",
        start_index=len(iterations),
    )
    if req.include_iterations:
        iterations.extend(iters_p2)

    if status_p2 == "unbounded":
        return _result(
            req,
            SolveStatus.unbounded,
            {v: 0.0 for v in var_names},
            None,
            iterations if req.include_iterations else [],
            None,
            warnings,
        )

    x_full = np.zeros(len(col_names))
    for row, col in enumerate(basic):
        x_full[col] = b[row]
    variables = {var_names[i]: float(x_full[i]) for i in range(n)}
    z_internal = float(c_phase2 @ x_full)
    z_user = z_internal if maximize else -z_internal

    # Degeneracy: basic variable at zero
    for row, col in enumerate(basic):
        if abs(b[row]) < 1e-9 and col < n:
            warnings.append(
                f"Degeneración: variable básica {col_names[col]} = 0"
            )
            break

    # Multiple optima: nonbasic decision var with reduced cost ≈ 0
    try:
        B = A_std[:, basic]
        B_inv = np.linalg.inv(B)
        y = c_phase2[basic] @ B_inv
        reduced = c_phase2 - y @ A_std
        nonbasic = [j for j in range(len(col_names)) if j not in basic]
        alt = [
            col_names[j]
            for j in nonbasic
            if j < n and abs(reduced[j]) < 1e-8
        ]
        if alt:
            warnings.append(
                "Óptimos múltiples: variables no básicas con costo reducido ≈ 0: "
                + ", ".join(alt)
            )
    except np.linalg.LinAlgError:
        pass

    sensitivity = None
    if req.include_sensitivity:
        sensitivity = compute_sensitivity(
            A=A_std,
            b_original=b_original,
            c_internal=c_phase2,
            basic=basic,
            var_names=var_names,
            constraint_ids=constraint_ids,
            constraints=req.constraints,
            variables=variables,
            n_decision=n,
            maximize=maximize,
            c_user=c_user,
            warnings=warnings,
        )

    graph = None
    tables = None
    if req.include_graph:
        graph, graph_warnings = build_lp_graph(req, variables, z_user)
        warnings.extend(graph_warnings)
        if graph is not None:
            x_name = graph.x_label or ""
            y_name = graph.y_label or ""
            ox = float(variables.get(x_name, 0.0))
            oy = float(variables.get(y_name, 0.0))
            oz = float(variables.get(graph.z_label, 0.0)) if graph.z_label else None
            vertex_table = vertices_named_table(graph, ox, oy, maximize=maximize, oz=oz)
            tables = [vertex_table] if vertex_table is not None else None

    # Cross-check vs scipy (informational warning only if mismatch)
    _crosscheck_linprog(req, var_names, variables, z_user, warnings)

    result = ModuleResult(
        module="linear_programming",
        status=SolveStatus.optimal,
        solution=SolutionBlock(
            variables=variables,
            objective_value=z_user,
            objective_sense=req.sense,
            metrics={},
        ),
        iterations=iterations if req.include_iterations else None,
        sensitivity=sensitivity,
        graph=graph,
        tables=tables,
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result


def _result(
    req: LPRequest,
    status: SolveStatus,
    variables: dict[str, float],
    objective: float | None,
    iterations: list[IterationStep],
    sensitivity: Any,
    warnings: list[str],
) -> ModuleResult:
    return ModuleResult(
        module="linear_programming",
        status=status,
        solution=SolutionBlock(
            variables=variables,
            objective_value=objective,
            objective_sense=req.sense,
            metrics={},
        ),
        iterations=iterations if iterations else None,
        sensitivity=sensitivity,
        graph=None,
        tables=None,
        warnings=warnings,
    )


def _pivot_tableau(
    body: np.ndarray,
    x_b: np.ndarray,
    basic: list[int],
    leave_row: int,
    enter: int,
) -> None:
    """Pivot the canonical tableau in place (same convention as _simplex_loop)."""
    pivot = body[leave_row, enter]
    body[leave_row, :] = body[leave_row, :] / pivot
    x_b[leave_row] = x_b[leave_row] / pivot
    for i in range(body.shape[0]):
        if i == leave_row:
            continue
        factor = body[i, enter]
        body[i, :] = body[i, :] - factor * body[leave_row, :]
        x_b[i] = x_b[i] - factor * x_b[leave_row]
    basic[leave_row] = enter


def _eject_artificials_from_basis(
    A: np.ndarray,
    b: np.ndarray,
    basic: list[int],
    art_set: set[int],
    *,
    tol: float = 1e-9,
) -> tuple[np.ndarray, np.ndarray, list[int], list[int]]:
    """Remove zero-valued artificials from the basis before dropping columns."""
    body = A.astype(float).copy()
    x_b = b.astype(float).copy()
    basic = list(basic)
    m, n = body.shape

    changed = True
    while changed:
        changed = False
        for i in range(m):
            bi = basic[i]
            if bi not in art_set or abs(x_b[i]) > tol:
                continue
            nonbasic = [j for j in range(n) if j not in basic]
            enter = next(
                (
                    j
                    for j in nonbasic
                    if j not in art_set and abs(body[i, j]) > tol
                ),
                None,
            )
            if enter is None:
                continue
            _pivot_tableau(body, x_b, basic, i, enter)
            changed = True
            break

    keep_rows = [
        i
        for i in range(m)
        if basic[i] not in art_set or abs(x_b[i]) > tol
    ]
    if len(keep_rows) < m:
        body = body[keep_rows, :]
        x_b = x_b[keep_rows]
        basic = [basic[i] for i in keep_rows]

    return body, x_b, basic, keep_rows


def _simplex_loop(
    A: np.ndarray,
    b: np.ndarray,
    c: np.ndarray,
    basic: list[int],
    col_names: list[str],
    *,
    phase_label: str,
    start_index: int,
    max_iters: int = 200,
) -> tuple[str, list[int], np.ndarray, np.ndarray, list[IterationStep]]:
    iterations: list[IterationStep] = []
    m, n = A.shape
    A = A.astype(float).copy()
    b = b.astype(float).copy()
    basic = list(basic)

    for k in range(max_iters):
        B = A[:, basic]
        try:
            B_inv = np.linalg.inv(B)
        except np.linalg.LinAlgError:
            B_inv = np.linalg.pinv(B)
        x_b = B_inv @ b
        # Keep numerical nonnegativity
        x_b = np.where(np.abs(x_b) < 1e-12, 0.0, x_b)
        c_b = c[basic]
        y = c_b @ B_inv
        reduced = c - y @ A
        z = float(c_b @ x_b)
        body = B_inv @ A
        tableau = np.column_stack([body, x_b])

        nonbasic = [j for j in range(n) if j not in basic]
        cj_row: list[float | str] = ["Cj", ""] + [float(c[j]) for j in range(n)]
        header_row: list[float | str] = ["Base", "Xb"] + [col_names[j] for j in range(n)]
        body_rows: list[list[float | str]] = []
        for i in range(m):
            base_name = col_names[basic[i]] if i < len(basic) else f"s{i}"
            body_rows.append(
                [base_name, float(x_b[i])] + [float(body[i, j]) for j in range(n)]
            )
        zj_row: list[float | str] = ["Zj−Cj", float(z)] + [float(reduced[j]) for j in range(n)]
        tab_list: list[list[float | str]] = [cj_row, header_row, *body_rows, zj_row]
        iterations.append(
            IterationStep(
                index=start_index + k,
                method="simplex",
                title=f"{phase_label} — Iteración {k}",
                tableau=tab_list,
                meta={
                    "basic": [col_names[i] for i in basic],
                    "nonbasic": [col_names[j] for j in nonbasic],
                    "pivot": None,
                    "z": float(z),
                    "phase": phase_label,
                },
            )
        )

        enter_candidates = [(reduced[j], j) for j in nonbasic if reduced[j] > 1e-9]
        if not enter_candidates:
            # Sync A,b to canonical form
            A = body.copy()
            b = x_b.copy()
            return "optimal", basic, A, b, iterations

        _, enter = max(enter_candidates)
        col = body[:, enter]
        ratios = [(x_b[i] / col[i], i) for i in range(m) if col[i] > 1e-12]
        if not ratios:
            return "unbounded", basic, body.copy(), x_b.copy(), iterations
        _, leave_row = min(ratios)
        leave_col = basic[leave_row]
        iterations[-1].meta["pivot"] = {
            "row": leave_row + 2,
            "col": enter + 2,
            "enter": col_names[enter],
            "leave": col_names[leave_col],
        }

        # Pivot on tableau
        _pivot_tableau(body, x_b, basic, leave_row, enter)
        A = body
        b = x_b

    return "unbounded", basic, A, b, iterations


def _crosscheck_linprog(
    req: LPRequest,
    var_names: list[str],
    variables: dict[str, float],
    z_user: float,
    warnings: list[str],
) -> None:
    n = len(var_names)
    c = np.array([req.objective.get(v, 0.0) for v in var_names], dtype=float)
    if req.sense == "max":
        c = -c
    A_ub: list[list[float]] = []
    b_ub: list[float] = []
    A_eq: list[list[float]] = []
    b_eq: list[float] = []
    for cons in req.constraints:
        row = [cons.coeffs.get(v, 0.0) for v in var_names]
        if cons.sense == ConstraintSense.le:
            A_ub.append(row)
            b_ub.append(cons.rhs)
        elif cons.sense == ConstraintSense.ge:
            A_ub.append([-a for a in row])
            b_ub.append(-cons.rhs)
        else:
            A_eq.append(row)
            b_eq.append(cons.rhs)
    bounds = []
    for v in var_names:
        if req.bounds and v in req.bounds:
            lo, hi = req.bounds[v]
            bounds.append((0 if lo is None else lo, None if hi is None else hi))
        else:
            bounds.append((0, None))
    try:
        res = linprog(
            c,
            A_ub=np.array(A_ub) if A_ub else None,
            b_ub=np.array(b_ub) if b_ub else None,
            A_eq=np.array(A_eq) if A_eq else None,
            b_eq=np.array(b_eq) if b_eq else None,
            bounds=bounds,
            method="highs",
        )
        if res.success:
            z_scipy = float(-res.fun if req.sense == "max" else res.fun)
            if abs(z_scipy - z_user) > 1e-4:
                warnings.append(
                    f"Discrepancia en verificación cruzada con linprog: simplex={z_user}, scipy={z_scipy}"
                )
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"Verificación cruzada con linprog omitida: {exc}")
