from __future__ import annotations

import logging
import math

from app.modules.eoq.models import EOQRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: EOQRequest) -> ModuleResult:
    q_star = math.sqrt(2.0 * req.D * req.S / req.H)
    orders_per_year = req.D / q_star
    time_between = 1.0 / orders_per_year
    tc_ordering = orders_per_year * req.S
    tc_holding = (q_star / 2.0) * req.H
    tc = tc_ordering + tc_holding + req.C * req.D

    q_min = 0.2 * q_star
    q_max = 2.5 * q_star
    n = req.graph_points
    xs: list[float] = []
    tc_ys: list[float] = []
    ord_ys: list[float] = []
    hold_ys: list[float] = []
    for i in range(n):
        q = q_min + (q_max - q_min) * i / (n - 1)
        xs.append(q)
        n_orders = req.D / q
        ordering = n_orders * req.S
        holding = (q / 2.0) * req.H
        ord_ys.append(ordering)
        hold_ys.append(holding)
        tc_ys.append(ordering + holding + req.C * req.D)

    graph = GraphXY(
        type="xy",
        series=[
            {"name": "TC", "x": xs, "y": tc_ys},
            {"name": "ordering", "x": xs, "y": ord_ys},
            {"name": "holding", "x": xs, "y": hold_ys},
        ],
        x_label="Cantidad de pedido (Q)",
        y_label="Costo anual",
        title="Costos de inventario vs. cantidad de pedido",
        subtitle=f"Mínimo en Q* = {q_star:.2f}",
    )

    table = NamedTable(
        name="summary",
        columns=["métrica", "valor"],
        rows=[
            ["Q_star", q_star],
            ["orders_per_year", orders_per_year],
            ["time_between_orders_years", time_between],
            ["TC", tc],
            ["TC_ordering", tc_ordering],
            ["TC_holding", tc_holding],
        ],
    )

    result = ModuleResult(
        module="eoq",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={"Q": q_star},
            metrics={
                "Q_star": q_star,
                "orders_per_year": orders_per_year,
                "time_between_orders_years": time_between,
                "TC": tc,
                "TC_ordering": tc_ordering,
                "TC_holding": tc_holding,
            },
        ),
        iterations=None,
        sensitivity=None,
        graph=graph,
        tables=[table],
        warnings=[],
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result
