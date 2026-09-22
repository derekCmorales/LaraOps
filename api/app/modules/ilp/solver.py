from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from scipy.optimize import linprog

from app.modules.ilp.models import ILPRequest
from app.modules.lp.graph_nd import build_lp_graph
from app.modules.lp.models import ConstraintSense
from app.modules.lp.solver import collect_var_names
from app.schemas.common import SolveStatus
from app.schemas.result import IterationStep, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)

Bounds = dict[str, tuple[float, float | None]]

_EPS = 1e-6


@dataclass
class _Node:
    node_id: int
    parent_id: int | None
    bounds: Bounds
    depth: int


@dataclass
class _RelaxResult:
    status: str  # "optimal" | "infeasible" | "unbounded"
    variables: dict[str, float] = field(default_factory=dict)
    objective: float | None = None


def _build_matrices(
    req: ILPRequest, var_names: list[str]
) -> tuple[np.ndarray, list[list[float]], list[float], list[list[float]], list[float]]:
    c_user = np.array([req.objective.get(v, 0.0) for v in var_names], dtype=float)
    a_ub: list[list[float]] = []
    b_ub: list[float] = []
    a_eq: list[list[float]] = []
    b_eq: list[float] = []
    for cons in req.constraints:
        row = [cons.coeffs.get(v, 0.0) for v in var_names]
        if cons.sense == ConstraintSense.le:
            a_ub.append(row)
            b_ub.append(cons.rhs)
        elif cons.sense == ConstraintSense.ge:
            a_ub.append([-a for a in row])
            b_ub.append(-cons.rhs)
        else:
            a_eq.append(row)
            b_eq.append(cons.rhs)
    return c_user, a_ub, b_ub, a_eq, b_eq


def _base_bounds(req: ILPRequest, var_names: list[str]) -> Bounds:
    bounds: Bounds = {}
    for v in var_names:
        lo, hi = 0.0, None
        if req.bounds and v in req.bounds:
            raw_lo, raw_hi = req.bounds[v]
            lo = 0.0 if raw_lo is None else float(raw_lo)
            hi = raw_hi
        if v in req.binary_vars:
            lo, hi = 0.0, 1.0
        bounds[v] = (lo, hi)
    return bounds


def _solve_relaxation(
    var_names: list[str],
    c_min: np.ndarray,
    a_ub: list[list[float]],
    b_ub: list[float],
    a_eq: list[list[float]],
    b_eq: list[float],
    bounds_map: Bounds,
    maximize: bool,
) -> _RelaxResult:
    bnds = [bounds_map[v] for v in var_names]
    try:
        res = linprog(
            c_min,
            A_ub=np.array(a_ub) if a_ub else None,
            b_ub=np.array(b_ub) if b_ub else None,
            A_eq=np.array(a_eq) if a_eq else None,
            b_eq=np.array(b_eq) if b_eq else None,
            bounds=bnds,
            method="highs",
        )
    except ValueError:
        return _RelaxResult(status="infeasible")

    if res.status == 3:
        return _RelaxResult(status="unbounded")
    if not res.success or res.status == 2:
        return _RelaxResult(status="infeasible")

    variables = {v: float(res.x[i]) for i, v in enumerate(var_names)}
    obj_min = float(res.fun)
    obj_user = -obj_min if maximize else obj_min
    return _RelaxResult(status="optimal", variables=variables, objective=obj_user)


def _select_branch_var(
    variables: dict[str, float], int_vars: list[str]
) -> tuple[str, float] | None:
    best_var: str | None = None
    best_frac_dist = -1.0
    best_val = 0.0
    for v in int_vars:
        val = variables[v]
        frac = val - math.floor(val)
        dist_to_half = min(frac, 1.0 - frac)
        if frac > _EPS and frac < 1.0 - _EPS and dist_to_half > best_frac_dist:
            best_frac_dist = dist_to_half
            best_var = v
            best_val = val
    if best_var is None:
        return None
    return best_var, best_val


def solve(req: ILPRequest) -> ModuleResult:
    var_names = collect_var_names(req)
    maximize = req.sense == "max"
    c_user, a_ub, b_ub, a_eq, b_eq = _build_matrices(req, var_names)
    c_min = c_user.copy() if not maximize else -c_user.copy()

    int_vars = [v for v in var_names if v in req.integer_vars or v in req.binary_vars]

    warnings: list[str] = []
    if not int_vars:
        warnings.append(
            "No se especificaron variables enteras/binarias; se resolvió como LP continuo"
        )

    root_bounds = _base_bounds(req, var_names)

    iterations: list[IterationStep] = []
    node_rows: list[list[float | str]] = []

    root = _Node(node_id=0, parent_id=None, bounds=root_bounds, depth=0)
    stack: list[_Node] = [root]
    next_node_id = 1

    incumbent_obj: float | None = None
    incumbent_vars: dict[str, float] | None = None
    incumbent_node: int | None = None

    nodes_explored = 0
    pruned_bound = 0
    pruned_infeasible = 0
    pruned_integer = 0
    node_limit_hit = False
    root_relaxation_obj: float | None = None
    root_status: str | None = None

    def better(a: float, b: float) -> bool:
        return (a > b + _EPS) if maximize else (a < b - _EPS)

    while stack:
        if nodes_explored >= req.max_nodes:
            node_limit_hit = True
            warnings.append(
                f"Límite de nodos ({req.max_nodes}) alcanzado; la búsqueda se detuvo antes de agotar el árbol"
            )
            break

        node = stack.pop()
        nodes_explored += 1
        relax = _solve_relaxation(var_names, c_min, a_ub, b_ub, a_eq, b_eq, node.bounds, maximize)

        if node.node_id == 0:
            root_status = relax.status
            if relax.status == "optimal":
                root_relaxation_obj = relax.objective

        if relax.status == "unbounded":
            if node.node_id == 0:
                return _unbounded_result(req, var_names, warnings)
            iterations.append(
                IterationStep(
                    index=node.node_id,
                    method="branch_bound",
                    title=f"Nodo {node.node_id} — no acotado",
                    meta={
                        "parent": node.parent_id,
                        "depth": node.depth,
                        "pruned_reason": "unbounded",
                    },
                )
            )
            continue

        if relax.status == "infeasible":
            pruned_infeasible += 1
            node_rows.append([node.node_id, node.parent_id, node.depth, None, None, "infactible"])
            iterations.append(
                IterationStep(
                    index=node.node_id,
                    method="branch_bound",
                    title=f"Nodo {node.node_id} — infactible",
                    meta={
                        "parent": node.parent_id,
                        "depth": node.depth,
                        "pruned_reason": "infeasible",
                        "bounds": _bounds_repr(node.bounds),
                    },
                )
            )
            continue

        relax_obj = relax.objective if relax.objective is not None else 0.0

        if incumbent_obj is not None and not better(relax_obj, incumbent_obj):
            pruned_bound += 1
            node_rows.append(
                [node.node_id, node.parent_id, node.depth, relax_obj, None, "bound"]
            )
            iterations.append(
                IterationStep(
                    index=node.node_id,
                    method="branch_bound",
                    title=f"Nodo {node.node_id} — podado por cota (relajación={relax_obj:.4g})",
                    meta={
                        "parent": node.parent_id,
                        "depth": node.depth,
                        "relaxation_objective": relax_obj,
                        "incumbent_objective": incumbent_obj,
                        "pruned_reason": "bound",
                        "bounds": _bounds_repr(node.bounds),
                    },
                )
            )
            continue

        branch = _select_branch_var(relax.variables, int_vars)

        if branch is None:
            pruned_integer += 1
            improved = incumbent_obj is None or better(relax_obj, incumbent_obj)
            node_rows.append(
                [node.node_id, node.parent_id, node.depth, relax_obj, relax_obj, "integer"]
            )
            iterations.append(
                IterationStep(
                    index=node.node_id,
                    method="branch_bound",
                    title=f"Nodo {node.node_id} — solución entera factible (Z={relax_obj:.4g})",
                    meta={
                        "parent": node.parent_id,
                        "depth": node.depth,
                        "relaxation_objective": relax_obj,
                        "variables": relax.variables,
                        "pruned_reason": "integer",
                        "incumbent_updated": improved,
                        "bounds": _bounds_repr(node.bounds),
                    },
                )
            )
            if improved:
                incumbent_obj = relax_obj
                incumbent_vars = relax.variables
                incumbent_node = node.node_id
            continue

        branch_var, branch_val = branch
        lo, hi = node.bounds[branch_var]
        floor_v = math.floor(branch_val + _EPS)
        ceil_v = math.ceil(branch_val - _EPS)

        node_rows.append(
            [node.node_id, node.parent_id, node.depth, relax_obj, None, f"ramifica en {branch_var}"]
        )
        iterations.append(
            IterationStep(
                index=node.node_id,
                method="branch_bound",
                title=(
                    f"Nodo {node.node_id} — ramifica en {branch_var}="
                    f"{branch_val:.4g} (Z_relax={relax_obj:.4g})"
                ),
                meta={
                    "parent": node.parent_id,
                    "depth": node.depth,
                    "relaxation_objective": relax_obj,
                    "variables": relax.variables,
                    "branch_variable": branch_var,
                    "branch_value": branch_val,
                    "pruned_reason": None,
                    "bounds": _bounds_repr(node.bounds),
                    "children": [next_node_id, next_node_id + 1],
                },
            )
        )

        left_bounds = dict(node.bounds)
        left_bounds[branch_var] = (lo, float(floor_v))
        right_bounds = dict(node.bounds)
        right_bounds[branch_var] = (float(ceil_v), hi)

        child_right = _Node(next_node_id, node.node_id, right_bounds, node.depth + 1)
        next_node_id += 1
        child_left = _Node(next_node_id, node.node_id, left_bounds, node.depth + 1)
        next_node_id += 1

        # DFS: push right then left so left (floor branch) explored first
        stack.append(child_right)
        stack.append(child_left)

    if root_status == "infeasible":
        return _infeasible_result(req, var_names, warnings, iterations, node_rows)

    if incumbent_vars is None:
        warnings.append(
            "No se encontró ninguna solución entera factible"
            + (" antes de alcanzar el límite de nodos" if node_limit_hit else "")
        )
        status = SolveStatus.infeasible
        variables = {v: 0.0 for v in var_names}
        objective: float | None = None
    else:
        status = SolveStatus.optimal
        variables = {v: incumbent_vars.get(v, 0.0) for v in var_names}
        objective = incumbent_obj

    metrics: dict[str, float] = {
        "nodes_explored": float(nodes_explored),
        "nodes_pruned_bound": float(pruned_bound),
        "nodes_pruned_infeasible": float(pruned_infeasible),
        "nodes_pruned_integer": float(pruned_integer),
        "max_nodes": float(req.max_nodes),
        "node_limit_reached": 1.0 if node_limit_hit else 0.0,
    }
    if root_relaxation_obj is not None:
        metrics["lp_relaxation_objective"] = float(root_relaxation_obj)
        if objective is not None:
            metrics["integer_objective"] = float(objective)
            gap_abs = abs(root_relaxation_obj - objective)
            metrics["gap_absolute"] = float(gap_abs)
            denom = abs(root_relaxation_obj)
            metrics["gap_percent"] = float(gap_abs / denom * 100.0) if denom > 1e-12 else 0.0

    tables: list[NamedTable] | None = None
    if req.include_node_table and node_rows:
        tables = [
            NamedTable(
                name="bb_nodes",
                columns=["nodo", "padre", "profundidad", "z_relajación", "z_entero", "estado"],
                rows=node_rows,
            )
        ]

    graph = None
    if status == SolveStatus.optimal and req.include_graph and objective is not None:
        graph, graph_warnings = build_lp_graph(req, variables, float(objective))
        warnings.extend(graph_warnings)

    result = ModuleResult(
        module="integer_programming",
        status=status,
        solution=SolutionBlock(
            variables=variables,
            objective_value=objective,
            objective_sense=req.sense,
            metrics=metrics,
        ),
        iterations=iterations or None,
        sensitivity=None,
        graph=graph,
        tables=tables,
        warnings=warnings,
    )
    logger.info(
        "module=%s status=%s nodes=%d", result.module, result.status.value, nodes_explored
    )
    return result


def _bounds_repr(bounds: Bounds) -> dict[str, list[float | None]]:
    return {k: [v[0], v[1]] for k, v in bounds.items()}


def _unbounded_result(
    req: ILPRequest, var_names: list[str], warnings: list[str]
) -> ModuleResult:
    return ModuleResult(
        module="integer_programming",
        status=SolveStatus.unbounded,
        solution=SolutionBlock(
            variables={v: 0.0 for v in var_names},
            objective_value=None,
            objective_sense=req.sense,
            metrics={},
        ),
        iterations=None,
        sensitivity=None,
        graph=None,
        tables=None,
        warnings=warnings,
    )


def _infeasible_result(
    req: ILPRequest,
    var_names: list[str],
    warnings: list[str],
    iterations: list[IterationStep],
    node_rows: list[list[Any]],
) -> ModuleResult:
    warnings.append("La relajación LP raíz ya es infactible")
    tables = None
    if node_rows:
        tables = [
            NamedTable(
                name="bb_nodes",
                columns=["nodo", "padre", "profundidad", "z_relajación", "z_entero", "estado"],
                rows=node_rows,
            )
        ]
    return ModuleResult(
        module="integer_programming",
        status=SolveStatus.infeasible,
        solution=SolutionBlock(
            variables={v: 0.0 for v in var_names},
            objective_value=None,
            objective_sense=req.sense,
            metrics={},
        ),
        iterations=iterations or None,
        sensitivity=None,
        graph=None,
        tables=tables,
        warnings=warnings,
    )
