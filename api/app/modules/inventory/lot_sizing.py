from __future__ import annotations

from app.modules.inventory.models import InventoryRequest
from app.schemas.common import SolveStatus
from app.schemas.result import ModuleResult, NamedTable, SolutionBlock


def _evaluate_schedule(
    d: list[float], schedule: list[float], S: float, H: float
) -> tuple[float, float, float]:
    inv = 0.0
    order_cost_total = 0.0
    holding_total = 0.0
    for t in range(len(d)):
        if schedule[t] > 1e-9:
            order_cost_total += S
            inv += schedule[t]
        inv -= d[t]
        holding_total += H * max(inv, 0.0)
    return order_cost_total + holding_total, order_cost_total, holding_total


def _wagner_whitin(d: list[float], S: float, H: float) -> list[float]:
    T = len(d)
    cost = [0.0] * (T + 1)
    order_at = [1] * (T + 1)
    for t in range(1, T + 1):
        best = float("inf")
        best_k = t
        for k in range(1, t + 1):
            holding = sum((j - k) * d[j - 1] for j in range(k, t + 1))
            c = cost[k - 1] + S + H * holding
            if c < best - 1e-9:
                best = c
                best_k = k
        cost[t] = best
        order_at[t] = best_k

    schedule = [0.0] * T
    t = T
    while t >= 1:
        k = order_at[t]
        schedule[k - 1] = sum(d[k - 1 : t])
        t = k - 1
    return schedule


def _silver_meal(d: list[float], S: float, H: float) -> list[float]:
    T = len(d)
    schedule = [0.0] * T

    def avg_cost(t: int, n: int) -> float:
        holding = H * sum(k * d[t + k] for k in range(n))
        return (S + holding) / n

    t = 0
    while t < T:
        n = 1
        while t + n < T and avg_cost(t, n + 1) <= avg_cost(t, n) + 1e-9:
            n += 1
        schedule[t] = sum(d[t : t + n])
        t += n
    return schedule


def _lot_for_lot(d: list[float]) -> list[float]:
    return list(d)


def solve_dynamic_lot_sizing(req: InventoryRequest) -> ModuleResult:
    d = list(req.demand_periods or [])
    S = req.S or 0.0
    H = req.H or 0.0
    if not d:
        raise ValueError("demand_periods must be non-empty")

    builders = {
        "wagner_whitin": _wagner_whitin,
        "silver_meal": _silver_meal,
        "lot_for_lot": lambda dd, ss, hh: _lot_for_lot(dd),
    }

    comparison_rows: list[list[float | str]] = []
    schedules: dict[str, list[float]] = {}
    for method in req.lot_sizing_methods:
        builder = builders[method]
        schedule = builder(d, S, H)
        total, order_cost, holding_cost = _evaluate_schedule(d, schedule, S, H)
        schedules[method] = schedule
        comparison_rows.append([method, total, order_cost, holding_cost])

    best_method = min(comparison_rows, key=lambda r: r[1])[0]
    best_schedule = schedules[best_method]
    best_total = next(r[1] for r in comparison_rows if r[0] == best_method)

    plan_rows: list[list[float | str]] = []
    inv = 0.0
    for t, demand in enumerate(d, start=1):
        order_qty = best_schedule[t - 1]
        inv += order_qty
        inv -= demand
        plan_rows.append([t, demand, order_qty, max(inv, 0.0)])

    metrics = {
        "best_method": best_method,
        "TC": float(best_total),
        "num_orders": float(sum(1 for q in best_schedule if q > 1e-9)),
    }
    # metrics values must be numeric per SolutionBlock contract; keep the method name
    # only in the comparison table and report a numeric TC/order count here.
    metrics.pop("best_method", None)

    result = ModuleResult(
        module="inventory",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables={}, metrics=metrics),
        iterations=None,
        sensitivity=None,
        graph=None,
        tables=[
            NamedTable(
                name="lot_sizing_plan",
                columns=["periodo", "demanda", "cantidad_pedido", "inventario_final"],
                rows=plan_rows,
            ),
            NamedTable(
                name="method_comparison",
                columns=["método", "costo_total", "costo_pedido", "costo_mantenimiento"],
                rows=comparison_rows,
            ),
            NamedTable(
                name="best_method",
                columns=["method"],
                rows=[[best_method]],
            ),
        ],
        warnings=[],
    )
    return result
