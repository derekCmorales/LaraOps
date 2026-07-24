from __future__ import annotations

import logging

from app.modules.breakeven.models import BreakevenRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: BreakevenRequest) -> ModuleResult:
    if req.price <= req.variable_cost:
        raise ValueError("price must exceed variable_cost for a finite breakeven")

    contribution = req.price - req.variable_cost
    bep_units = req.fixed_cost / contribution
    bep_revenue = bep_units * req.price
    cm_ratio = contribution / req.price

    metrics: dict[str, float] = {
        "contribution_margin": contribution,
        "cm_ratio": cm_ratio,
        "BEP_units": bep_units,
        "BEP_revenue": bep_revenue,
    }
    warnings: list[str] = []
    if req.volume is not None:
        profit = req.volume * contribution - req.fixed_cost
        metrics["profit_at_volume"] = profit
        metrics["revenue_at_volume"] = req.volume * req.price
        metrics["total_cost_at_volume"] = req.fixed_cost + req.volume * req.variable_cost
    if req.target_profit is not None:
        metrics["volume_for_target_profit"] = (req.fixed_cost + req.target_profit) / contribution

    tables: list[NamedTable] = [
        NamedTable(
            name="summary",
            columns=["métrica", "valor"],
            rows=[[k, v] for k, v in metrics.items()],
        )
    ]

    # Alternatives / indifference
    alt_rows: list[list] = []
    if req.alternatives:
        alts = [
            ("base", req.fixed_cost, req.variable_cost, req.price),
            *[
                (a.name, a.fixed_cost, a.variable_cost, a.price or req.price)
                for a in req.alternatives
            ],
        ]
        for name, fc, vc, price in alts:
            if price <= vc:
                alt_rows.append([name, None, None, "price <= VC"])
                continue
            cm = price - vc
            bep = fc / cm
            alt_rows.append([name, bep, cm, "ok"])
        # Indifference between base and each alternative (same price assumption on cost side)
        for a in req.alternatives:
            # TC1 = FC1 + VC1*q ; TC2 = FC2 + VC2*q ; indifference when equal
            denom = a.variable_cost - req.variable_cost
            if abs(denom) < 1e-12:
                warnings.append(f"Indiferencia con {a.name}: costos variables iguales")
                continue
            q_ind = (req.fixed_cost - a.fixed_cost) / denom
            metrics[f"indifference_vs_{a.name}"] = float(q_ind)
            alt_rows.append([f"indifference_base_vs_{a.name}", q_ind, None, "volume"])
        tables.append(
            NamedTable(
                name="alternatives",
                columns=["name", "BEP_or_Q", "CM", "note"],
                rows=alt_rows,
            )
        )

    q_max = max(
        bep_units * 2.0,
        req.volume or 0.0,
        abs(metrics.get("volume_for_target_profit", 0.0)),
        1.0,
    )
    for k, v in metrics.items():
        if k.startswith("indifference") and v is not None:
            q_max = max(q_max, abs(float(v)) * 1.5, 1.0)

    xs: list[float] = []
    tr: list[float] = []
    tc: list[float] = []
    n = req.graph_points
    series = []
    for i in range(n):
        q = q_max * i / (n - 1)
        xs.append(q)
        tr.append(q * req.price)
        tc.append(req.fixed_cost + q * req.variable_cost)
    series = [
        {"name": "TR", "x": xs, "y": tr},
        {"name": "TC", "x": xs, "y": tc},
    ]
    for a in req.alternatives:
        series.append(
            {
                "name": f"TC_{a.name}",
                "x": xs,
                "y": [a.fixed_cost + q * a.variable_cost for q in xs],
            }
        )

    result = ModuleResult(
        module="breakeven",
        status=SolveStatus.ok,
        solution=SolutionBlock(
            variables={"BEP_units": bep_units},
            objective_value=bep_units,
            objective_sense="min",
            metrics=metrics,
        ),
        iterations=None,
        sensitivity=None,
        graph=GraphXY(
            type="xy",
            series=series,
            x_label="Unidades (volumen)",
            y_label="Dinero ($)",
            title="Costo–volumen–utilidad",
            subtitle=f"Punto de equilibrio ≈ {bep_units:.2f} unidades",
        ),
        tables=tables,
        warnings=warnings,
    )
    logger.info("module=%s status=%s", result.module, result.status.value)
    return result
