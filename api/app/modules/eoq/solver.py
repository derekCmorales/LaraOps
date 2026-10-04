from __future__ import annotations

import logging
import math

from app.modules.eoq.models import EOQRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def _fmt_days(n: float) -> str:
    return str(int(n)) if float(n).is_integer() else f"{n:.2f}"


def solve(req: EOQRequest) -> ModuleResult:
    q_star = math.sqrt(2.0 * req.D * req.S / req.H)
    orders_per_year = req.D / q_star
    time_between = 1.0 / orders_per_year
    time_between_days = time_between * req.working_days
    tc_ordering = orders_per_year * req.S
    tc_holding = (q_star / 2.0) * req.H
    relevant_cost = tc_ordering + tc_holding
    purchase_cost = req.C * req.D
    tc = relevant_cost + purchase_cost
    daily_demand = req.D / req.working_days
    warnings: list[str] = []

    metrics = {
        "Q_star": q_star,
        "orders_per_year": orders_per_year,
        "time_between_orders_years": time_between,
        "time_between_orders_days": time_between_days,
        "avg_inventory": q_star / 2.0,
        "TC_ordering": tc_ordering,
        "TC_holding": tc_holding,
        "relevant_cost": relevant_cost,
        "purchase_cost": purchase_cost,
        "TC": tc,
        "daily_demand": daily_demand,
    }

    reorder_point: float | None = None
    if req.lead_time > 0:
        reorder_point = daily_demand * req.lead_time
        metrics["lead_time"] = req.lead_time
        metrics["reorder_point"] = reorder_point
        if req.lead_time > time_between_days:
            warnings.append(
                "El tiempo de entrega es mayor que el tiempo entre pedidos: habrá más de un pedido "
                "en tránsito. Compara el punto de reorden con la posición de inventario "
                "(en mano + en tránsito)."
            )

    # Malla de Q que incluye Q* exacto para que el mínimo quede sobre la curva.
    q_min = 0.2 * q_star
    q_max = 2.5 * q_star
    n = req.graph_points
    qs = [q_min + (q_max - q_min) * i / (n - 1) for i in range(n)]
    nearest = min(range(n), key=lambda i: abs(qs[i] - q_star))
    qs[nearest] = q_star

    ord_ys = [(req.D / q) * req.S for q in qs]
    hold_ys = [(q / 2.0) * req.H for q in qs]
    rel_ys = [o + h for o, h in zip(ord_ys, hold_ys)]

    if purchase_cost > 0:
        subtitle = (
            f"Mínimo en Q* = {q_star:.2f} con costo relevante {relevant_cost:.2f}. "
            f"El costo de compra ({purchase_cost:.2f}) no depende de Q y no se grafica."
        )
    else:
        subtitle = f"Mínimo en Q* = {q_star:.2f} con costo relevante {relevant_cost:.2f}."

    graph = GraphXY(
        type="xy",
        series=[
            {"name": "relevant_cost", "x": qs, "y": rel_ys},
            {"name": "ordering", "x": qs, "y": ord_ys},
            {"name": "holding", "x": qs, "y": hold_ys},
        ],
        x_label="Cantidad de pedido (Q)",
        y_label="Costo anual",
        title="Costos de inventario vs. cantidad de pedido",
        subtitle=subtitle,
    )

    rows: list[list[str | float]] = [
        ["Cantidad económica de pedido (Q*)", q_star],
        ["Pedidos por año (N = D / Q*)", orders_per_year],
        ["Tiempo entre pedidos (años)", time_between],
        [f"Tiempo entre pedidos (días, {_fmt_days(req.working_days)} días/año)", time_between_days],
        ["Inventario promedio (Q* / 2)", q_star / 2.0],
        ["Costo anual de ordenar (D / Q* x S)", tc_ordering],
        ["Costo anual de mantener (Q* / 2 x H)", tc_holding],
        ["Costo relevante (ordenar + mantener)", relevant_cost],
        ["Costo anual de compra (C x D)", purchase_cost],
        ["Costo total anual", tc],
    ]
    if reorder_point is not None:
        rows.append(["Demanda diaria (D / días por año)", daily_demand])
        rows.append(["Punto de reorden (demanda diaria x tiempo de entrega)", reorder_point])

    table = NamedTable(name="summary", columns=["métrica", "valor"], rows=rows)

    result = ModuleResult(
        module="eoq",
        status=SolveStatus.ok,
        solution=SolutionBlock(variables={"Q": q_star}, metrics=metrics),
        iterations=None,
        sensitivity=None,
        graph=graph,
        tables=[table],
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result
