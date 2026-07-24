from __future__ import annotations

import logging

import pulp

from app.modules.aggregate_planning.models import AggregatePlanningRequest
from app.schemas.common import SolveStatus
from app.schemas.result import GraphXY, ModuleResult, NamedTable, SolutionBlock

logger = logging.getLogger(__name__)


def solve(req: AggregatePlanningRequest) -> ModuleResult:
    T = len(req.demand)
    prob = pulp.LpProblem("aggregate_planning", pulp.LpMinimize)
    W = [pulp.LpVariable(f"W_{t}", lowBound=0) for t in range(T)]
    H = [pulp.LpVariable(f"H_{t}", lowBound=0) for t in range(T)]
    F = [pulp.LpVariable(f"F_{t}", lowBound=0) for t in range(T)]
    I = [pulp.LpVariable(f"I_{t}", lowBound=0) for t in range(T)]
    S = [pulp.LpVariable(f"S_{t}", lowBound=0) for t in range(T)]  # shortage
    P = [pulp.LpVariable(f"P_{t}", lowBound=0) for t in range(T)]

    # Workforce balance
    prob += W[0] == req.initial_workforce + H[0] - F[0]
    for t in range(1, T):
        prob += W[t] == W[t - 1] + H[t] - F[t]

    for t in range(T):
        prob += P[t] == req.production_per_worker * W[t]
        if t == 0:
            prob += I[0] - S[0] == req.initial_inventory + P[0] - req.demand[0]
        else:
            prob += I[t] - S[t] == I[t - 1] - S[t - 1] + P[t] - req.demand[t]

    if req.strategy == "chase":
        for t in range(T):
            prob += I[t] == 0
            prob += S[t] == 0
    elif req.strategy == "level":
        for t in range(1, T):
            prob += W[t] == W[0]

    prob += pulp.lpSum(
        req.cost_hire * H[t]
        + req.cost_fire * F[t]
        + req.cost_hold * I[t]
        + req.cost_shortage * S[t]
        + req.cost_regular * P[t]
        for t in range(T)
    )

    status = prob.solve(pulp.PULP_CBC_CMD(msg=False))
    if pulp.LpStatus[status] != "Optimal":
        return ModuleResult(
            module="aggregate_planning",
            status=SolveStatus.infeasible,
            solution=SolutionBlock(variables={}, metrics={}),
            warnings=[f"PuLP: {pulp.LpStatus[status]}"],
        )

    rows = []
    for t in range(T):
        rows.append(
            [
                t + 1,
                req.demand[t],
                float(pulp.value(W[t]) or 0),
                float(pulp.value(H[t]) or 0),
                float(pulp.value(F[t]) or 0),
                float(pulp.value(P[t]) or 0),
                float(pulp.value(I[t]) or 0),
                float(pulp.value(S[t]) or 0),
            ]
        )
    total = float(pulp.value(prob.objective) or 0)
    xs = list(range(1, T + 1))
    return ModuleResult(
        module="aggregate_planning",
        status=SolveStatus.optimal,
        solution=SolutionBlock(
            variables={f"W_t{t+1}": float(pulp.value(W[t]) or 0) for t in range(T)},
            objective_value=total,
            objective_sense="min",
            metrics={"total_cost": total},
        ),
        graph=GraphXY(
            type="xy",
            series=[
                {"name": "demand", "x": xs, "y": list(req.demand)},
                {"name": "production", "x": xs, "y": [r[5] for r in rows]},
                {"name": "inventory", "x": xs, "y": [r[6] for r in rows]},
            ],
            x_label="Periodo",
            y_label="Unidades",
            title="Plan agregado: demanda, producción e inventario",
            subtitle=f"Costo total = {total:.2f}",
        ),
        tables=[
            NamedTable(
                name="plan",
                columns=["periodo", "demanda", "fuerza_laboral", "contrataciones", "despidos", "producción", "inventario", "faltante"],
                rows=rows,
            )
        ],
        warnings=[],
    )
