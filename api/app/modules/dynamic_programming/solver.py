from __future__ import annotations

import logging
from functools import lru_cache

from app.modules.dynamic_programming.models import DynamicProgrammingRequest
from app.schemas.common import SolveStatus
from app.schemas.result import ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: DynamicProgrammingRequest) -> ModuleResult:
    if req.problem == "knapsack":
        return _knapsack(req)
    return _stagecoach(req)


def _knapsack(req: DynamicProgrammingRequest) -> ModuleResult:
    if req.capacity is None or not req.items:
        raise ValueError("capacity and items required for knapsack")
    # 0-1 knapsack with integer weights (scale if needed)
    weights = [int(round(it.weight)) for it in req.items]
    values = [float(it.value) for it in req.items]
    ids = [it.id for it in req.items]
    W = int(round(req.capacity))
    n = len(req.items)
    dp = [[0.0] * (W + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        wi, vi = weights[i - 1], values[i - 1]
        for w in range(W + 1):
            dp[i][w] = dp[i - 1][w]
            if wi <= w:
                dp[i][w] = max(dp[i][w], dp[i - 1][w - wi] + vi)

    # reconstruct
    w = W
    chosen = []
    for i in range(n, 0, -1):
        if dp[i][w] != dp[i - 1][w]:
            chosen.append(ids[i - 1])
            w -= weights[i - 1]
    chosen.reverse()

    # Recursion table (sampled if large): stage i, capacity w, f_i(w)
    recursion_rows: list[list] = []
    step = max(1, W // 20)
    for i in range(n + 1):
        for wcap in range(0, W + 1, step):
            recursion_rows.append([i, wcap, dp[i][wcap]])
    if W % step != 0:
        for i in range(n + 1):
            recursion_rows.append([i, W, dp[i][W]])

    variables = {i: 1.0 if i in chosen else 0.0 for i in ids}
    return ModuleResult(
        module="dynamic_programming",
        status=SolveStatus.optimal,
        solution=SolutionBlock(
            variables=variables,
            objective_value=float(dp[n][W]),
            objective_sense="max",
            metrics={"best_value": float(dp[n][W]), "capacity_used": float(sum(weights[ids.index(c)] for c in chosen))},
        ),
        tables=[
            NamedTable(name="selected", columns=["ítem"], rows=[[c] for c in chosen]),
            NamedTable(
                name="recursion",
                columns=["stage_i", "capacity_w", "f_i(w)"],
                rows=recursion_rows,
            ),
        ],
        iterations=None,
        sensitivity=None,
        graph=None,
        warnings=[],
    )

def _stagecoach(req: DynamicProgrammingRequest) -> ModuleResult:
    if not req.stages or not req.costs or not req.origin or not req.destination:
        raise ValueError("stages, costs, origin, destination required for stagecoach")
    costs = req.costs
    # Flatten nodes
    all_nodes = [n for stage in req.stages for n in stage]
    if req.origin not in all_nodes or req.destination not in all_nodes:
        raise ValueError("origin/destination must appear in stages")

    # DP backward from destination
    @lru_cache(maxsize=None)
    def best(node: str) -> tuple[float, str | None]:
        if node == req.destination:
            return 0.0, None
        options = costs.get(node, {})
        if not options:
            return float("inf"), None
        best_cost = float("inf")
        best_next = None
        for nxt, c in options.items():
            rest, _ = best(nxt)
            total = c + rest
            if total < best_cost:
                best_cost = total
                best_next = nxt
        return best_cost, best_next

    total, _ = best(req.origin)
    if total == float("inf"):
        raise ValueError("no path from origin to destination")

    path = [req.origin]
    cur = req.origin
    while cur != req.destination:
        _, nxt = best(cur)
        if nxt is None:
            break
        path.append(nxt)
        cur = nxt

    # Stage decisions table f_n(s), x*_n
    stage_rows: list[list] = []
    for stage_idx, stage_nodes in enumerate(req.stages):
        for node in stage_nodes:
            cost_val, nxt = best(node)
            stage_rows.append([stage_idx, node, cost_val if cost_val < float("inf") else None, nxt])

    return ModuleResult(
        module="dynamic_programming",
        status=SolveStatus.optimal,
        solution=SolutionBlock(
            variables={f"node_{i}": 1.0 for i, _ in enumerate(path)},
            objective_value=float(total),
            objective_sense="min",
            metrics={"path_cost": float(total)},
        ),
        tables=[
            NamedTable(name="path", columns=["orden", "nodo"], rows=[[i, n] for i, n in enumerate(path)]),
            NamedTable(
                name="stage_decisions",
                columns=["stage", "state", "f_n(s)", "x_star"],
                rows=stage_rows,
            ),
        ],
        iterations=None,
        sensitivity=None,
        graph=None,
        warnings=[],
    )