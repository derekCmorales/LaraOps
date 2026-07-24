from __future__ import annotations

import math

from app.modules.inventory.models import InventoryRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock


def solve_eoq(req: InventoryRequest) -> ModuleResult:
    warnings: list[str] = []
    rows: list[list[float | str]] = []

    if req.discounts:
        best_tc = float("inf")
        best_q = 0.0
        best_c = 0.0
        for brk in sorted(req.discounts, key=lambda b: b.min_qty):
            c = brk.unit_cost
            h = req.H if req.H is not None else (req.i or 0.0) * c
            if h <= 0:
                raise ValueError("Holding cost H or rate i required for discount evaluation")
            q_star = math.sqrt(2.0 * req.D * req.S / h)
            q = max(q_star, brk.min_qty)
            tc = (req.D / q) * req.S + (q / 2.0) * h + c * req.D
            rows.append([brk.min_qty, c, q_star, q, tc])
            if tc < best_tc:
                best_tc = tc
                best_q = q
                best_c = c
        q_star = best_q
        tc = best_tc
        h_used = req.H if req.H is not None else (req.i or 0.0) * best_c
        c_used = best_c
    else:
        c_used = req.C
        h_used = req.H if req.H is not None else (req.i or 0.0) * c_used
        if h_used <= 0:
            raise ValueError("Provide H > 0 or i with C > 0")
        q_star = math.sqrt(2.0 * req.D * req.S / h_used)
        tc = (req.D / q_star) * req.S + (q_star / 2.0) * h_used + c_used * req.D
        rows.append([0, c_used, q_star, q_star, tc])

    d = req.daily_demand if req.daily_demand is not None else req.D / req.working_days
    if req.lead_time > 0 and req.lead_time <= 1.0:
        lt_days = req.lead_time * req.working_days
    elif req.lead_time > 1.0:
        lt_days = req.lead_time
        warnings.append("lead_time > 1 se interpreta como días")
    else:
        lt_days = 0.0

    rop = d * lt_days
    if req.z is not None and req.sigma_daily is not None and lt_days > 0:
        safety = req.z * req.sigma_daily * math.sqrt(lt_days)
        rop = rop + safety
        warnings.append("ROP incluye stock de seguridad")

    metrics = {
        "Q_star": float(q_star),
        "TC": float(tc),
        "ROP": float(rop),
        "H": float(h_used),
        "C": float(c_used),
    }
    tables = [
        NamedTable(
            name="discount_eval",
            columns=["cantidad_mín", "costo_unitario", "Q_sin_restricción", "Q_usado", "CT"],
            rows=rows,
        )
    ]

    graph = None
    if not req.discounts:
        graph = _sawtooth_graph(q_star, req.D, lt_days / req.working_days if req.working_days else 0.0)
    else:
        graph = _discount_cost_graph(rows)

    result = ModuleResult(
        module="inventory",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables={"Q": float(q_star)}, metrics=metrics),
        iterations=None,
        sensitivity=None,
        graph=graph,
        tables=tables,
        warnings=warnings,
    )
    return result


def solve_epq(req: InventoryRequest) -> ModuleResult:
    D = req.D or 0.0
    S = req.S or 0.0
    p = req.p or 0.0
    C = req.C
    h_used = req.H if req.H is not None else (req.i or 0.0) * C
    if h_used <= 0:
        raise ValueError("Provide H > 0 or i with C > 0")
    if D >= p:
        raise ValueError("Production rate p must exceed demand rate D for EPQ/POQ")

    factor = 1.0 - D / p
    q_star = math.sqrt(2.0 * D * S / (h_used * factor))
    i_max = q_star * factor
    production_time = q_star / p
    cycle_time = q_star / D
    tc = (D / q_star) * S + (i_max / 2.0) * h_used + C * D

    metrics = {
        "Q_star": float(q_star),
        "I_max": float(i_max),
        "production_time": float(production_time),
        "cycle_time": float(cycle_time),
        "TC": float(tc),
        "H": float(h_used),
        "C": float(C),
    }
    graph = _trapezoid_graph(i_max, production_time, cycle_time)

    result = ModuleResult(
        module="inventory",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables={"Q": float(q_star)}, metrics=metrics),
        iterations=None,
        sensitivity=None,
        graph=graph,
        tables=[
            NamedTable(
                name="epq_summary",
                columns=["métrica", "valor"],
                rows=[[k, v] for k, v in metrics.items()],
            )
        ],
        warnings=[],
    )
    return result


def solve_backorder(req: InventoryRequest) -> ModuleResult:
    D = req.D or 0.0
    S = req.S or 0.0
    Cs = req.Cs or 0.0
    C = req.C
    h_used = req.H if req.H is not None else (req.i or 0.0) * C
    if h_used <= 0:
        raise ValueError("Provide H > 0 or i with C > 0")

    ratio = (h_used + Cs) / Cs
    q_star = math.sqrt(2.0 * D * S / h_used * ratio)
    s_star = q_star * h_used / (h_used + Cs)
    i_max = q_star - s_star
    cycle_time = q_star / D

    ordering_cost = (D / q_star) * S
    holding_cost = (i_max**2) / (2.0 * q_star) * h_used
    shortage_cost = (s_star**2) / (2.0 * q_star) * Cs
    tc = ordering_cost + holding_cost + shortage_cost + C * D

    metrics = {
        "Q_star": float(q_star),
        "S_star": float(s_star),
        "I_max": float(i_max),
        "cycle_time": float(cycle_time),
        "TC": float(tc),
        "TC_ordering": float(ordering_cost),
        "TC_holding": float(holding_cost),
        "TC_shortage": float(shortage_cost),
        "H": float(h_used),
        "C": float(C),
    }
    graph = _backorder_graph(i_max, s_star, cycle_time)

    result = ModuleResult(
        module="inventory",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables={"Q": float(q_star)}, metrics=metrics),
        iterations=None,
        sensitivity=None,
        graph=graph,
        tables=[
            NamedTable(
                name="backorder_summary",
                columns=["métrica", "valor"],
                rows=[[k, v] for k, v in metrics.items()],
            )
        ],
        warnings=[],
    )
    return result


def _sawtooth_graph(q_star: float, D: float, lead_time_years: float) -> GraphXY:
    time_between = q_star / D if D else 0.0
    xs: list[float] = []
    ys: list[float] = []
    cycles = 3
    for k in range(cycles):
        start = k * time_between
        xs.extend([start, start + time_between])
        ys.extend([q_star, 0.0])
    series = [{"name": "Nivel de inventario", "x": xs, "y": ys}]
    if lead_time_years > 0:
        rop_x = [k * time_between + (time_between - lead_time_years) for k in range(cycles)]
        series.append(
            {
                "name": "Punto de reorden (lead time)",
                "x": rop_x,
                "y": [q_star * lead_time_years / time_between if time_between else 0.0] * cycles,
            }
        )
    return GraphXY(type="xy", series=series, x_label="tiempo (años)", y_label="inventario (unidades)")


def _trapezoid_graph(i_max: float, production_time: float, cycle_time: float) -> GraphXY:
    xs = [0.0, production_time, cycle_time]
    ys = [0.0, i_max, 0.0]
    return GraphXY(
        type="xy",
        series=[{"name": "Nivel de inventario (EPQ)", "x": xs, "y": ys}],
        x_label="tiempo (años)",
        y_label="inventario (unidades)",
    )


def _backorder_graph(i_max: float, s_star: float, cycle_time: float) -> GraphXY:
    t1 = cycle_time * i_max / (i_max + s_star) if (i_max + s_star) > 0 else 0.0
    xs = [0.0, t1, cycle_time]
    ys = [i_max, 0.0, -s_star]
    return GraphXY(
        type="xy",
        series=[{"name": "Nivel de inventario (faltantes planeados)", "x": xs, "y": ys}],
        x_label="tiempo (años)",
        y_label="inventario (unidades, negativo = faltante)",
    )


def _discount_cost_graph(rows: list[list[float | str]]) -> GraphXY:
    xs = [float(r[3]) for r in rows]
    ys = [float(r[4]) for r in rows]
    order = sorted(range(len(xs)), key=lambda idx: xs[idx])
    return GraphXY(
        type="xy",
        series=[{"name": "TC por nivel de descuento", "x": [xs[i] for i in order], "y": [ys[i] for i in order]}],
        x_label="Q usado",
        y_label="Costo total anual",
    )
